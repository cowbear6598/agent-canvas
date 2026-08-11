import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/types/websocket/events";
import type {
  ManagedMcpRegistryDeletePayload,
  ManagedMcpRegistryListPayload,
  ManagedMcpRegistrySavePayload,
  ManagedMcpRegistryTestPayload,
  PodMcpAvailabilityListPayload,
} from "@/types/websocket/requests";
import type {
  ManagedMcpRegistryDeletedPayload,
  ManagedMcpRegistryListResultPayload,
  ManagedMcpRegistrySavedPayload,
  ManagedMcpRegistryTestResultPayload,
  PodMcpAvailabilityListResultPayload,
} from "@/types/websocket/responses";
import type {
  ManagedMcpRegistryInput,
  ManagedMcpRegistryItem,
  McpDisplayStatus,
  PodMcpAvailabilityItem,
} from "@/types/mcp";
import type { PodProvider } from "@/types/pod";

const MANAGED_MCP_CACHE_TTL_MS = 30 * 1000;
const MANAGED_MCP_AVAILABILITY_CACHE_MAX_SIZE = 32;
const KNOWN_MCP_PROVIDERS = new Set(["claude", "codex", "opencode"] as const);

type KnownMcpProvider = "claude" | "codex" | "opencode";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

let managedMcpRegistryCache: CacheEntry<ManagedMcpRegistryItem[]> | null = null;
const podMcpAvailabilityCache = new Map<
  string,
  CacheEntry<PodMcpAvailabilityItem[]>
>();

function buildPodMcpAvailabilityCacheKey(
  podId: string,
  provider?: PodProvider,
): string {
  const normalizedProvider =
    provider && KNOWN_MCP_PROVIDERS.has(provider as KnownMcpProvider)
      ? provider
      : "unknown";
  return `${normalizedProvider}::${podId}`;
}

export async function listManagedMcpRegistry(): Promise<
  ManagedMcpRegistryItem[]
> {
  if (
    managedMcpRegistryCache &&
    Date.now() < managedMcpRegistryCache.expiresAt
  ) {
    return managedMcpRegistryCache.data;
  }

  const result = await createWebSocketRequest<
    ManagedMcpRegistryListPayload,
    ManagedMcpRegistryListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_LIST,
    responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
    payload: {},
  });

  const data = result.items;
  managedMcpRegistryCache = {
    data,
    expiresAt: Date.now() + MANAGED_MCP_CACHE_TTL_MS,
  };
  return data;
}

export async function saveManagedMcpRegistry(
  registry: ManagedMcpRegistryInput,
): Promise<ManagedMcpRegistryItem> {
  const result = await createWebSocketRequest<
    ManagedMcpRegistrySavePayload,
    ManagedMcpRegistrySavedPayload
  >({
    requestEvent: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_SAVE,
    responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
    payload: { registry },
  });

  invalidateManagedMcpRegistryCache();
  invalidatePodMcpAvailabilityCache();

  return result.item;
}

export async function deleteManagedMcpRegistry(
  registryId: string,
): Promise<void> {
  await createWebSocketRequest<
    ManagedMcpRegistryDeletePayload,
    ManagedMcpRegistryDeletedPayload
  >({
    requestEvent: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_DELETE,
    responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
    payload: { registryId },
  });

  invalidateManagedMcpRegistryCache();
  invalidatePodMcpAvailabilityCache();
}

export interface ManagedMcpRegistryTestOutcome {
  status: McpDisplayStatus;
  lastError: string | null;
}

export async function testManagedMcpRegistry(
  registryId: string,
): Promise<ManagedMcpRegistryTestOutcome> {
  const result = await createWebSocketRequest<
    ManagedMcpRegistryTestPayload,
    ManagedMcpRegistryTestResultPayload
  >({
    requestEvent: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_TEST,
    responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
    payload: { registryId },
  });

  invalidateManagedMcpRegistryCache();
  invalidatePodMcpAvailabilityCache();

  return {
    status: result.status,
    lastError: result.lastError,
  };
}

export async function listPodMcpAvailability(
  podId: string,
  provider?: PodProvider,
): Promise<PodMcpAvailabilityItem[]> {
  const normalizedPodId = podId.trim();
  if (!normalizedPodId) return [];

  const normalizedProvider =
    provider && KNOWN_MCP_PROVIDERS.has(provider as KnownMcpProvider)
      ? (provider as KnownMcpProvider)
      : undefined;

  const cacheKey = buildPodMcpAvailabilityCacheKey(
    normalizedPodId,
    normalizedProvider,
  );
  const cached = podMcpAvailabilityCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const result = await createWebSocketRequest<
    PodMcpAvailabilityListPayload,
    PodMcpAvailabilityListResultPayload
  >({
    requestEvent: WebSocketRequestEvents.POD_MCP_AVAILABILITY_LIST,
    responseEvent: WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT,
    payload: {
      podId: normalizedPodId,
      ...(normalizedProvider ? { provider: normalizedProvider } : {}),
    },
  });

  const data = result.items;

  if (podMcpAvailabilityCache.size >= MANAGED_MCP_AVAILABILITY_CACHE_MAX_SIZE) {
    const oldestKey = podMcpAvailabilityCache.keys().next().value;
    if (oldestKey !== undefined) {
      podMcpAvailabilityCache.delete(oldestKey);
    }
  }

  podMcpAvailabilityCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + MANAGED_MCP_CACHE_TTL_MS,
  });

  return data;
}

export function invalidateManagedMcpRegistryCache(): void {
  managedMcpRegistryCache = null;
}

function deletePodMcpAvailabilityCacheEntries(
  matches: (key: string) => boolean,
): void {
  for (const key of podMcpAvailabilityCache.keys()) {
    if (matches(key)) podMcpAvailabilityCache.delete(key);
  }
}

export function invalidatePodMcpAvailabilityCache(
  provider?: PodProvider,
  podId?: string,
): void {
  if (!provider && !podId) {
    podMcpAvailabilityCache.clear();
    return;
  }

  if (podId) {
    const explicitKey = buildPodMcpAvailabilityCacheKey(podId, provider);
    podMcpAvailabilityCache.delete(explicitKey);

    if (!provider) {
      const suffix = `::${podId}`;
      deletePodMcpAvailabilityCacheEntries((key) => key.endsWith(suffix));
    }
    return;
  }

  if (!provider) return;

  const prefix = `${provider}::`;
  deletePodMcpAvailabilityCacheEntries((key) => key.startsWith(prefix));
}
