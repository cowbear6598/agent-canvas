import type {
  Connection,
  TriggerMode,
  AutoTriggerMode,
} from "../../types/index.js";
import type { RunContext } from "../../types/run.js";
import type { WorkflowStatusDelegate } from "./workflowStatusDelegate.js";
import type { ProviderName } from "../provider/index.js";

/** settle 階段的路徑類別。branch settle 時歸類為 'auto' */
export type SettlementPathway = "auto" | "direct";

export interface TriggerDecideContext {
  canvasId: string;
  sourcePodId: string;
  connections: Connection[];
  runContext?: RunContext;
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

  collectSources?(
    context: CollectSourcesContext,
  ): Promise<CollectSourcesResult>;

  onTrigger(context: TriggerLifecycleContext): void;
  onComplete(
    context: CompletionContext,
    success: boolean,
    error?: string,
  ): void;
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
  delegate: WorkflowStatusDelegate;
}

export interface TriggerWorkflowWithSummaryParams {
  canvasId: string;
  connectionId: string;
  summary: string;
  isSummarized: boolean;
  participatingConnectionIds: string[] | undefined;
  strategy: TriggerStrategy;
  runContext?: RunContext;
  delegate?: WorkflowStatusDelegate;
}

export interface ExecutionServiceMethods {
  generateSummaryWithFallback(
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    provider: ProviderName,
    summaryModel: string,
    runContext: RunContext,
    pathway?: SettlementPathway,
    delegate?: WorkflowStatusDelegate,
  ): Promise<{
    content: string;
    isSummarized: boolean;
    /** disposableChatService 實際使用的模型；fallback 路徑下為 undefined */
    resolvedModel?: string;
  } | null>;

  triggerWorkflowWithSummary(
    params: TriggerWorkflowWithSummaryParams,
  ): Promise<void>;
}

export interface StateServiceMethods {
  checkMultiInputScenario(
    canvasId: string,
    targetPodId: string,
  ): {
    isMultiInput: boolean;
    requiredSourcePodIds: string[];
  };
}

export interface HandleMultiInputForConnectionParams {
  canvasId: string;
  sourcePodId: string;
  connection: Connection;
  summary: string;
  triggerMode: AutoTriggerMode;
  runContext?: RunContext;
}

export interface MultiInputServiceMethods {
  handleMultiInputForConnection(
    params: HandleMultiInputForConnectionParams,
  ): Promise<void>;
}

export interface PipelineMethods {
  execute(context: PipelineContext, strategy: TriggerStrategy): Promise<void>;
}

export interface BranchTriggerMethods {
  processBranchConnections(
    canvasId: string,
    sourcePodId: string,
    connections: Connection[],
    runContext?: RunContext,
  ): Promise<void>;
}

export interface AutoTriggerMethods {
  processAutoTriggerConnection(
    canvasId: string,
    sourcePodId: string,
    connection: Connection,
    runContext?: RunContext,
  ): Promise<void>;
  getLastAssistantMessage(
    sourcePodId: string,
    runContext: RunContext,
  ): string | null;
}
