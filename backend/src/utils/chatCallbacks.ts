import { socketService } from '../services/socketService.js';
import { autoClearService } from '../services/autoClear/index.js';
import { workflowExecutionService } from '../services/workflow/index.js';
import { createPostChatCompleteCallback } from './operationHelpers.js';
import { logger } from './logger.js';
import { WebSocketResponseEvents } from '../schemas/index.js';
import type { PodChatAbortedPayload } from '../types/index.js';

export const onChatComplete = createPostChatCompleteCallback(
  (canvasId, podId) => autoClearService.onPodComplete(canvasId, podId),
  (canvasId, podId) => workflowExecutionService.checkAndTriggerWorkflows(canvasId, podId),
  'AutoClear',
);

export function onChatAborted(canvasId: string, podId: string, messageId: string, podName: string): void {
  const abortedPayload: PodChatAbortedPayload = { canvasId, podId, messageId };
  socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_CHAT_ABORTED, abortedPayload);
  logger.log('Chat', 'Abort', `Pod「${podName}」對話已中斷`);
}
