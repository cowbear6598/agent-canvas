import { socketService } from '../services/socketService.js';
import { workflowExecutionService } from '../services/workflow/index.js';
import { runExecutionService } from '../services/workflow/runExecutionService.js';
import { logger } from './logger.js';
import { WebSocketResponseEvents } from '../schemas/index.js';
import type { PodChatAbortedPayload } from '../types/index.js';
import type { RunContext } from '../types/run.js';

export const onChatComplete = async (canvasId: string, podId: string): Promise<void> => {
  workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId).catch((error) => {
    logger.error('Workflow', 'Error', `檢查 Pod「${podId}」自動觸發 Workflow 失敗`, error);
  });
};

export const onRunChatComplete = async (runContext: RunContext, canvasId: string, podId: string): Promise<void> => {
  runExecutionService.completePodInstance(runContext, podId);
  workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId, runContext).catch((error) => {
    logger.error('Workflow', 'Error', `檢查 Pod「${podId}」自動觸發 Workflow 失敗 (Run: ${runContext.runId})`, error);
  });
};

export function onChatAborted(canvasId: string, podId: string, messageId: string, podName: string): void {
  const abortedPayload: PodChatAbortedPayload = { canvasId, podId, messageId };
  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_ABORTED, abortedPayload);
  logger.log('Chat', 'Abort', `Pod「${podName}」對話已中斷`);
}
