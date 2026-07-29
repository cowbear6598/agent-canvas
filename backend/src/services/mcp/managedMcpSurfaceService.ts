/**
 * Managed MCP Surface Service — 為 pod 組 provider-injectable MCP entries。
 *
 * 此 service 不再聚合成單一 surface MCP，改為「每顆 managed MCP 一個獨立 entry」
 * 注入給 provider；agent 從 mcp/list 看到 N+1 個獨立 MCP（含 Goal Runtime）。
 *
 * 三家 provider 對 transport 的原生支援度（TRANSPORT_NATIVE_SUPPORT）：
 *   - claude SDK 只接受 stdio MCP entry
 *   - codex CLI 可寫 stdio / http 兩種 mcp_servers entry
 *   - opencode 透過 config 可寫 local（stdio）/ remote（http+sse）entry
 *
 * 對「不原生支援」的 transport（如 Claude 遇到 http target），會透過 per-MCP
 * proxy bridge（managedMcpProxyBridge.ts）把 http/sse 包成 stdio entry。
 *
 * lifecycle：所有 entries 都是 provider 自身 spawn 的子程序（含 proxy bridge），
 * provider session 結束時自然回收，service 不維護任何 state file / handle map。
 */

import { buildGoalRuntimeMcpServerConfig } from "../goalRuntime.js";
import { buildInternalSelfSpawn } from "../../utils/internalSelfSpawn.js";
import { buildPluginMcpEntry } from "../plugin/pluginMcpEntryBuilder.js";
import { integrationRegistry } from "../integration/index.js";
import {
  buildReplyContextKey,
  replyContextStore,
} from "../integration/replyContextStore.js";
import { createIntegrationReplyCapability } from "../integration/integrationReplyCapability.js";
import {
  buildPluginSkillCatalog,
  type PluginSkillCatalogEntry,
} from "../plugin/pluginCatalogBuilder.js";
import { socketService } from "../socketService.js";
import { WebSocketResponseEvents } from "../../schemas/events.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";
import {
  managedMcpStore,
  type ManagedMcpServerRecord,
  type ManagedMcpTransport,
} from "./managedMcpStore.js";
import {
  managedMcpRuntimeService,
  type ManagedMcpRuntimeService,
} from "./managedMcpRuntimeService.js";

type SupportedProvider = "claude" | "codex" | "opencode";

const TRANSPORT_NATIVE_SUPPORT: Record<
  SupportedProvider,
  ReadonlySet<ManagedMcpTransport>
> = {
  claude: new Set(["stdio"]),
  codex: new Set(["stdio", "http"]),
  opencode: new Set(["stdio", "http", "sse"]),
};

export interface ManagedMcpSurfaceIgnoredTarget {
  name: string;
  reason: string;
}

/**
 * 注入給 provider 的單一 MCP entry。
 *
 * 形狀為 discriminated union：
 *   - stdio：直接 spawn 子程序（含 Goal Runtime、stdio target、proxy bridge 包裝後的 http/sse target）
 *   - http / sse：給原生支援該 transport 的 provider（codex / opencode）直接連線
 *
 * `proxied: true` 標示「此 stdio entry 實際上是 per-MCP bridge 對 http/sse target 的包裝」，
 * 給上層除錯與測試用，provider 本身不需要區別對待。
 */
export type PodMcpEntry =
  | {
      name: string;
      transport: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string | null;
      proxied: boolean;
    }
  | {
      name: string;
      transport: "http" | "sse";
      url: string;
    };

export interface PodMcpEntriesResult {
  entries: PodMcpEntry[];
  ignoredTargets: ManagedMcpSurfaceIgnoredTarget[];
  hasGoalRuntime: boolean;
  /**
   * Bundle Skill Catalog（依 pod.pluginIds 掃出的所有 SKILL.md）。
   * Provider 在 fresh session 首輪會把這份 catalog 注入 prompt，
   * 讓 LLM 知道有哪些 skill 可用、絕對路徑在哪。
   */
  pluginCatalog: PluginSkillCatalogEntry[];
}

interface ManagedMcpStoreLike {
  getByName(name: string): ManagedMcpServerRecord | undefined;
}

interface ManagedMcpSurfaceServiceDeps {
  store: ManagedMcpStoreLike;
  runtimeService: ManagedMcpRuntimeService;
}

const INTEGRATION_PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function getInternalIntegrationReplyUrl(): string {
  return (
    process.env.AGENT_CANVAS_INTERNAL_INTEGRATION_REPLY_URL ??
    `http://127.0.0.1:${config.port}/api/internal/integration-reply`
  );
}

/**
 * 將單一 registry record 轉成 provider-injectable entry。
 *
 * 規則：
 *   - record.transport === "stdio" → 原生 stdio entry
 *   - record.transport === "http" / "sse" 且 provider 原生支援 → 原生 remote entry
 *   - record.transport === "http" / "sse" 且 provider 不原生支援 → per-MCP proxy bridge 包成 stdio
 */
function buildPodMcpEntry(
  entry: ManagedMcpServerRecord,
  provider: SupportedProvider,
): PodMcpEntry {
  if (entry.transport === "stdio") {
    return {
      name: entry.name,
      transport: "stdio",
      command: entry.command ?? "",
      args: [...entry.args],
      env: { ...entry.env },
      cwd: entry.cwd,
      proxied: false,
    };
  }

  if (TRANSPORT_NATIVE_SUPPORT[provider].has(entry.transport)) {
    return {
      name: entry.name,
      transport: entry.transport,
      url: entry.url ?? "",
    };
  }

  // provider 不原生支援該 transport → 包 per-MCP proxy bridge
  const spawn = buildInternalSelfSpawn("--mcp-proxy-bridge");
  return {
    name: entry.name,
    transport: "stdio",
    command: spawn.command,
    args: spawn.args,
    env: {
      AGENT_CANVAS_MCP_PROXY_NAME: entry.name,
      AGENT_CANVAS_MCP_PROXY_TRANSPORT: entry.transport,
      AGENT_CANVAS_MCP_PROXY_URL: entry.url ?? "",
    },
    cwd: null,
    proxied: true,
  };
}

export class ManagedMcpSurfaceService {
  constructor(private readonly deps: ManagedMcpSurfaceServiceDeps) {}

  /**
   * 為 pod 組出獨立注入用的 MCP entry 清單。
   *
   * 排序：Goal Runtime 永遠在最前（若 runContext 存在且 pod.goal 有 todos），
   * 其後依 pod.mcpServerNames 順序。Ignored target 不會進 entries，但會被收進
   * ignoredTargets；若有 ignored 且為 run 模式，會發送 MANAGED_MCP_SURFACE_TARGETS_IGNORED
   * 通知前端。
   */
  async buildPodMcpEntries(
    pod: Pick<
      Pod,
      | "id"
      | "name"
      | "provider"
      | "goal"
      | "mcpServerNames"
      | "pluginIds"
      | "integrationBindings"
    >,
    runContext: RunContext | null,
  ): Promise<PodMcpEntriesResult> {
    const provider = pod.provider as SupportedProvider;
    const { records, ignoredTargets } = await this.collectPodMcpRecords(pod);

    const entries: PodMcpEntry[] = [];

    // Goal Runtime 一律 stdio，且只有 run 模式（有 runContext + pod.goal.todos）才出現
    let hasGoalRuntime = false;
    if (runContext) {
      const goal = buildGoalRuntimeMcpServerConfig(runContext, pod);
      if (goal) {
        entries.push({
          name: goal.name,
          transport: "stdio",
          command: goal.command,
          args: [...goal.args],
          env: { ...goal.env },
          cwd: null,
          proxied: false,
        });
        hasGoalRuntime = true;
      }
    }

    // Bundle MCP bridge：無條件注入（即使 pluginIds 為空），由 bridge 依 pod_plugin_ids
    // 決定 scope；保持 entry 名稱穩定避免 provider session 重啟。
    // catalog 則僅在實際有 pluginIds 時才掃描（buildPluginSkillCatalog 內部對空陣列直接回 []）。
    entries.push(buildPluginMcpEntry(pod.id));
    const pluginCatalog = await buildPluginSkillCatalog(pod.pluginIds);

    for (const entry of buildIntegrationReplyMcpEntries(pod, runContext)) {
      entries.push(entry);
    }

    for (const record of records) {
      entries.push(buildPodMcpEntry(record, provider));
    }

    // 通知前端：本次 buildPodMcpEntries 略過了哪些 selected MCP（含原因）。
    // 只在 run 模式發送（chat 模式前端目前未接收 chat-scoped ignored 來源，
    // 與舊 ensureSurface 行為保持一致）。
    if (runContext && ignoredTargets.length > 0) {
      socketService.emitToCanvas(
        runContext.canvasId,
        WebSocketResponseEvents.MANAGED_MCP_SURFACE_TARGETS_IGNORED,
        {
          success: true,
          canvasId: runContext.canvasId,
          runId: runContext.runId,
          podId: pod.id,
          podName: pod.name,
          ignored: ignoredTargets,
        },
      );
    }

    return { entries, ignoredTargets, hasGoalRuntime, pluginCatalog };
  }

  /**
   * 收集 pod 已勾選的 managed MCP records，過濾掉
   *   - registry 不存在
   *   - disabled
   *   - runtime 不 healthy
   * 三類項目（會記進 ignoredTargets）。
   *
   * 不過濾 transport — http/sse target 對所有 provider 都允許，由 buildPodMcpEntry
   * 決定要不要包 proxy bridge。
   */
  private async collectPodMcpRecords(
    pod: Pick<Pod, "mcpServerNames">,
  ): Promise<{
    records: ManagedMcpServerRecord[];
    ignoredTargets: ManagedMcpSurfaceIgnoredTarget[];
  }> {
    type ResolvedItem =
      | { kind: "ignored"; name: string; reason: string }
      | { kind: "healthy"; entry: ManagedMcpServerRecord };

    // 對所有 server name 並行執行 ensureReady，保留 input 順序
    const resolved = await Promise.all(
      pod.mcpServerNames.map(async (selectedName): Promise<ResolvedItem> => {
        const entry = this.deps.store.getByName(selectedName);
        if (!entry) {
          return {
            kind: "ignored",
            name: selectedName,
            reason: "registry entry removed",
          };
        }
        if (!entry.enabled) {
          return {
            kind: "ignored",
            name: selectedName,
            reason: "registry entry disabled",
          };
        }
        const runtime =
          await this.deps.runtimeService.ensureReady(selectedName);
        if (runtime.status !== "healthy") {
          return {
            kind: "ignored",
            name: selectedName,
            reason: runtime.lastError ?? "managed MCP runtime is not healthy",
          };
        }

        return { kind: "healthy", entry };
      }),
    );

    const records: ManagedMcpServerRecord[] = [];
    const ignoredTargets: ManagedMcpSurfaceIgnoredTarget[] = [];

    for (const item of resolved) {
      if (item.kind === "ignored") {
        ignoredTargets.push({ name: item.name, reason: item.reason });
      } else {
        records.push(item.entry);
      }
    }

    return { records, ignoredTargets };
  }
}

function buildIntegrationReplyMcpEntries(
  pod: Pick<Pod, "id" | "integrationBindings">,
  runContext: RunContext | null,
): PodMcpEntry[] {
  if (!pod.integrationBindings?.length) {
    return [];
  }

  const replyContext =
    runContext !== null
      ? replyContextStore.get(buildReplyContextKey(runContext, pod.id))
      : undefined;
  const spawn = buildInternalSelfSpawn("--integration-reply-bridge");
  const entries: PodMcpEntry[] = [];
  const endpointUrl = getInternalIntegrationReplyUrl();

  for (const binding of pod.integrationBindings) {
    if (!INTEGRATION_PROVIDER_NAME_PATTERN.test(binding.provider)) {
      logger.warn(
        "Integration",
        "Warn",
        "略過不合法格式的 integration provider（名稱已遮罩）",
      );
      continue;
    }

    const provider = integrationRegistry.get(binding.provider);
    if (!provider?.sendMessage) continue;

    entries.push({
      name: `${binding.provider}-reply`,
      transport: "stdio",
      command: spawn.command,
      args: spawn.args,
      env: {
        AGENT_CANVAS_INTEGRATION_REPLY_CAPABILITY:
          createIntegrationReplyCapability({
            provider: binding.provider,
            appId: binding.appId,
            resourceId: binding.resourceId,
            podId: pod.id,
            extra: binding.extra ?? {},
            replyContext: { ...(replyContext ?? {}) },
          }),
        AGENT_CANVAS_INTEGRATION_REPLY_PROVIDER: binding.provider,
        AGENT_CANVAS_INTEGRATION_REPLY_APP_ID: binding.appId,
        AGENT_CANVAS_INTEGRATION_REPLY_RESOURCE_ID: binding.resourceId,
        AGENT_CANVAS_INTEGRATION_REPLY_POD_ID: pod.id,
        AGENT_CANVAS_INTEGRATION_REPLY_EXTRA: JSON.stringify(
          binding.extra ?? {},
        ),
        AGENT_CANVAS_INTEGRATION_REPLY_CONTEXT: JSON.stringify(
          replyContext ?? {},
        ),
        AGENT_CANVAS_INTEGRATION_REPLY_ENDPOINT: endpointUrl,
      },
      cwd: null,
      proxied: false,
    });
  }

  return entries;
}

export function createManagedMcpSurfaceService(
  deps?: Partial<ManagedMcpSurfaceServiceDeps>,
): ManagedMcpSurfaceService {
  return new ManagedMcpSurfaceService({
    store: deps?.store ?? managedMcpStore,
    runtimeService: deps?.runtimeService ?? managedMcpRuntimeService,
  });
}

export const managedMcpSurfaceService = createManagedMcpSurfaceService();
