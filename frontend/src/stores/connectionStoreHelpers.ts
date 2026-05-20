import type {
  Connection,
  ConnectionStatus,
  DecideStatus,
  TriggerMode,
} from "@/types/connection";
import type { PodProvider } from "@/types/pod";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import { normalizePodProvider } from "@/lib/providerOptions";

export interface RawConnection {
  id: string;
  sourcePodId?: string;
  sourceAnchor: import("@/types/connection").AnchorPosition;
  targetPodId: string;
  targetAnchor: import("@/types/connection").AnchorPosition;
  triggerMode?: "auto" | "branch" | "direct";
  summaryModel?: string;
  summaryProvider?: PodProvider | null;
  label?: string;
  description?: string;
  branchProvider?: PodProvider;
  branchModel?: string;
  connectionStatus?: string;
  decideReason?: string | null;
  decideStatus?: string;
}

export function castHandler<T>(
  handler: (payload: T) => void,
): (payload: unknown) => void {
  return handler as (payload: unknown) => void;
}

export function normalizeConnection(
  raw: RawConnection,
  sourceProvider?: PodProvider,
): Connection {
  const normalizedExplicitProvider =
    raw.summaryProvider == null
      ? null
      : normalizePodProvider(raw.summaryProvider);
  const summaryProvider =
    normalizedExplicitProvider ??
    (raw.summaryModel?.startsWith("gemini-") === true
      ? "claude"
      : (normalizePodProvider(sourceProvider ?? "claude") ?? "claude"));
  const summaryModel =
    raw.summaryModel?.startsWith("gemini-") === true
      ? DEFAULT_SUMMARY_MODEL
      : (raw.summaryModel ?? DEFAULT_SUMMARY_MODEL);

  return {
    ...raw,
    triggerMode: (raw.triggerMode ?? "auto") as TriggerMode,
    summaryModel,
    summaryProvider,
    label: raw.label,
    description: raw.description,
    branchProvider: raw.branchProvider,
    branchModel: raw.branchModel,
    status: (raw.connectionStatus ?? "idle") as ConnectionStatus,
    decideReason: raw.decideReason ?? undefined,
    decideStatus: (raw.decideStatus as DecideStatus) ?? "none",
  };
}

const RUNNING_CONNECTION_STATUSES = new Set<ConnectionStatus>([
  "active",
  "queued",
  "waiting",
]);

/**
 * 事件亂序保護：connection 的 decideStatus 為 pending（AI 決策中）時不允許被 active 事件覆蓋。
 * 否則排程或其他觸發路徑的 active 事件會在 AI 決策期間改變狀態、令決策結果被忽略。
 */
function isOutOfOrderUpdate(
  currentDecideStatus: DecideStatus | undefined,
  incomingStatus: ConnectionStatus,
): boolean {
  return currentDecideStatus === "pending" && incomingStatus === "active";
}

export function shouldUpdateConnection(
  connection: Connection,
  targetPodId: string,
  status: ConnectionStatus,
): boolean {
  if (connection.targetPodId !== targetPodId) return false;
  if (connection.triggerMode !== "auto" && connection.triggerMode !== "branch")
    return false;
  if (isOutOfOrderUpdate(connection.decideStatus, status)) return false;
  return true;
}

/**
 * 使用 BFS 而非 DFS：在循環或極長鏈中不會堆疊溢位，找到第一個執行中節點即提前返回。
 */
function isAnyNeighborRunning(
  neighbors: { neighborId: string; connection: Connection }[],
  visited: Set<string>,
  queue: string[],
): boolean {
  for (const { neighborId, connection } of neighbors) {
    if (
      (connection.status !== undefined &&
        RUNNING_CONNECTION_STATUSES.has(connection.status)) ||
      connection.decideStatus === "pending"
    )
      return true;
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queue.push(neighborId);
    }
  }
  return false;
}

function processBfsNode(
  currentId: string,
  getNeighbors: (
    podId: string,
  ) => { neighborId: string; connection: Connection }[],
  isRunningPod: (podId: string) => boolean,
  visited: Set<string>,
  queue: string[],
): boolean {
  if (isRunningPod(currentId)) return true;
  return isAnyNeighborRunning(getNeighbors(currentId), visited, queue);
}

export function runBFS(
  startId: string,
  getNeighbors: (
    podId: string,
  ) => { neighborId: string; connection: Connection }[],
  isRunningPod: (podId: string) => boolean,
): boolean {
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) break;
    if (processBfsNode(currentId, getNeighbors, isRunningPod, visited, queue))
      return true;
  }
  return false;
}
