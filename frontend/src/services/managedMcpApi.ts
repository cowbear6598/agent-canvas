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
  McpTransport,
  PodMcpAvailabilityItem,
} from "@/types/mcp";
import type { PodProvider } from "@/types/pod";

const MANAGED_MCP_CACHE_TTL_MS = 30 * 1000;
const MANAGED_MCP_AVAILABILITY_CACHE_MAX_SIZE = 32;
const KNOWN_MCP_PROVIDERS = new Set(["claude", "codex", "opencode"] as const);
const MCP_TRANSPORTS = new Set(["stdio", "http", "sse"] as const);
const MCP_STATUSES = new Set([
  "healthy",
  "starting",
  "error",
  "idle",
  "disabled",
  "unknown",
  "running",
  "blocked",
  "completed",
] as const);

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

function normalizeTransport(raw: unknown): McpTransport | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return MCP_TRANSPORTS.has(normalized as McpTransport)
    ? (normalized as McpTransport)
    : null;
}

function normalizeStatus(raw: unknown): McpDisplayStatus | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  return MCP_STATUSES.has(normalized as McpDisplayStatus)
    ? (normalized as McpDisplayStatus)
    : undefined;
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function normalizeStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function normalizeNullableString(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null;
}

function normalizeManagedMcpRegistryItem(
  item: unknown,
): ManagedMcpRegistryItem | null {
  if (!item || typeof item !== "object") return null;

  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const transport = normalizeTransport(raw.transport);
  if (!id || !name || !transport) return null;

  return {
    id,
    name,
    transport,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    command: normalizeNullableString(raw.command),
    args: normalizeStringArray(raw.args),
    cwd: normalizeNullableString(raw.cwd),
    env: normalizeStringRecord(raw.env),
    url: normalizeNullableString(raw.url),
    status: normalizeStatus(raw.status ?? raw.last_known_status) ?? "unknown",
    lastError: normalizeNullableString(raw.lastError ?? raw.last_error),
    createdAt: normalizeNullableString(raw.createdAt ?? raw.created_at),
    updatedAt: normalizeNullableString(raw.updatedAt ?? raw.updated_at),
    ...(typeof raw.requiresSecretSetup === "boolean"
      ? { requiresSecretSetup: raw.requiresSecretSetup }
      : {}),
  };
}

function normalizeManagedMcpRegistryItems(
  items: unknown,
): ManagedMcpRegistryItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => normalizeManagedMcpRegistryItem(item))
    .filter((item): item is ManagedMcpRegistryItem => item !== null);
}

function normalizePodMcpAvailabilityItem(
  item: unknown,
): PodMcpAvailabilityItem | null {
  if (!item || typeof item !== "object") return null;

  const raw = item as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const transport = normalizeTransport(raw.transport ?? raw.type);
  if (!name) return null;
  const status = normalizeStatus(raw.status);

  return {
    name,
    ...(transport ? { transport } : {}),
    ...(status ? { status } : {}),
    ...(typeof raw.selected === "boolean" ? { selected: raw.selected } : {}),
    ...(typeof raw.selectable === "boolean"
      ? { selectable: raw.selectable }
      : {}),
    ...(typeof raw.disabledReason === "string" || raw.disabledReason === null
      ? { disabledReason: raw.disabledReason as string | null }
      : {}),
    ...(typeof raw.lastError === "string" ||
    raw.lastError === null ||
    typeof raw.last_error === "string" ||
    raw.last_error === null
      ? {
          lastError:
            raw.lastError !== undefined
              ? (raw.lastError as string | null)
              : (raw.last_error as string | null),
        }
      : {}),
    ...(typeof raw.system === "boolean" ? { system: raw.system } : {}),
    ...(typeof raw.locked === "boolean" ? { locked: raw.locked } : {}),
    ...(typeof raw.description === "string"
      ? { description: raw.description }
      : {}),
    ...(typeof raw.activeTodoId === "string" || raw.activeTodoId === null
      ? { activeTodoId: raw.activeTodoId as string | null }
      : {}),
    ...(typeof raw.activeTodoText === "string" || raw.activeTodoText === null
      ? { activeTodoText: raw.activeTodoText as string | null }
      : {}),
    ...(typeof raw.nextTodoId === "string" || raw.nextTodoId === null
      ? { nextTodoId: raw.nextTodoId as string | null }
      : {}),
    ...(typeof raw.nextTodoText === "string" || raw.nextTodoText === null
      ? { nextTodoText: raw.nextTodoText as string | null }
      : {}),
    ...(typeof raw.blockedReason === "string" || raw.blockedReason === null
      ? { blockedReason: raw.blockedReason as string | null }
      : {}),
    ...(typeof raw.handoffSummary === "string" || raw.handoffSummary === null
      ? { handoffSummary: raw.handoffSummary as string | null }
      : {}),
    ...(Array.isArray(raw.completedTodoIds) &&
    raw.completedTodoIds.every((id) => typeof id === "string")
      ? { completedTodoIds: [...raw.completedTodoIds] }
      : {}),
    ...(typeof raw.completedCount === "number"
      ? { completedCount: raw.completedCount }
      : {}),
    ...(typeof raw.totalCount === "number"
      ? { totalCount: raw.totalCount }
      : {}),
  };
}

function normalizePodMcpAvailabilityItems(
  items: unknown,
): PodMcpAvailabilityItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => normalizePodMcpAvailabilityItem(item))
    .filter((item): item is PodMcpAvailabilityItem => item !== null);
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

  const data = normalizeManagedMcpRegistryItems(result.items);
  managedMcpRegistryCache = {
    data,
    expiresAt: Date.now() + MANAGED_MCP_CACHE_TTL_MS,
  };
  return data;
}

export async function saveManagedMcpRegistry(
  registry: ManagedMcpRegistryInput,
): Promise<ManagedMcpRegistryItem | null> {
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

  return result.item ? normalizeManagedMcpRegistryItem(result.item) : null;
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
    status: normalizeStatus(result.status) ?? "unknown",
    lastError: normalizeNullableString(result.lastError ?? null),
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

  const data = normalizePodMcpAvailabilityItems(result.items);

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
      for (const key of podMcpAvailabilityCache.keys()) {
        if (key.endsWith(suffix)) {
          podMcpAvailabilityCache.delete(key);
        }
      }
    }
    return;
  }

  if (!provider) return;

  const prefix = `${provider}::`;
  for (const key of podMcpAvailabilityCache.keys()) {
    if (key.startsWith(prefix)) {
      podMcpAvailabilityCache.delete(key);
    }
  }
}
