import { MAX_RUNS_PER_CANVAS } from "@/lib/constants";
import type { WorkflowRun } from "@/types/run";
import type { RunHistoryResultPayload } from "@/types/websocket/responses";

export function normalizeRunHistoryResponse(
  response: Pick<RunHistoryResultPayload, "success" | "runs">,
): Map<string, WorkflowRun> | null {
  if (!response.success || !response.runs) return null;

  return new Map(
    response.runs
      .slice(0, MAX_RUNS_PER_CANVAS)
      .map((run): [string, WorkflowRun] => [run.id, run]),
  );
}
