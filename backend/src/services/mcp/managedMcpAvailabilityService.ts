import type { PodMcpAvailabilityItem } from "../../schemas/mcpSchemas.js";
import { buildGoalRuntimeMcpListItem } from "../goalRuntime.js";
import {
  managedMcpStore,
  type ManagedMcpServerRecord,
} from "./managedMcpStore.js";
import {
  managedMcpRuntimeService,
  type ManagedMcpRuntimeSnapshot,
} from "./managedMcpRuntimeService.js";
import type { Pod } from "../../types/pod.js";
import type { CodexMcpRuntimeEntry } from "../codex/codexMcpService.js";

interface ManagedMcpStoreLike {
  list(): ManagedMcpServerRecord[];
}

interface ManagedMcpRuntimeServiceLike {
  getRuntimeSnapshot(name: string): ManagedMcpRuntimeSnapshot | null;
}

interface AvailabilityDeps {
  store: ManagedMcpStoreLike;
  runtimeService: ManagedMcpRuntimeServiceLike;
}

function buildGoalAvailabilityItem(
  pod: Pick<Pod, "id" | "name" | "goal">,
): PodMcpAvailabilityItem {
  const item = buildGoalRuntimeMcpListItem(pod);
  return {
    key: "canvas:system:agent_canvas_goal",
    name: item.name,
    source: "canvas",
    transport: "stdio",
    status: item.status,
    selected: true,
    selectable: false,
    disabledReason: null,
    lastError: null,
    system: true,
    locked: true,
    description: item.description,
    activeTodoId: item.activeTodoId,
    activeTodoText: item.activeTodoText,
    nextTodoId: item.nextTodoId,
    nextTodoText: item.nextTodoText,
    blockedReason: item.blockedReason,
    handoffSummary: item.handoffSummary,
    completedTodoIds: item.completedTodoIds,
    completedCount: item.completedCount,
    totalCount: item.totalCount,
  };
}

/**
 * Bundle MCP 內建項目：無條件存在，依 pod.pluginIds 數量更新描述。
 * 與 Goal Runtime 一樣 system + locked，在前端 popover 內建區塊呈現。
 */
function buildPluginAvailabilityItem(
  pod: Pick<Pod, "pluginIds">,
): PodMcpAvailabilityItem {
  const count = pod.pluginIds.length;
  const description =
    count === 0
      ? "Bundle MCP 可用，但目前未啟用任何 skill bundle"
      : `已啟用 ${count} 個 skill bundle`;
  return {
    key: "canvas:system:agent_canvas_plugin",
    name: "agent_canvas_plugin",
    source: "canvas",
    transport: "stdio",
    status: "healthy",
    selected: true,
    selectable: false,
    disabledReason: null,
    lastError: null,
    system: true,
    locked: true,
    description,
  };
}

function buildAgentCanvasAvailabilityItem(
  pod: Pick<Pod, "agentCanvasMcpEnabled">,
): PodMcpAvailabilityItem {
  return {
    key: "canvas:system:agent_canvas",
    name: "agent_canvas",
    source: "canvas",
    transport: "stdio",
    status: "healthy",
    selected: pod.agentCanvasMcpEnabled,
    selectable: true,
    disabledReason: null,
    lastError: null,
    system: true,
    locked: false,
    description: "只限目前 Canvas 與 Run 的 Workflow 執行工具",
  };
}

function buildCodexAvailabilityItem(
  entry: CodexMcpRuntimeEntry,
  selectedKeys: ReadonlySet<string>,
): PodMcpAvailabilityItem {
  return {
    key: entry.key,
    name: entry.name,
    source: entry.source,
    transport: entry.transport,
    status: entry.globallyEnabled ? "healthy" : "disabled",
    selected: entry.globallyEnabled && selectedKeys.has(entry.key),
    selectable: entry.globallyEnabled,
    disabledReason: null,
    ...(entry.globallyEnabled
      ? {}
      : ({ disabledReasonKey: "codexGloballyDisabled" } as const)),
    lastError: null,
  };
}

function resolveDisabledReason(entry: ManagedMcpServerRecord): string | null {
  if (entry.requiresSecretSetup) {
    return "缺少秘密環境變數，請重新設定 MCP 憑證";
  }
  if (!entry.enabled) {
    return "registry entry disabled";
  }
  return null;
}

export class ManagedMcpAvailabilityService {
  constructor(private readonly deps: AvailabilityDeps) {}

  listForPod(
    pod: Pick<
      Pod,
      | "id"
      | "name"
      | "goal"
      | "mcpServerNames"
      | "pluginIds"
      | "agentCanvasMcpEnabled"
      | "codexMcpServerKeys"
    >,
    codexEntries: readonly CodexMcpRuntimeEntry[] = [],
  ): PodMcpAvailabilityItem[] {
    const selectedNames = new Set(pod.mcpServerNames);
    const selectedCodexKeys = new Set(pod.codexMcpServerKeys ?? []);
    const registry = this.deps.store.list();
    const registryByName = new Map(
      registry.map((entry) => [entry.name, entry]),
    );

    const items: PodMcpAvailabilityItem[] = [
      buildGoalAvailabilityItem(pod),
      buildPluginAvailabilityItem(pod),
      buildAgentCanvasAvailabilityItem(pod),
      ...codexEntries.map((entry) =>
        buildCodexAvailabilityItem(entry, selectedCodexKeys),
      ),
      ...registry.map((entry) => {
        const runtimeSnapshot = this.deps.runtimeService.getRuntimeSnapshot(
          entry.name,
        );
        const disabledReason = resolveDisabledReason(entry);
        return {
          key: `canvas:managed:${entry.name}`,
          name: entry.name,
          source: "canvas",
          transport: entry.transport,
          status:
            disabledReason !== null
              ? "disabled"
              : (runtimeSnapshot?.status ?? entry.lastKnownStatus),
          selected: selectedNames.has(entry.name),
          selectable: disabledReason === null,
          disabledReason,
          lastError: runtimeSnapshot?.lastError ?? entry.lastError,
        } satisfies PodMcpAvailabilityItem;
      }),
    ];

    for (const selectedName of selectedNames) {
      if (registryByName.has(selectedName)) continue;
      items.push({
        key: `canvas:managed:${selectedName}`,
        name: selectedName,
        source: "canvas",
        transport: "stdio",
        status: "error",
        selected: true,
        selectable: false,
        disabledReason: "registry entry removed",
        lastError: "registry entry removed",
      });
    }

    return items;
  }
}

export function createManagedMcpAvailabilityService(
  deps?: Partial<AvailabilityDeps>,
): ManagedMcpAvailabilityService {
  return new ManagedMcpAvailabilityService({
    store: deps?.store ?? managedMcpStore,
    runtimeService: deps?.runtimeService ?? managedMcpRuntimeService,
  });
}

export const managedMcpAvailabilityService =
  createManagedMcpAvailabilityService();
