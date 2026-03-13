export { workflowEventEmitter } from './workflowEventEmitter.js';
export { workflowStateService } from './workflowStateService.js';
export { workflowExecutionService } from './workflowExecutionService.js';
export { workflowAutoTriggerService } from './workflowAutoTriggerService.js';
export { workflowMultiInputService } from './workflowMultiInputService.js';
export { workflowDirectTriggerService } from './workflowDirectTriggerService.js';
export { workflowAiDecideTriggerService } from './workflowAiDecideTriggerService.js';
export { aiDecideService } from './aiDecideService.js';
export { aiDecidePromptBuilder } from './aiDecidePromptBuilder.js';
export { workflowQueueService } from './workflowQueueService.js';
export { workflowPipeline } from './workflowPipeline.js';
export { runExecutionService } from './runExecutionService.js';
export type * from './types.js';

import { workflowPipeline } from './workflowPipeline.js';
import { workflowAutoTriggerService } from './workflowAutoTriggerService.js';
import { workflowAiDecideTriggerService } from './workflowAiDecideTriggerService.js';
import { workflowDirectTriggerService } from './workflowDirectTriggerService.js';
import { workflowMultiInputService } from './workflowMultiInputService.js';
import { workflowExecutionService } from './workflowExecutionService.js';
import { workflowQueueService } from './workflowQueueService.js';
import { workflowStateService } from './workflowStateService.js';
import { workflowEventEmitter } from './workflowEventEmitter.js';
import { aiDecideService } from './aiDecideService.js';
import { connectionStore } from '../connectionStore.js';
import { podStore } from '../podStore.js';
import { pendingTargetStore } from '../pendingTargetStore.js';
export function initWorkflowServices(): void {
  workflowPipeline.init({
    executionService: workflowExecutionService,
    stateService: workflowStateService,
    multiInputService: workflowMultiInputService,
    queueService: workflowQueueService,
  });

  workflowAutoTriggerService.init({ pipeline: workflowPipeline });

  workflowAiDecideTriggerService.init({
    aiDecideService,
    eventEmitter: workflowEventEmitter,
    connectionStore,
    podStore,
    stateService: workflowStateService,
    pendingTargetStore,
    pipeline: workflowPipeline,
    multiInputService: workflowMultiInputService,
  });

  workflowMultiInputService.init({
    executionService: workflowExecutionService,
    strategies: {
      auto: workflowAutoTriggerService,
      direct: workflowDirectTriggerService,
      'ai-decide': workflowAiDecideTriggerService,
    },
  });

  workflowQueueService.init({
    executionService: workflowExecutionService,
    strategies: {
      auto: workflowAutoTriggerService,
      direct: workflowDirectTriggerService,
      'ai-decide': workflowAiDecideTriggerService,
    },
  });

  workflowExecutionService.init({
    pipeline: workflowPipeline,
    aiDecideTriggerService: workflowAiDecideTriggerService,
    autoTriggerService: workflowAutoTriggerService,
    directTriggerService: workflowDirectTriggerService,
  });
}

initWorkflowServices();
