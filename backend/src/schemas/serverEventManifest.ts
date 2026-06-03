import { z } from "zod";
import {
  WebSocketResponseEvents,
  type WebSocketResponseEvent,
} from "./events.js";

export interface ServerEventManifestEntry {
  event: WebSocketResponseEvent;
  schemaName: string;
  schema: z.ZodType<unknown>;
}

const stringRecordSchema = z.record(z.string(), z.unknown());
const i18nErrorSchema = z
  .object({
    key: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .strict();

const requestErrorPayloadSchema = z
  .object({
    canvasId: z.string().nullable().optional(),
    requestId: z.string().optional(),
    podId: z.string().optional(),
    success: z.literal(false),
    error: z.union([z.string(), i18nErrorSchema]),
    code: z.string(),
  })
  .passthrough();

const requestSuccessPayloadSchema = z
  .object({
    requestId: z.string(),
    success: z.literal(true),
  })
  .passthrough();

const canvasRequestSuccessPayloadSchema = requestSuccessPayloadSchema
  .extend({
    canvasId: z.string(),
  })
  .passthrough();

const anchorPositionSchema = z.enum(["top", "bottom", "left", "right"]);
const triggerModeSchema = z.enum(["auto", "branch", "direct"]);
const decideStatusSchema = z.enum([
  "none",
  "pending",
  "approved",
  "rejected",
  "error",
]);
const connectionStatusSchema = z.enum(["idle", "active", "queued", "waiting"]);
const pathwayStateSchema = z.enum([
  "not-applicable",
  "pending",
  "settled",
]);

const goalTodoItemSchema = z
  .object({
    id: z.string(),
    text: z.string(),
  })
  .passthrough();

const podGoalSchema = z
  .object({
    todos: z.array(goalTodoItemSchema),
  })
  .passthrough();

const scheduleSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.string(),
    hour: z.number().optional(),
    minute: z.number().optional(),
    second: z.number().optional(),
    intervalMinute: z.number().optional(),
    intervalHour: z.number().optional(),
    weekdays: z.array(z.number()).optional(),
    lastTriggeredAt: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

const integrationBindingSchema = z
  .object({
    provider: z.string(),
    appId: z.string(),
    resourceId: z.string(),
    extra: stringRecordSchema.optional(),
  })
  .passthrough();

const podPublicViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    x: z.number(),
    y: z.number(),
    rotation: z.number(),
    mcpServerNames: z.array(z.string()),
    pluginIds: z.array(z.string()),
    provider: z.string(),
    providerConfig: stringRecordSchema.nullable(),
    repositoryId: z.string().nullable(),
    goal: podGoalSchema.nullable().optional(),
    schedule: scheduleSchema.optional(),
    integrationBindings: z.array(integrationBindingSchema).optional(),
    memoryEnabled: z.boolean().optional(),
    repoMemoryEnabled: z.boolean().optional(),
    hasPodMemory: z.boolean().optional(),
    hasRepoMemory: z.boolean().optional(),
  })
  .passthrough();

const connectionPayloadSchema = z
  .object({
    id: z.string(),
    sourcePodId: z.string().optional(),
    sourceAnchor: anchorPositionSchema,
    targetPodId: z.string(),
    targetAnchor: anchorPositionSchema,
    triggerMode: triggerModeSchema.optional(),
    decideStatus: decideStatusSchema.optional(),
    connectionStatus: connectionStatusSchema.optional(),
    decideReason: z.string().nullable().optional(),
    summaryModel: z.string().optional(),
    summaryProvider: z.string().nullable().optional(),
    summaryThinkingLevel: z.string().nullable().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    branchProvider: z.string().optional(),
    branchModel: z.string().optional(),
    branchThinkingLevel: z.string().nullable().optional(),
  })
  .passthrough();

const canvasSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    sortIndex: z.number().optional(),
  })
  .passthrough();

const repositorySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

const repositoryNoteSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

const aliasItemSchema = z
  .object({
    id: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    alias: z.string(),
    orderIdx: z.number(),
    thinkingLevels: z.array(z.string()).optional(),
    thinkingLevelLabels: z.record(z.string(), z.string()).optional(),
    defaultThinkingLevel: z.string().nullable().optional(),
    thinkingMetadataFetchedAt: z.number().nullable().optional(),
  })
  .passthrough();

const workflowRunSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    canvasId: z.string().optional(),
    sourcePodId: z.string().optional(),
    sourcePodName: z.string().optional(),
    podInstances: z.array(z.unknown()).optional(),
  })
  .passthrough();

const pageCursorSchema = z
  .object({
    beforeTimestamp: z.string(),
    beforeMessageId: z.string(),
    beforeItemType: z.enum(["message", "goal-round-divider"]).optional(),
  })
  .passthrough();

const pageInfoSchema = z
  .object({
    hasMore: z.boolean(),
    nextCursor: pageCursorSchema.nullable(),
  })
  .passthrough();

const podMutationSuccessPayloadSchema = canvasRequestSuccessPayloadSchema
  .extend({
    pod: podPublicViewSchema.optional(),
  })
  .passthrough();

const connectionListResultPayloadSchema = requestSuccessPayloadSchema
  .extend({
    connections: z.array(connectionPayloadSchema),
  })
  .passthrough();

const connectionCreatedPayloadSchema = canvasRequestSuccessPayloadSchema
  .extend({
    connection: connectionPayloadSchema,
  })
  .passthrough();

const connectionUpdatedPayloadSchema = canvasRequestSuccessPayloadSchema
  .extend({
    connection: connectionPayloadSchema,
    connections: z.array(connectionPayloadSchema),
  })
  .passthrough();

const connectionDeletedPayloadSchema = canvasRequestSuccessPayloadSchema
  .extend({
    connectionId: z.string(),
  })
  .passthrough();

const workflowTriggeredPayloadSchema = z
  .object({
    canvasId: z.string(),
    connectionId: z.string(),
    sourcePodId: z.string(),
    targetPodId: z.string(),
    transferredContent: z.string().optional(),
    isSummarized: z.boolean().optional(),
  })
  .passthrough();

const workflowCompletePayloadSchema = z
  .object({
    canvasId: z.string(),
    requestId: z.string(),
    connectionId: z.string(),
    targetPodId: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
    triggerMode: z.string().optional(),
  })
  .passthrough();

const workflowPendingPayloadSchema = z
  .object({
    canvasId: z.string(),
    targetPodId: z.string(),
    completedSourcePodIds: z.array(z.string()),
    pendingSourcePodIds: z.array(z.string()),
    totalSources: z.number(),
    completedCount: z.number(),
    rejectedSourcePodIds: z.array(z.string()).optional(),
    hasRejectedSources: z.boolean().optional(),
  })
  .passthrough();

const workflowSourcesMergedPayloadSchema = z
  .object({
    canvasId: z.string(),
    targetPodId: z.string(),
    sourcePodIds: z.array(z.string()),
    mergedContentPreview: z.string(),
  })
  .passthrough();

const workflowQueuePayloadSchema = z
  .object({
    canvasId: z.string(),
    targetPodId: z.string(),
    connectionId: z.string(),
    sourcePodId: z.string(),
    triggerMode: triggerModeSchema,
  })
  .passthrough();

const repositoryListPayloadSchema = requestSuccessPayloadSchema
  .extend({
    repositories: z.array(repositorySchema),
  })
  .passthrough();

const repositoryCreatedPayloadSchema = requestSuccessPayloadSchema
  .extend({
    repository: repositorySchema.optional(),
  })
  .passthrough();

const repositoryNoteListPayloadSchema = requestSuccessPayloadSchema
  .extend({
    notes: z.array(repositoryNoteSchema).optional(),
  })
  .passthrough();

const repositoryNoteMutationPayloadSchema = canvasRequestSuccessPayloadSchema
  .extend({
    note: repositoryNoteSchema.optional(),
  })
  .passthrough();

const repositoryDeletedPayloadSchema = requestSuccessPayloadSchema
  .extend({
    repositoryId: z.string().optional(),
    deletedNoteIds: z.array(z.string()).optional(),
  })
  .passthrough();

const progressPayloadSchema = z
  .object({
    requestId: z.string().optional(),
    success: z.boolean().optional(),
    progress: z.number().optional(),
    message: z.union([z.string(), i18nErrorSchema]).optional(),
  })
  .passthrough();

const repositoryBranchChangedPayloadSchema = z
  .object({
    repositoryId: z.string().optional(),
    branch: z.string().optional(),
  })
  .passthrough();

const repositoryGitCloneResultPayloadSchema = requestSuccessPayloadSchema
  .extend({
    repository: repositorySchema.optional(),
  })
  .passthrough();

const canvasPasteResultPayloadSchema = z
  .object({
    canvasId: z.string(),
    requestId: z.string(),
    success: z.boolean(),
    createdPods: z.array(podPublicViewSchema),
    createdRepositoryNotes: z.array(repositoryNoteSchema),
    createdConnections: z.array(connectionPayloadSchema),
    podIdMapping: z.record(z.string(), z.string()),
    errors: z.array(z.unknown()),
    error: z.string().optional(),
  })
  .passthrough();

const cursorPayloadSchema = z
  .object({
    connectionId: z.string().optional(),
    canvasId: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .passthrough();

const configPayloadSchema = requestSuccessPayloadSchema
  .extend({
    config: z.unknown().optional(),
  })
  .passthrough();

const authPayloadSchema = requestSuccessPayloadSchema.passthrough();
const resetPayloadSchema = z.object({}).passthrough();

const integrationAppPayloadSchema = z
  .object({
    id: z.string().optional(),
    provider: z.string().optional(),
    name: z.string().optional(),
    connectionStatus: z.string().optional(),
    resources: z.array(z.unknown()).optional(),
  })
  .passthrough();

const integrationAppListPayloadSchema = requestSuccessPayloadSchema
  .extend({
    apps: z.array(integrationAppPayloadSchema).optional(),
  })
  .passthrough();

const integrationConnectionStatusPayloadSchema = z
  .object({
    provider: z.string(),
    appId: z.string(),
    connectionStatus: z.string(),
    resources: z.array(z.unknown()).optional(),
  })
  .passthrough();

const runCreatedPayloadSchema = z
  .object({
    canvasId: z.string(),
    run: workflowRunSchema,
  })
  .passthrough();

const runStatusChangedPayloadSchema = z
  .object({
    runId: z.string(),
    canvasId: z.string(),
    status: z.string(),
    completedAt: z.string().optional(),
  })
  .passthrough();

const runPodStatusChangedPayloadSchema = z
  .object({
    runId: z.string(),
    canvasId: z.string(),
    podId: z.string(),
    status: z.string(),
    errorMessage: z.string().optional(),
    lastResponseSummary: z.string().optional(),
    triggeredAt: z.string().optional(),
    completedAt: z.string().optional(),
    autoPathwaySettled: pathwayStateSchema.optional(),
    directPathwaySettled: pathwayStateSchema.optional(),
  })
  .passthrough();

const runMessagePayloadSchema = z
  .object({
    runId: z.string().optional(),
    canvasId: z.string().optional(),
    podId: z.string(),
    messageId: z.string(),
    content: z.string(),
    delta: z.string().optional(),
    isPartial: z.boolean(),
    role: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();

const runGoalRoundDividerPayloadSchema = z
  .object({
    id: z.string().optional(),
    canvasId: z.string(),
  })
  .passthrough();

const runChatCompletePayloadSchema = z
  .object({
    runId: z.string().optional(),
    canvasId: z.string().optional(),
    podId: z.string(),
    messageId: z.string(),
    fullContent: z.string(),
  })
  .passthrough();

const runToolUsePayloadSchema = z
  .object({
    podId: z.string(),
    messageId: z.string(),
    toolUseId: z.string(),
    toolName: z.string(),
    input: stringRecordSchema,
  })
  .passthrough();

const runToolResultPayloadSchema = z
  .object({
    podId: z.string(),
    messageId: z.string(),
    toolUseId: z.string(),
    toolName: z.string(),
    output: z.string(),
  })
  .passthrough();

const runDeletedPayloadSchema = z
  .object({
    runId: z.string(),
    canvasId: z.string(),
  })
  .passthrough();

const runHistoryPayloadSchema = requestSuccessPayloadSchema
  .extend({
    runs: z.array(workflowRunSchema),
  })
  .passthrough();

const runPodMessagesPayloadSchema = requestSuccessPayloadSchema
  .extend({
    runId: z.string(),
    podId: z.string(),
    timelineItems: z.array(z.unknown()),
    pageInfo: pageInfoSchema,
  })
  .passthrough();

const pluginListPayloadSchema = requestSuccessPayloadSchema
  .extend({
    plugins: z.array(z.unknown()).optional(),
  })
  .passthrough();

const pluginMutationPayloadSchema = requestSuccessPayloadSchema.passthrough();

const podPluginsBusyPayloadSchema = z
  .object({
    requestId: z.string(),
    canvasId: z.string(),
    podId: z.string(),
    success: z.literal(false),
    reason: z.literal("pod-busy"),
  })
  .passthrough();

const backupEventPayloadSchema = z.object({}).passthrough();
const providerListPayloadSchema = requestSuccessPayloadSchema
  .extend({
    providers: z.array(z.unknown()),
  })
  .passthrough();

const opencodeAliasesListPayloadSchema = requestSuccessPayloadSchema
  .extend({
    items: z.array(aliasItemSchema).optional(),
  })
  .passthrough();

const opencodeAliasesUpdatedPayloadSchema = z
  .object({
    items: z.array(aliasItemSchema),
  })
  .passthrough();

function withRequestError(
  schemaName: string,
  successSchema: z.ZodType<unknown>,
): { schemaName: string; schema: z.ZodType<unknown> } {
  return {
    schemaName,
    schema: z.union([successSchema, requestErrorPayloadSchema]),
  };
}

const serverEventContracts = {
  [WebSocketResponseEvents.CONNECTION_READY]: {
    schemaName: "connectionReadyPayloadSchema",
    schema: z.object({ socketId: z.string() }).passthrough(),
  },
  [WebSocketResponseEvents.POD_CREATED]: withRequestError(
    "podCreatedPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_LIST_RESULT]: withRequestError(
    "podListResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ pods: z.array(podPublicViewSchema) })
      .passthrough(),
  ),
  [WebSocketResponseEvents.POD_GET_RESULT]: withRequestError(
    "podGetResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ pod: podPublicViewSchema })
      .passthrough(),
  ),
  [WebSocketResponseEvents.POD_MOVED]: withRequestError(
    "podMovedPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_RENAMED]: withRequestError(
    "podRenamedPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_GOAL_SET]: withRequestError(
    "podGoalSetPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_PROVIDER_SET]: withRequestError(
    "podProviderSetPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_MODEL_SET]: withRequestError(
    "podModelSetPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_THINKING_LEVEL_SET]: withRequestError(
    "podThinkingLevelSetPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_SCHEDULE_SET]: withRequestError(
    "podScheduleSetPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_MEMORY_ENABLED_SET]: withRequestError(
    "podMemoryEnabledSetPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_MEMORY_RESULT]: withRequestError(
    "podMemoryResultPayloadSchema",
    canvasRequestSuccessPayloadSchema
      .extend({
        podId: z.string(),
        memoryEnabled: z.boolean(),
        hasSummary: z.boolean(),
        summary: z.string().nullable(),
        summaryUpdatedAt: z.string().nullable(),
      })
      .passthrough(),
  ),
  [WebSocketResponseEvents.POD_MEMORY_CLEARED]: withRequestError(
    "podMemoryClearedPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_DELETED]: withRequestError(
    "podDeletedPayloadSchema",
    canvasRequestSuccessPayloadSchema
      .extend({
        podId: z.string().optional(),
        deletedNoteIds: z.unknown().optional(),
      })
      .passthrough(),
  ),
  [WebSocketResponseEvents.POD_CHAT_ABORTED]: {
    schemaName: "podChatAbortedPayloadSchema",
    schema: z
      .object({
        podId: z.string(),
        messageId: z.string(),
      })
      .passthrough(),
  },
  [WebSocketResponseEvents.POD_ERROR]: {
    schemaName: "podErrorPayloadSchema",
    schema: requestErrorPayloadSchema,
  },
  [WebSocketResponseEvents.CONNECTION_CREATED]: withRequestError(
    "connectionCreatedPayloadSchema",
    connectionCreatedPayloadSchema,
  ),
  [WebSocketResponseEvents.CONNECTION_LIST_RESULT]: withRequestError(
    "connectionListResultPayloadSchema",
    connectionListResultPayloadSchema,
  ),
  [WebSocketResponseEvents.CONNECTION_DELETED]: withRequestError(
    "connectionDeletedPayloadSchema",
    connectionDeletedPayloadSchema,
  ),
  [WebSocketResponseEvents.CONNECTION_UPDATED]: withRequestError(
    "connectionUpdatedPayloadSchema",
    connectionUpdatedPayloadSchema,
  ),
  [WebSocketResponseEvents.WORKFLOW_TRIGGERED]: {
    schemaName: "workflowTriggeredPayloadSchema",
    schema: workflowTriggeredPayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED]: {
    schemaName: "workflowAutoTriggeredPayloadSchema",
    schema: workflowTriggeredPayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_COMPLETE]: {
    schemaName: "workflowCompletePayloadSchema",
    schema: workflowCompletePayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_PENDING]: {
    schemaName: "workflowPendingPayloadSchema",
    schema: workflowPendingPayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_SOURCES_MERGED]: {
    schemaName: "workflowSourcesMergedPayloadSchema",
    schema: workflowSourcesMergedPayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_BRANCH_TRIGGERED]: {
    schemaName: "workflowBranchTriggeredPayloadSchema",
    schema: workflowTriggeredPayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_DIRECT_TRIGGERED]: {
    schemaName: "workflowDirectTriggeredPayloadSchema",
    schema: workflowTriggeredPayloadSchema,
  },
  [WebSocketResponseEvents.WORKFLOW_QUEUED]: {
    schemaName: "workflowQueuedPayloadSchema",
    schema: workflowQueuePayloadSchema
      .extend({
        position: z.number(),
        queueSize: z.number(),
      })
      .passthrough(),
  },
  [WebSocketResponseEvents.WORKFLOW_QUEUE_PROCESSED]: {
    schemaName: "workflowQueueProcessedPayloadSchema",
    schema: workflowQueuePayloadSchema
      .extend({
        remainingQueueSize: z.number(),
      })
      .passthrough(),
  },
  [WebSocketResponseEvents.CANVAS_PASTE_RESULT]: withRequestError(
    "canvasPasteResultPayloadSchema",
    canvasPasteResultPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_LIST_RESULT]: withRequestError(
    "repositoryListResultPayloadSchema",
    repositoryListPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_CREATED]: withRequestError(
    "repositoryCreatedPayloadSchema",
    repositoryCreatedPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_NOTE_CREATED]: withRequestError(
    "repositoryNoteCreatedPayloadSchema",
    repositoryNoteMutationPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_NOTE_LIST_RESULT]: withRequestError(
    "repositoryNoteListResultPayloadSchema",
    repositoryNoteListPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_NOTE_UPDATED]: withRequestError(
    "repositoryNoteUpdatedPayloadSchema",
    repositoryNoteMutationPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_NOTE_DELETED]: withRequestError(
    "repositoryNoteDeletedPayloadSchema",
    canvasRequestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.POD_REPOSITORY_BOUND]: withRequestError(
    "podRepositoryBoundPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_REPOSITORY_UNBOUND]: withRequestError(
    "podRepositoryUnboundPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_DELETED]: withRequestError(
    "repositoryDeletedPayloadSchema",
    repositoryDeletedPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS]: {
    schemaName: "repositoryGitCloneProgressPayloadSchema",
    schema: progressPayloadSchema,
  },
  [WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT]: withRequestError(
    "repositoryGitCloneResultPayloadSchema",
    repositoryGitCloneResultPayloadSchema,
  ),
  [WebSocketResponseEvents.REPOSITORY_CHECK_GIT_RESULT]: withRequestError(
    "repositoryCheckGitResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.HEARTBEAT_PING]: {
    schemaName: "heartbeatPingPayloadSchema",
    schema: z.object({ timestamp: z.number() }).passthrough(),
  },
  [WebSocketResponseEvents.HEARTBEAT_PONG]: {
    schemaName: "heartbeatPongPayloadSchema",
    schema: z.object({ timestamp: z.number().optional() }).passthrough(),
  },
  [WebSocketResponseEvents.SCHEDULE_FIRED]: {
    schemaName: "scheduleFiredPayloadSchema",
    schema: z.object({}).passthrough(),
  },
  [WebSocketResponseEvents.CANVAS_CREATED]: withRequestError(
    "canvasCreatedPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ canvas: canvasSchema.optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.CANVAS_LIST_RESULT]: withRequestError(
    "canvasListResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ canvases: z.array(canvasSchema).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.CANVAS_RENAMED]: withRequestError(
    "canvasRenamedPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ canvas: canvasSchema.optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.CANVAS_DELETED]: withRequestError(
    "canvasDeletedPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ canvasId: z.string().optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.CANVAS_SWITCHED]: withRequestError(
    "canvasSwitchedPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ canvas: canvasSchema.optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.CANVAS_REORDERED]: withRequestError(
    "canvasReorderedPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ canvases: z.array(canvasSchema).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.CANVAS_SECURITY_UPDATED]: {
    schemaName: "canvasSecurityUpdatedPayloadSchema",
    schema: z.object({}).passthrough(),
  },
  [WebSocketResponseEvents.REPOSITORY_LOCAL_BRANCHES_RESULT]: withRequestError(
    "repositoryLocalBranchesResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ branches: z.array(z.string()).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_DIRTY_CHECK_RESULT]: withRequestError(
    "repositoryDirtyCheckResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ isDirty: z.boolean().optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_CHECKOUT_BRANCH_PROGRESS]: {
    schemaName: "repositoryCheckoutBranchProgressPayloadSchema",
    schema: progressPayloadSchema,
  },
  [WebSocketResponseEvents.REPOSITORY_BRANCH_CHECKED_OUT]: withRequestError(
    "repositoryBranchCheckedOutPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_BRANCH_CHANGED]: {
    schemaName: "repositoryBranchChangedPayloadSchema",
    schema: repositoryBranchChangedPayloadSchema,
  },
  [WebSocketResponseEvents.REPOSITORY_BRANCH_DELETED]: withRequestError(
    "repositoryBranchDeletedPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_PULL_LATEST_PROGRESS]: {
    schemaName: "repositoryPullLatestProgressPayloadSchema",
    schema: progressPayloadSchema,
  },
  [WebSocketResponseEvents.REPOSITORY_PULL_LATEST_RESULT]: withRequestError(
    "repositoryPullLatestResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_MEMORY_ENABLED_SET]: withRequestError(
    "repositoryMemoryEnabledSetPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_MEMORY_RESULT]: withRequestError(
    "repositoryMemoryResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.REPOSITORY_MEMORY_CLEARED]: withRequestError(
    "repositoryMemoryClearedPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.CURSOR_MOVED]: {
    schemaName: "cursorMovedPayloadSchema",
    schema: cursorPayloadSchema,
  },
  [WebSocketResponseEvents.CURSOR_LEFT]: {
    schemaName: "cursorLeftPayloadSchema",
    schema: cursorPayloadSchema,
  },
  [WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT]: withRequestError(
    "managedMcpRegistryListResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ items: z.array(z.unknown()).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED]: withRequestError(
    "managedMcpRegistrySavedPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED]: withRequestError(
    "managedMcpRegistryDeletedPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED]: {
    schemaName: "managedMcpRegistryUpdatedPayloadSchema",
    schema: z.object({ item: z.unknown().optional() }).passthrough(),
  },
  [WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT]: withRequestError(
    "managedMcpRegistryTestResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.MANAGED_MCP_SURFACE_TARGETS_IGNORED]: {
    schemaName: "managedMcpSurfaceTargetsIgnoredPayloadSchema",
    schema: z.object({ targets: z.array(z.string()).optional() }).passthrough(),
  },
  [WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT]: withRequestError(
    "podMcpAvailabilityListResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ items: z.array(z.unknown()).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED]: withRequestError(
    "podMcpServerNamesUpdatedPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.CONFIG_GET_RESULT]: withRequestError(
    "configGetResultPayloadSchema",
    configPayloadSchema,
  ),
  [WebSocketResponseEvents.CONFIG_UPDATED]: withRequestError(
    "configUpdatedPayloadSchema",
    configPayloadSchema,
  ),
  [WebSocketResponseEvents.AUTH_BOOTSTRAP_RESULT]: withRequestError(
    "authBootstrapResultPayloadSchema",
    authPayloadSchema,
  ),
  [WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT]: withRequestError(
    "authWorkspaceUnlockResultPayloadSchema",
    authPayloadSchema,
  ),
  [WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT]: withRequestError(
    "authCanvasUnlockResultPayloadSchema",
    authPayloadSchema,
  ),
  [WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED]: withRequestError(
    "authWorkspacePasswordUpdatedPayloadSchema",
    authPayloadSchema,
  ),
  [WebSocketResponseEvents.AUTH_SESSION_RESET]: {
    schemaName: "authSessionResetPayloadSchema",
    schema: resetPayloadSchema,
  },
  [WebSocketResponseEvents.AUTH_CANVAS_ACCESS_RESET]: {
    schemaName: "authCanvasAccessResetPayloadSchema",
    schema: resetPayloadSchema,
  },
  [WebSocketResponseEvents.INTEGRATION_APP_CREATED]: withRequestError(
    "integrationAppCreatedPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ app: integrationAppPayloadSchema.optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.INTEGRATION_APP_DELETED]: withRequestError(
    "integrationAppDeletedPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.INTEGRATION_APP_LIST_RESULT]: withRequestError(
    "integrationAppListResultPayloadSchema",
    integrationAppListPayloadSchema,
  ),
  [WebSocketResponseEvents.INTEGRATION_APP_GET_RESULT]: withRequestError(
    "integrationAppGetResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ app: integrationAppPayloadSchema.optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_RESULT]: withRequestError(
    "integrationAppResourcesResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ resources: z.array(z.unknown()).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.INTEGRATION_APP_RESOURCES_REFRESHED]:
    withRequestError(
      "integrationAppResourcesRefreshedPayloadSchema",
      requestSuccessPayloadSchema
        .extend({ resources: z.array(z.unknown()).optional() })
        .passthrough(),
    ),
  [WebSocketResponseEvents.POD_INTEGRATION_BOUND]: withRequestError(
    "podIntegrationBoundPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_INTEGRATION_UNBOUND]: withRequestError(
    "podIntegrationUnboundPayloadSchema",
    podMutationSuccessPayloadSchema,
  ),
  [WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED]: {
    schemaName: "integrationConnectionStatusChangedPayloadSchema",
    schema: integrationConnectionStatusPayloadSchema,
  },
  [WebSocketResponseEvents.RUN_CREATED]: {
    schemaName: "runCreatedPayloadSchema",
    schema: runCreatedPayloadSchema,
  },
  [WebSocketResponseEvents.RUN_STATUS_CHANGED]: {
    schemaName: "runStatusChangedPayloadSchema",
    schema: runStatusChangedPayloadSchema,
  },
  [WebSocketResponseEvents.RUN_POD_STATUS_CHANGED]: {
    schemaName: "runPodStatusChangedPayloadSchema",
    schema: runPodStatusChangedPayloadSchema,
  },
  [WebSocketResponseEvents.RUN_MESSAGE]: {
    schemaName: "runMessagePayloadSchema",
    schema: runMessagePayloadSchema,
  },
  [WebSocketResponseEvents.RUN_GOAL_ROUND_DIVIDER]: {
    schemaName: "runGoalRoundDividerPayloadSchema",
    schema: runGoalRoundDividerPayloadSchema,
  },
  [WebSocketResponseEvents.RUN_CHAT_COMPLETE]: {
    schemaName: "runChatCompletePayloadSchema",
    schema: runChatCompletePayloadSchema,
  },
  [WebSocketResponseEvents.RUN_CHAT_TOOL_USE]: {
    schemaName: "runChatToolUsePayloadSchema",
    schema: runToolUsePayloadSchema,
  },
  [WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT]: {
    schemaName: "runChatToolResultPayloadSchema",
    schema: runToolResultPayloadSchema,
  },
  [WebSocketResponseEvents.RUN_DELETED]: withRequestError(
    "runDeletedPayloadSchema",
    runDeletedPayloadSchema,
  ),
  [WebSocketResponseEvents.RUN_HISTORY_RESULT]: withRequestError(
    "runHistoryResultPayloadSchema",
    runHistoryPayloadSchema,
  ),
  [WebSocketResponseEvents.RUN_POD_MESSAGES_RESULT]: withRequestError(
    "runPodMessagesResultPayloadSchema",
    runPodMessagesPayloadSchema,
  ),
  [WebSocketResponseEvents.PLUGIN_LIST_RESULT]: withRequestError(
    "pluginListResultPayloadSchema",
    pluginListPayloadSchema,
  ),
  [WebSocketResponseEvents.PLUGIN_INSTALLED]: withRequestError(
    "pluginInstalledPayloadSchema",
    pluginMutationPayloadSchema,
  ),
  [WebSocketResponseEvents.PLUGIN_DELETED]: withRequestError(
    "pluginDeletedPayloadSchema",
    pluginMutationPayloadSchema,
  ),
  [WebSocketResponseEvents.PLUGIN_UPDATED]: withRequestError(
    "pluginUpdatedPayloadSchema",
    pluginMutationPayloadSchema,
  ),
  [WebSocketResponseEvents.PLUGIN_REORDERED]: withRequestError(
    "pluginReorderedPayloadSchema",
    pluginMutationPayloadSchema,
  ),
  [WebSocketResponseEvents.POD_PLUGINS_SET]: {
    schemaName: "podPluginsSetPayloadSchema",
    schema: z.union([
      podMutationSuccessPayloadSchema,
      podPluginsBusyPayloadSchema,
      requestErrorPayloadSchema,
    ]),
  },
  [WebSocketResponseEvents.BACKUP_TRIGGER_RESULT]: withRequestError(
    "backupTriggerResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.BACKUP_STARTED]: {
    schemaName: "backupStartedPayloadSchema",
    schema: backupEventPayloadSchema,
  },
  [WebSocketResponseEvents.BACKUP_COMPLETED]: {
    schemaName: "backupCompletedPayloadSchema",
    schema: backupEventPayloadSchema,
  },
  [WebSocketResponseEvents.BACKUP_FAILED]: {
    schemaName: "backupFailedPayloadSchema",
    schema: backupEventPayloadSchema,
  },
  [WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT]: withRequestError(
    "backupTestConnectionResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.PROVIDER_LIST_RESULT]: withRequestError(
    "providerListResultPayloadSchema",
    providerListPayloadSchema,
  ),
  [WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT]: withRequestError(
    "opencodeProviderListResultPayloadSchema",
    requestSuccessPayloadSchema
      .extend({ providers: z.array(z.unknown()).optional() })
      .passthrough(),
  ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_LIST_RESULT]: withRequestError(
    "opencodeAliasesListResultPayloadSchema",
    opencodeAliasesListPayloadSchema,
  ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT]: withRequestError(
    "opencodeAliasesCreateResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT]: withRequestError(
    "opencodeAliasesUpdateResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT]: withRequestError(
    "opencodeAliasesDeleteResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT]: withRequestError(
    "opencodeAliasesReorderResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_REFRESH_PRESETS_RESULT]:
    withRequestError(
      "opencodeAliasesRefreshPresetsResultPayloadSchema",
      requestSuccessPayloadSchema.passthrough(),
    ),
  [WebSocketResponseEvents.OPENCODE_ALIASES_UPDATED]: {
    schemaName: "opencodeAliasesUpdatedPayloadSchema",
    schema: opencodeAliasesUpdatedPayloadSchema,
  },
  [WebSocketResponseEvents.OPENCODE_SERVER_RESTART_RESULT]: withRequestError(
    "opencodeServerRestartResultPayloadSchema",
    requestSuccessPayloadSchema.passthrough(),
  ),
} satisfies Record<
  WebSocketResponseEvent,
  { schemaName: string; schema: z.ZodType<unknown> }
>;

export const serverEventManifest: ServerEventManifestEntry[] = (
  Object.entries(serverEventContracts) as Array<
    [
      WebSocketResponseEvent,
      { schemaName: string; schema: z.ZodType<unknown> },
    ]
  >
).map(([event, contract]) => ({
  event,
  schemaName: contract.schemaName,
  schema: contract.schema,
}));

const serverEventSchemaMap = new Map(
  serverEventManifest.map((entry) => [entry.event, entry]),
);

export function getServerEventManifestEntry(
  event: WebSocketResponseEvent,
): ServerEventManifestEntry {
  const entry = serverEventSchemaMap.get(event);
  if (!entry) {
    throw new Error(`找不到 WebSocket server event 契約：${event}`);
  }
  return entry;
}

export function getServerEventSchema(
  event: WebSocketResponseEvent,
): z.ZodType<unknown> {
  return getServerEventManifestEntry(event).schema;
}

export function assertServerEventRegistered(event: string): asserts event is WebSocketResponseEvent {
  if (!serverEventSchemaMap.has(event as WebSocketResponseEvent)) {
    throw new Error(`未註冊的 WebSocket server event：${event}`);
  }
}

export function parseServerEventPayload(
  event: WebSocketResponseEvent,
  payload: unknown,
): unknown {
  return getServerEventSchema(event).parse(payload);
}
