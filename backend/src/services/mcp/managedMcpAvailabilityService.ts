import type { PodMcpAvailabilityItem } from "../../schemas/mcpSchemas.js";
import { buildGoalRuntimeMcpListItem } from "../goalRuntime.js";
import {
  managedMcpStore,
  type ManagedMcpServerRecord,
  type ManagedMcpTransport,
} from "./managedMcpStore.js";
import {
  managedMcpRuntimeService,
  type ManagedMcpRuntimeSnapshot,
} from "./managedMcpRuntimeService.js";
import type { ProviderName } from "../provider/index.js";
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

const TRANSPORT_SUPPORT: Record<ProviderName, ReadonlySet<ManagedMcpTransport>> =
  {
    claude: new Set(["stdio"]),
    codex: new Set(["stdio", "http"]),
    opencode: new Set(["stdio", "http", "sse"]),
  };

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

function resolveDisabledReason(
  provider: ProviderName,
  entry: ManagedMcpServerRecord,
): string | null {
  if (!entry.enabled) {
    return "registry entry disabled";
  }

  if (!TRANSPORT_SUPPORT[provider].has(entry.transport)) {
    return `${provider} does not support ${entry.transport} transport`;
  }

  return null;
}

export class ManagedMcpAvailabilityService {
  constructor(private readonly deps: AvailabilityDeps) {}

  listForPod(
    pod: Pick<Pod, "id" | "name" | "goal" | "provider" | "mcpServerNames">,
    providerOverride?: ProviderName,
  ): PodMcpAvailabilityItem[] {
    const provider = providerOverride ?? pod.provider;
    const selectedNames = new Set(pod.mcpServerNames);
    const registry = this.deps.store.list();
    const registryByName = new Map(registry.map((entry) => [entry.name, entry]));

    const items: PodMcpAvailabilityItem[] = [
      buildGoalAvailabilityItem(pod),
      ...registry.map((entry) => {
        const runtimeSnapshot = this.deps.runtimeService.getRuntimeSnapshot(
          entry.name,
        );
        const disabledReason = resolveDisabledReason(provider, entry);
        return {
          name: entry.name,
          transport: entry.transport,
          status:
            disabledReason === "registry entry disabled"
              ? "disabled"
              : runtimeSnapshot?.status ?? entry.lastKnownStatus,
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
