import type { Connection, TriggerMode, AutoTriggerMode } from '../../types/index.js';
import type { RunContext } from '../../types/run.js';

export interface TriggerDecideContext {
  canvasId: string;
  sourcePodId: string;
  connections: Connection[];
}

export interface TriggerDecideResult {
  connectionId: string;
  approved: boolean;
  reason: string | null;
  isError: boolean;
}

export interface CollectSourcesContext {
  canvasId: string;
  sourcePodId: string;
  connection: Connection;
  summary: string;
  runContext?: RunContext;
}

export interface CollectSourcesResult {
  ready: boolean;
  mergedContent?: string;
  isSummarized?: boolean;
  participatingConnectionIds?: string[];
}

export interface TriggerLifecycleContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  summary: string;
  isSummarized: boolean;
  participatingConnectionIds: string[];
  runContext?: RunContext;
}

export interface QueuedContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  position: number;
  queueSize: number;
  triggerMode: TriggerMode;
  participatingConnectionIds: string[];
  runContext?: RunContext;
}

export interface QueueProcessedContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  remainingQueueSize: number;
  triggerMode: TriggerMode;
  participatingConnectionIds: string[];
  runContext?: RunContext;
}

export interface CompletionContext {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  triggerMode: TriggerMode;
  participatingConnectionIds: string[];
  runContext?: RunContext;
}

export interface TriggerStrategy {
  mode: TriggerMode;

  decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]>;

  collectSources?(context: CollectSourcesContext): Promise<CollectSourcesResult>;

  onTrigger(context: TriggerLifecycleContext): void;
  onComplete(context: CompletionContext, success: boolean, error?: string): void;
  onError(context: CompletionContext, errorMessage: string): void;

  onQueued(context: QueuedContext): void;
  onQueueProcessed(context: QueueProcessedContext): void;
}

export interface PipelineContext {
  canvasId: string;
  sourcePodId: string;
  connection: Connection;
  triggerMode: TriggerMode;
  decideResult: TriggerDecideResult;
  runContext?: RunContext;
}

export interface TriggerWorkflowWithSummaryParams {
  canvasId: string;
  connectionId: string;
  summary: string;
  isSummarized: boolean;
  participatingConnectionIds: string[] | undefined;
  strategy: TriggerStrategy;
  runContext?: RunContext;
}

export interface ExecutionServiceMethods {
  generateSummaryWithFallback(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    runContext?: RunContext
  ): Promise<{ content: string; isSummarized: boolean } | null>;

  triggerWorkflowWithSummary(params: TriggerWorkflowWithSummaryParams): Promise<void>;
}

export interface StateServiceMethods {
  checkMultiInputScenario(canvasId: string, targetPodId: string): {
    isMultiInput: boolean;
    requiredSourcePodIds: string[];
  };
}

export interface HandleMultiInputForConnectionParams {
  canvasId: string;
  sourcePodId: string;
  connection: Connection;
  requiredSourcePodIds: string[];
  summary: string;
  triggerMode: AutoTriggerMode;
  runContext?: RunContext;
}

export interface MultiInputServiceMethods {
  handleMultiInputForConnection(params: HandleMultiInputForConnectionParams): Promise<void>;
}

export interface QueueServiceMethods {
  enqueue(item: {
    canvasId: string;
    connectionId: string;
    sourcePodId: string;
    targetPodId: string;
    summary: string;
    isSummarized: boolean;
    triggerMode: TriggerMode;
    participatingConnectionIds?: string[];
    runContext?: RunContext;
  }): { position: number; queueSize: number };

  processNextInQueue(canvasId: string, targetPodId: string): Promise<void>;
}

export interface PipelineMethods {
  execute(context: PipelineContext, strategy: TriggerStrategy): Promise<void>;
}

export interface AiDecideMethods {
  processAiDecideConnections(canvasId: string, sourcePodId: string, connections: Connection[], runContext?: RunContext): Promise<void>;
}

export interface AutoTriggerMethods {
  processAutoTriggerConnection(canvasId: string, sourcePodId: string, connection: Connection, runContext?: RunContext): Promise<void>;
  getLastAssistantMessage(sourcePodId: string, runContext?: RunContext): string | null;
}
