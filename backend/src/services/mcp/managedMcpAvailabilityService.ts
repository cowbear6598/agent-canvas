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
    name: item.name,
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
 * Plugin MCP 內建項目：無條件存在，依 pod.pluginIds 數量更新描述。
 * 與 Goal Runtime 一樣 system + locked，在前端 popover 內建區塊呈現。
 */
function buildPluginAvailabilityItem(
  pod: Pick<Pod, "pluginIds">,
): PodMcpAvailabilityItem {
  const count = pod.pluginIds.length;
  const description =
    count === 0
      ? "Plugin MCP 可用，但目前未勾選任何 plugin"
      : `已勾選 ${count} 個 plugin`;
  return {
    name: "agent_canvas_plugin",
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

function resolveDisabledReason(entry: ManagedMcpServerRecord): string | null {
  if (!entry.enabled) {
    return "registry entry disabled";
  }
  return null;
}

export class ManagedMcpAvailabilityService {
  constructor(private readonly deps: AvailabilityDeps) {}

  listForPod(
    pod: Pick<Pod, "id" | "name" | "goal" | "mcpServerNames" | "pluginIds">,
  ): PodMcpAvailabilityItem[] {
    const selectedNames = new Set(pod.mcpServerNames);
    const registry = this.deps.store.list();
    const registryByName = new Map(
      registry.map((entry) => [entry.name, entry]),
    );

    const items: PodMcpAvailabilityItem[] = [
      buildGoalAvailabilityItem(pod),
      buildPluginAvailabilityItem(pod),
      ...registry.map((entry) => {
        const runtimeSnapshot = this.deps.runtimeService.getRuntimeSnapshot(
          entry.name,
        );
        const disabledReason = resolveDisabledReason(entry);
        return {
          name: entry.name,
          transport: entry.transport,
          status:
            disabledReason === "registry entry disabled"
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
        name: selectedName,
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
