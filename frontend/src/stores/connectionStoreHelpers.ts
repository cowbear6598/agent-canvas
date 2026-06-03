import type {
  Connection,
  ConnectionStatus,
  DecideStatus,
} from "@/types/connection";

export function castHandler<T>(
  handler: (payload: T) => void,
): (payload: unknown) => void {
  return handler as (payload: unknown) => void;
}

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
  if (connection.direct) return false;
  if (isOutOfOrderUpdate(connection.decideStatus, status)) return false;
  return true;
}
