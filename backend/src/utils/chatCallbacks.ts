import { socketService } from '../services/socketService.js';
import { workflowExecutionService } from '../services/workflow/index.js';
import { runExecutionService } from '../services/workflow/runExecutionService.js';
import { fireAndForget } from './operationHelpers.js';
import { logger } from './logger.js';
import { WebSocketResponseEvents } from '../schemas/index.js';
import type { PodChatAbortedPayload } from '../types/index.js';
import type { RunContext } from '../types/run.js';

export const onChatComplete = (canvasId: string, podId: string): void => {
  fireAndForget(
    workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId),
    'Workflow',
    `檢查 Pod「${podId}」自動觸發 Workflow 失敗`,
  );
};

export const onRunChatComplete = (runContext: RunContext, canvasId: string, podId: string): void => {
  // source pod 在 calculatePathways 中固定只有 auto pathway（directPathwaySettled 為 null），因此固定傳 'auto'
  runExecutionService.settlePodTrigger(runContext, podId, 'auto');
  fireAndForget(
    workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId, runContext),
    'Workflow',
    `檢查 Pod「${podId}」自動觸發 Workflow 失敗 (Run: ${runContext.runId})`,
  );
};

export function onChatAborted(canvasId: string, podId: string, messageId: string, podName: string): void {
  const abortedPayload: PodChatAbortedPayload = { canvasId, podId, messageId };
  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_ABORTED, abortedPayload);
  logger.log('Chat', 'Abort', `Pod「${podName}」對話已中斷`);
}
