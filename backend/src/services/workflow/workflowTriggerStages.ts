import { logger } from "../../utils/logger.js";
import type {
  WorkflowStatusDelegate,
  EnqueueItem,
} from "./workflowStatusDelegate.js";
import type {
  SettlementPathway,
  TriggerWorkflowWithSummaryParams,
  TriggerStrategy,
} from "./types.js";
import { resolveSettlementPathway } from "./workflowHelpers.js";
import type { ProviderName } from "../provider/index.js";

export async function runWorkflowSummaryStage(params: {
  canvasId: string;
  sourcePodId: string;
  targetPodId: string;
  provider: ProviderName;
  summaryModel: string;
  summaryThinkingLevel: string | null;
  runContext: TriggerWorkflowWithSummaryParams["runContext"];
  pathway: SettlementPathway;
  delegate: WorkflowStatusDelegate;
  generateSummaryWithFallback: (
    canvasId: string,
    sourcePodId: string,
    targetPodId: string,
    provider: ProviderName,
    summaryModel: string,
    summaryThinkingLevel: string | null,
    runContext: TriggerWorkflowWithSummaryParams["runContext"],
    pathway?: SettlementPathway,
    delegate?: WorkflowStatusDelegate,
  ) => Promise<{
    content: string;
    isSummarized: boolean;
    resolvedModel?: string;
  } | null>;
}): Promise<{
  content: string;
  isSummarized: boolean;
  resolvedModel?: string;
} | null> {
  const summaryResult = await params.generateSummaryWithFallback(
    params.canvasId,
    params.sourcePodId,
    params.targetPodId,
    params.provider,
    params.summaryModel,
    params.summaryThinkingLevel,
    params.runContext,
    params.pathway,
    params.delegate,
  );

  if (summaryResult) {
    return summaryResult;
  }

  logger.error(
    "Workflow",
    "Pipeline",
    "[generateSummary] 無法生成摘要或取得備用內容",
  );
  params.delegate.onSummaryFailed(
    params.canvasId,
    params.targetPodId,
    "無法生成摘要或取得備用內容",
  );
  return null;
}

export function enqueueWorkflowTriggerStage(
  delegate: WorkflowStatusDelegate,
  item: EnqueueItem,
): boolean {
  if (!delegate.isBusy(item.canvasId, item.targetPodId)) {
    return false;
  }

  logger.log("Workflow", "Pipeline", "[checkQueue] 目標 Pod 忙碌中，加入佇列");
  delegate.enqueue(item);
  delegate.scheduleNextInQueue(item.canvasId, item.targetPodId);
  return true;
}

export function launchWorkflowChatStage(params: {
  canvasId: string;
  connectionId: string;
  beforeLaunch: () => void;
  createQueryPromise: () => Promise<void>;
  dispatchConnectionQuery: (
    promise: Promise<void>,
    connectionId: string,
  ) => void;
}): void {
  params.beforeLaunch();

  params.dispatchConnectionQuery(
    params.createQueryPromise(),
    params.connectionId,
  );
}

export async function completeWorkflowChatStage(params: {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  triggerMode: TriggerWorkflowWithSummaryParams["triggerMode"];
  participatingConnectionIds: string[];
  sourcePodIds?: string[];
  sourcePodNames?: string[];
  strategy: TriggerStrategy;
  runContext: TriggerWorkflowWithSummaryParams["runContext"];
  delegate: WorkflowStatusDelegate;
  checkAndTriggerWorkflows: () => Promise<void>;
}): Promise<void> {
  params.delegate.onChatComplete(
    params.canvasId,
    params.targetPodId,
    resolveSettlementPathway(params.triggerMode),
  );
  await params.checkAndTriggerWorkflows();
  params.delegate.evaluateRun();
  params.delegate.scheduleNextInQueue(params.canvasId, params.targetPodId);
}

export function failWorkflowChatStage(params: {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  triggerMode: TriggerWorkflowWithSummaryParams["triggerMode"];
  participatingConnectionIds: string[];
  sourcePodIds?: string[];
  sourcePodNames?: string[];
  strategy: TriggerStrategy;
  runContext: TriggerWorkflowWithSummaryParams["runContext"];
  delegate: WorkflowStatusDelegate;
  error: Error;
  clientErrorMessage: string;
}): void {
  logger.error("Workflow", "Error", "Workflow 執行失敗", params.error);
  params.delegate.onChatError(
    params.canvasId,
    params.targetPodId,
    params.clientErrorMessage,
  );
  params.delegate.scheduleNextInQueue(params.canvasId, params.targetPodId);
}
