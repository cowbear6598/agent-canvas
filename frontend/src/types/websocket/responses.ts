import type {
  Pod,
  PodStatus,
  ModelType,
  PodProvider,
  ProviderCapabilities,
} from "../pod";
import type { Repository, RepositoryNote } from "@/types";
import type { CommandNote } from "@/types";
import type { AnchorPosition } from "@/types";
import type { InstalledPlugin } from "../plugin";
import type { ResultPayload } from "./index";
import type {
  WorkflowRun,
  RunStatus,
  RunPodStatus,
  PathwayState,
} from "../run";
import type { McpListItem } from "../mcp";

export interface ConnectionReadyPayload {
  socketId: string;
}

export interface PodCreatedPayload extends ResultPayload {
  canvasId?: string;
  pod?: Pod;
}

export interface PodListResultPayload extends ResultPayload {
  pods?: Pod[];
}

export interface PodMovedPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodRenamedPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodModelSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodScheduleSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodDeletedPayload extends ResultPayload {
  podId?: string;
  deletedNoteIds?: {
    repositoryNote?: string[];
    commandNote?: string[];
  };
}

export interface PodChatMessagePayload {
  podId: string;
  messageId: string;
  content: string;
  isPartial: boolean;
  role?: "user" | "assistant";
}

export interface PodChatToolUsePayload {
  podId: string;
  messageId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PodChatToolResultPayload {
  podId: string;
  messageId: string;
  toolUseId: string;
  toolName: string;
  output: string;
}

export interface PodChatCompletePayload {
  podId: string;
  messageId: string;
  fullContent: string;
}

export interface PodChatAbortedPayload {
  podId: string;
  messageId: string;
}

/** 後端 i18nError 格式：key 為 i18n 翻譯 key，params 為插值參數 */
export interface I18nErrorPayload {
  key: string;
  params?: Record<string, string | number>;
}

export interface PodErrorPayload {
  requestId?: string;
  podId?: string;
  /** 後端可能傳純字串或 i18nError 格式物件，前端需統一處理 */
  error: string | I18nErrorPayload;
  code: string;
}

export interface PodStatusChangedPayload {
  podId: string;
  status: PodStatus;
  previousStatus: PodStatus;
}

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  subMessages?: Array<{
    id: string;
    content: string;
    toolUse?: Array<{
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
      output?: string;
      status: string;
    }>;
  }>;
}

export interface PodChatHistoryResultPayload extends ResultPayload {
  messages?: PersistedMessage[];
}

export interface ConnectionPayloadItem {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: "auto" | "ai-decide" | "direct";
  decideStatus?: "none" | "pending" | "approved" | "rejected" | "error";
  connectionStatus?:
    | "idle"
    | "active"
    | "queued"
    | "waiting"
    | "ai-deciding"
    | "ai-approved"
    | "ai-rejected"
    | "ai-error";
  decideReason?: string | null;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  aiDecideModel?: ModelType;
}

export interface ConnectionCreatedPayload extends ResultPayload {
  connection?: ConnectionPayloadItem;
}

export interface ConnectionUpdatedPayload extends ResultPayload {
  connection?: ConnectionPayloadItem;
}

export interface ConnectionListResultPayload extends ResultPayload {
  connections?: ConnectionPayloadItem[];
}

export interface ConnectionDeletedPayload extends ResultPayload {
  connectionId?: string;
}

export interface WorkflowAutoTriggeredPayload {
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  transferredContent: string;
  isSummarized: boolean;
}

export interface WorkflowCompletePayload extends ResultPayload {
  connectionId: string;
  targetPodId: string;
  triggerMode?: "auto" | "ai-decide" | "direct";
}

export interface WorkflowGetDownstreamPodsResultPayload {
  requestId: string;
  success: boolean;
  pods?: Array<{ id: string; name: string }>;
  error?: string;
}

export interface WorkflowClearResultPayload extends ResultPayload {
  clearedPodIds?: string[];
  clearedPodNames?: string[];
}

export interface PasteError {
  type: "pod" | "repositoryNote" | "commandNote";
  originalId: string;
  error: string;
}

export interface CanvasPasteResultPayload extends ResultPayload {
  createdPods: Pod[];
  createdRepositoryNotes: RepositoryNote[];
  createdCommandNotes: CommandNote[];
  createdConnections: ConnectionPayloadItem[];
  podIdMapping: Record<string, string>;
  errors: PasteError[];
}

export interface RepositoryCreatedPayload extends ResultPayload {
  repository?: Repository;
}

export interface RepositoryGitCloneProgressPayload {
  requestId: string;
  progress: number;
  message: string;
}

export interface RepositoryGitCloneResultPayload {
  requestId: string;
  success: boolean;
  repository?: { id: string; name: string };
  error?: string;
}

export interface PodMessagesClearedPayload {
  podId: string;
}

export interface PodMultiInstanceSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface CommandCreatedPayload {
  requestId: string;
  success: boolean;
  command?: { id: string; name: string };
  error?: string;
}

export interface CommandUpdatedPayload {
  requestId: string;
  success: boolean;
  command?: { id: string; name: string };
  error?: string;
}

export interface CommandReadResultPayload {
  requestId: string;
  success: boolean;
  command?: { id: string; name: string; content: string };
  error?: string;
}

export interface CommandNoteCreatedPayload extends ResultPayload {
  note?: CommandNote;
}

export interface ScheduleFiredPayload {
  podId: string;
  timestamp: string;
}

export interface HeartbeatPingPayload {
  timestamp: number;
}

export interface RepositoryCheckGitResultPayload extends ResultPayload {
  isGit: boolean;
}

export interface RepositoryWorktreeCreatedPayload extends ResultPayload {
  repository?: Repository;
}

export interface RepositoryLocalBranchesResultPayload extends ResultPayload {
  branches?: string[];
  currentBranch?: string;
  worktreeBranches?: string[];
}

export interface RepositoryDirtyCheckResultPayload extends ResultPayload {
  isDirty?: boolean;
}

export interface RepositoryCheckoutBranchProgressPayload {
  requestId: string;
  progress: number;
  message: string;
  branchName: string;
}

export interface RepositoryBranchCheckedOutPayload extends ResultPayload {
  repositoryId?: string;
  branchName?: string;
  action?: "switched" | "fetched" | "created";
}

export interface RepositoryBranchDeletedPayload extends ResultPayload {
  branchName?: string;
}

export interface RepositoryPullLatestProgressPayload {
  requestId: string;
  progress: number;
  message: string;
}

export interface RepositoryPullLatestResultPayload extends ResultPayload {
  repositoryId?: string;
}

export interface GroupCreatedPayload {
  requestId: string;
  success: boolean;
  group?: {
    id: string;
    name: string;
    type: "command";
  };
  error?: string;
}

export interface GroupListResultPayload {
  requestId: string;
  success: boolean;
  groups?: Array<{
    id: string;
    name: string;
    type: "command";
  }>;
  error?: string;
}

export interface GroupDeletedPayload extends ResultPayload {
  groupId?: string;
}

export interface MovedToGroupPayload extends ResultPayload {
  itemId?: string;
  groupId?: string | null;
}

export interface WorkflowAiDecidePendingPayload {
  canvasId: string;
  connectionIds: string[];
  sourcePodId: string;
}

export interface WorkflowAiDecideResultPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  shouldTrigger: boolean;
  reason: string;
}

export interface WorkflowAiDecideErrorPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  error: string;
}

export interface WorkflowAiDecideClearPayload {
  canvasId: string;
  connectionIds: string[];
}

export interface WorkflowAiDecideTriggeredPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
}

export interface WorkflowDirectTriggeredPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  transferredContent: string;
  isSummarized: boolean;
}

export interface WorkflowDirectWaitingPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
}

export interface WorkflowQueuedPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  position: number;
  queueSize: number;
  triggerMode: "auto" | "ai-decide" | "direct";
}

export interface WorkflowQueueProcessedPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  remainingQueueSize: number;
  triggerMode: "auto" | "ai-decide" | "direct";
}

export interface CursorMovedPayload {
  connectionId: string;
  x: number;
  y: number;
  color: string;
}

/** MCP server 清單查詢結果 */
export interface McpListResultPayload extends ResultPayload {
  /** 與後端 providerSchema（"claude" | "codex" | "gemini"）對齊；gemini 目前不支援 mcp，但 schema 必須允許以便回傳空清單 */
  provider?: "claude" | "codex" | "gemini";
  items?: McpListItem[];
}

/** Pod 的 MCP server 名稱清單已更新 */
export interface PodMcpServerNamesUpdatedPayload extends ResultPayload {
  canvasId: string;
  podId?: string;
  mcpServerNames?: string[];
  /** self-healing 過濾掉的 MCP server name 清單（不存在於 ~/.claude.json） */
  ignoredNames?: string[];
  pod?: Pod;
}

export interface CursorLeftPayload {
  connectionId: string;
}

export interface ConfigGetResultPayload extends ResultPayload {
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
}

export interface ConfigUpdatedPayload extends ResultPayload {
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
}

/** Pod plugin 設定結果（discriminated union，以 success 欄位區分兩條路徑） */
export type PodPluginsSetPayload =
  | {
      requestId?: string;
      canvasId: string;
      success: true;
      pod?: Pod;
      /** self-healing 過濾掉的 plugin ID 清單（未安裝的 plugin） */
      ignoredIds?: string[];
    }
  | {
      requestId?: string;
      canvasId: string;
      podId?: string;
      success: false;
      /** pod-busy：Pod 正忙碌，無法修改 plugin 設定 */
      reason: "pod-busy";
    };

export interface PluginListResultPayload extends ResultPayload {
  plugins?: InstalledPlugin[];
}

export interface RunCreatedPayload {
  canvasId: string;
  run: WorkflowRun;
}

export interface RunStatusChangedPayload {
  canvasId: string;
  runId: string;
  status: RunStatus;
  completedAt?: string;
}

export interface RunPodStatusChangedPayload {
  canvasId: string;
  runId: string;
  podId: string;
  status: RunPodStatus;
  lastResponseSummary?: string;
  errorMessage?: string;
  triggeredAt?: string;
  completedAt?: string;
  autoPathwaySettled?: PathwayState;
  directPathwaySettled?: PathwayState;
}

export interface RunMessagePayload {
  canvasId: string;
  runId: string;
  podId: string;
  messageId: string;
  content: string;
  isPartial: boolean;
  role?: "user" | "assistant";
}

export interface RunChatCompletePayload {
  canvasId: string;
  runId: string;
  podId: string;
  messageId: string;
  fullContent: string;
}

export interface RunDeletedPayload {
  canvasId: string;
  runId: string;
}

export interface RunHistoryResultPayload {
  requestId: string;
  success: boolean;
  runs?: WorkflowRun[];
}

export interface RunPodMessagesResultPayload {
  requestId: string;
  success: boolean;
  messages?: PersistedMessage[];
}

export interface RunToolUsePayload {
  canvasId: string;
  runId: string;
  podId: string;
  messageId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface RunToolResultPayload {
  canvasId: string;
  runId: string;
  podId: string;
  messageId: string;
  toolUseId: string;
  toolName: string;
  output: string;
}

/** Provider 列表查詢結果，包含每個 Provider 的功能能力表、預設選項與可選模型清單 */
export interface ProviderListResultPayload extends ResultPayload {
  providers?: Array<{
    name: PodProvider;
    capabilities: ProviderCapabilities;
    /** Provider 預設執行時選項（已移除 pathToClaudeCodeExecutable 等伺服器敏感路徑） */
    defaultOptions: Record<string, unknown>;
    /**
     * Provider 聲告支援的模型清單，前端模型選擇器依此動態渲染選項。
     * 每個元素為 { label, value } pair，label 供 UI 顯示、value 為實際 model id。
     */
    availableModels: ReadonlyArray<{ label: string; value: string }>;
  }>;
}

export type BackupTestConnectionResultPayload = ResultPayload;

export type BackupTriggerResultPayload = ResultPayload;

export interface BackupStartedPayload {
  timestamp: string;
}

export interface BackupCompletedPayload {
  timestamp: string;
}

export interface BackupFailedPayload {
  error: string;
  timestamp: string;
}
