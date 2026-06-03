import { fireAndForget } from "../../utils/operationHelpers.js";

export class WorkflowAsyncDispatchService {
  dispatchConnectionQuery(
    promise: Promise<void>,
    connectionId: string,
  ): void {
    fireAndForget(
      promise,
      "Workflow",
      `executeClaudeQuery 執行失敗 (connection: ${connectionId})`,
    );
  }

  dispatchDownstreamTrigger(promise: Promise<void>, targetPodId: string): void {
    fireAndForget(
      promise,
      "Workflow",
      `下游 workflow 觸發失敗 (pod: ${targetPodId})`,
    );
  }

  dispatchMergedWorkflow(promise: Promise<void>, connectionId: string): void {
    fireAndForget(promise, "Workflow", `觸發合併工作流程失敗 ${connectionId}`);
  }

  dispatchRunQueueProcess(
    promise: Promise<void>,
    runId: string,
    targetPodId: string,
  ): void {
    fireAndForget(
      promise,
      "Run",
      `[RunDelegate] 處理 Run 佇列下一項時發生錯誤 (run=${runId}, pod=${targetPodId})`,
    );
  }
}

export const workflowAsyncDispatchService = new WorkflowAsyncDispatchService();
