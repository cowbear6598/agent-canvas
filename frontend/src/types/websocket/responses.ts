import type { Pod, PodProvider, ProviderCapabilities } from "../pod";
import type { Repository, RepositoryNote } from "@/types";
import type { AnchorPosition } from "@/types";
import type { InstalledPlugin } from "../plugin";
import type { ResultPayload } from "./index";
import type {
  WorkflowRun,
  RunStatus,
  RunPodStatus,
  PathwayState,
} from "../run";
import type {
  ManagedMcpRegistryItem,
  McpListItem,
  PodMcpAvailabilityItem,
} from "../mcp";
import type { MessageRole, SystemMessageMetadata } from "../chat";

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

export interface PodGoalSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodModelSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodThinkingLevelSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodScheduleSetPayload extends ResultPayload {
  pod?: Pod;
}

export interface PodDeletedPayload extends ResultPayload {
  podId?: string;
  deletedNoteIds?: {
    repositoryNote?: string[];
  };
}

export interface PodChatMessagePayload {
  podId: string;
  messageId: string;
  content: string;
  isPartial: boolean;
  role?: MessageRole;
  metadata?: SystemMessageMetadata;
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

export interface PersistedMessage {
  id: string;
  role: MessageRole;
  content: string;
  metadata?: SystemMessageMetadata;
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

export interface ConnectionPayloadItem {
  id: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: "auto" | "branch" | "direct";
  decideStatus?: "none" | "pending" | "approved" | "rejected" | "error";
  connectionStatus?: "idle" | "active" | "queued" | "waiting";
  decideReason?: string | null;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /**
   * Summary 功能獨立選用的 Provider。
   * 後端 NULL 會以此欄位回傳；升級前 Connection 為 undefined，UI 渲染時會 fallback 至來源 Pod provider。
   */
  summaryProvider?: PodProvider | null;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
  /** Branch 模式使用的 AI Provider */
  branchProvider?: PodProvider;
  /** Branch 模式使用的模型字串 */
  branchModel?: string;
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
  triggerMode?: "auto" | "branch" | "direct";
}

export interface PasteError {
  type: "pod" | "repositoryNote";
  originalId: string;
  error: string;
}

export interface CanvasPasteResultPayload extends ResultPayload {
  createdPods: Pod[];
  createdRepositoryNotes: RepositoryNote[];
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

export interface RepositoryLocalBranchesResultPayload extends ResultPayload {
  branches?: string[];
  currentBranch?: string;
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

export interface WorkflowBranchPendingPayload {
  canvasId: string;
  connectionIds: string[];
  sourcePodId: string;
}

export interface WorkflowBranchResultPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  selectedLabel: string | null;
}

export interface WorkflowBranchErrorPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  error: string;
}

export interface WorkflowBranchClearPayload {
  canvasId: string;
  connectionIds: string[];
}

export interface WorkflowBranchTriggeredPayload {
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
  triggerMode: "auto" | "branch" | "direct";
}

export interface WorkflowQueueProcessedPayload {
  canvasId: string;
  connectionId: string;
  sourcePodId: string;
  targetPodId: string;
  remainingQueueSize: number;
  triggerMode: "auto" | "branch" | "direct";
}

export interface CursorMovedPayload {
  connectionId: string;
  x: number;
  y: number;
  color: string;
}

/** MCP server 清單查詢結果 */
export interface McpListResultPayload extends ResultPayload {
  /** 與後端 MCP allowlist 對齊；僅 claude / codex / opencode 會回傳實際清單 */
  provider?: "claude" | "codex" | "opencode";
  items?: McpListItem[];
}

export interface ManagedMcpRegistryListResultPayload extends ResultPayload {
  items?: ManagedMcpRegistryItem[];
}

export interface ManagedMcpRegistrySavedPayload extends ResultPayload {
  item?: ManagedMcpRegistryItem;
}

export interface ManagedMcpRegistryDeletedPayload extends ResultPayload {
  registryId?: string;
}

export interface ManagedMcpRegistryUpdatedPayload extends ResultPayload {
  action?: "saved" | "deleted";
  registryId?: string;
  item?: ManagedMcpRegistryItem;
}

export interface PodMcpAvailabilityListResultPayload extends ResultPayload {
  podId?: string;
  items?: PodMcpAvailabilityItem[];
}

/** Pod 的 MCP server 名稱清單已更新 */
export interface PodMcpServerNamesUpdatedPayload extends ResultPayload {
  canvasId: string;
  podId?: string;
  mcpServerNames?: string[];
  /**
   * self-healing 過濾掉的 MCP server name 清單。
   * 不存在於對應 provider 設定檔的 MCP server name 清單：
   * - claude → ~/.claude.json
   * - codex  → ~/.codex/config.toml
   * - opencode → ~/.config/opencode/opencode.json
   */
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
  hasWorkspacePassword?: boolean;
  transportSecurity?: {
    isTls: boolean;
    showInsecureTransportWarning: boolean;
    isLanHost: boolean;
  };
}

export interface ConfigUpdatedPayload extends ResultPayload {
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
  hasWorkspacePassword?: boolean;
}

export interface AuthBootstrapResultPayload extends ResultPayload {
  hasWorkspacePassword?: boolean;
  workspaceUnlocked?: boolean;
  unlockedCanvasIds?: string[];
  transportSecurity?: {
    isTls: boolean;
    showInsecureTransportWarning: boolean;
    isLanHost: boolean;
  };
}

export interface AuthUnlockWorkspaceResultPayload extends ResultPayload {
  reconnectGrant?: string;
}

export interface AuthUnlockCanvasResultPayload extends ResultPayload {
  canvasId?: string;
  unlockedCanvasIds?: string[];
}

export interface WorkspacePasswordUpdatedPayload extends ResultPayload {
  hasWorkspacePassword?: boolean;
}

export interface AuthSessionResetPayload {
  reason: string;
}

export interface AuthCanvasAccessResetPayload {
  canvasId: string;
  reason: string;
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
  role?: MessageRole;
  metadata?: SystemMessageMetadata;
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
