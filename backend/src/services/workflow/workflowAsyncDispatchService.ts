import { fireAndForget } from "../../utils/operationHelpers.js";
import { logger } from "../../utils/logger.js";

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

  dispatchMergedWorkflow(
    promise: Promise<void>,
    connectionId: string,
    onError: (error: unknown) => void,
  ): void {
    promise.catch((error) => {
      logger.error(
        "Workflow",
        "Error",
        `觸發合併工作流程失敗 ${connectionId}`,
        error,
      );
      onError(error);
    });
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
