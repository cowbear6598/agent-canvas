import type { Schedule, PodProvider, ProviderConfig, PodGoal } from "../pod";
import type { AnchorPosition, TriggerMode } from "@/types";
import type { ManagedMcpRegistryInput } from "../mcp";

export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface PodCreatePayload {
  requestId: string;
  canvasId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  /** Pod 使用的 AI Provider */
  provider: PodProvider;
  /** Provider 對應的設定（含 model 等參數） */
  providerConfig: ProviderConfig;
  goal?: PodGoal | null;
}

/** 查詢可用 Provider 列表 */
export interface ProviderListPayload {
  requestId: string;
}

export interface PodListPayload {
  requestId: string;
  canvasId: string;
}

export interface PodMovePayload {
  requestId: string;
  canvasId: string;
  podId: string;
  x: number;
  y: number;
}

export interface PodRenamePayload {
  requestId: string;
  canvasId: string;
  podId: string;
  name: string;
}

export interface PodSetGoalPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  goal: PodGoal | null;
}

export interface PodSetProviderPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  provider: PodProvider;
  providerConfig: ProviderConfig;
}

export interface PodSetModelPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  /** 傳送 provider-agnostic 的 model 字串，後端依 provider 解析 */
  model: string;
}

export interface PodSetThinkingLevelPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  /** thinking level 字串，後端依 provider 對應到 providerConfig.thinkingLevel */
  level: string;
}

export interface PodSetFastModePayload {
  requestId: string;
  canvasId: string;
  podId: string;
  enabled: boolean;
}

export interface PodSetSchedulePayload {
  requestId: string;
  canvasId: string;
  podId: string;
  schedule: Schedule | null;
}

export interface PodSetMemoryEnabledPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  memoryEnabled: boolean;
}

export interface PodGetMemoryPayload {
  requestId: string;
  canvasId: string;
  podId: string;
}

export interface PodClearMemoryPayload {
  requestId: string;
  canvasId: string;
  podId: string;
}

export interface PodDeletePayload {
  requestId: string;
  canvasId: string;
  podId: string;
}

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ImageContentBlock {
  type: "image";
  mediaType: ImageMediaType;
  base64Data: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface PodChatSendPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  message: string | ContentBlock[];
  /** 拖曳上傳流程的 upload session ID，後端依此取得已上傳的檔案並組裝 triggerText */
  uploadSessionId?: string;
}

export interface PodChatAbortPayload {
  requestId: string;
  canvasId: string;
  podId: string;
}

export interface ConnectionCreatePayload {
  requestId: string;
  canvasId: string;
  sourcePodId?: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  /** 新建 Connection 時可帶入預設 Summary Provider；null 代表清除（重設為 fallback） */
  summaryProvider?: PodProvider | null;
  /** 新建 Connection 時可帶入預設 Summary Model */
  summaryModel?: string;
  summaryThinkingLevel?: string | null;
  triggerMode?: TriggerMode;
  /** Direct toggle 狀態；true 代表保留原基底模式但啟用 no-wait 行為。 */
  direct?: boolean;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
}

export interface ConnectionListPayload {
  requestId: string;
  canvasId: string;
}

export interface ConnectionDeletePayload {
  requestId: string;
  canvasId: string;
  connectionId: string;
}

export interface PastePodItem {
  originalId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  /** Pod 使用的 AI Provider（必填，避免貼上時 provider 身份靜默降級） */
  provider: PodProvider;
  /** Provider 對應的設定（含 model 等參數） */
  providerConfig: ProviderConfig;
  fastModeEnabled?: boolean;
  mcpServerNames?: string[];
  pluginIds?: string[];
  repositoryId?: string | null;
  goal?: PodGoal | null;
}

export interface PasteRepositoryNoteItem {
  repositoryId: string;
  name: string;
  x: number;
  y: number;
  boundToOriginalPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface PasteConnectionItem {
  originalSourcePodId: string;
  sourceAnchor: AnchorPosition;
  originalTargetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode?: TriggerMode;
  /** Direct toggle 狀態；true 代表保留原基底模式但啟用 no-wait 行為。 */
  direct?: boolean;
  /** Summary 功能獨立選用的 Provider；null 代表清除（重設為 fallback） */
  summaryProvider?: PodProvider | null;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  summaryThinkingLevel?: string | null;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
  branchProvider?: PodProvider | null;
  branchModel?: string | null;
  branchThinkingLevel?: string | null;
}

export interface ConnectionUpdatePayload {
  requestId: string;
  canvasId: string;
  connectionId: string;
  triggerMode?: TriggerMode;
  /** Direct toggle 狀態；true 代表保留原基底模式但啟用 no-wait 行為。 */
  direct?: boolean;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  /** Summary 功能獨立選用的 Provider；null 代表清除（重設為 fallback） */
  summaryProvider?: PodProvider | null;
  summaryThinkingLevel?: string | null;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
}

export interface CanvasPastePayload {
  requestId: string;
  canvasId: string;
  pods: PastePodItem[];
  repositoryNotes: PasteRepositoryNoteItem[];
  connections: PasteConnectionItem[];
}

export interface RepositoryCreatePayload {
  requestId: string;
  canvasId: string;
  name: string;
}

export interface RepositoryGitClonePayload {
  requestId: string;
  canvasId: string;
  repoUrl: string;
  branch?: string;
}

export interface RepositoryCheckGitPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

export interface RepositoryGetLocalBranchesPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

export interface RepositoryCheckDirtyPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

export interface RepositoryCheckoutBranchPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
  branchName: string;
  force: boolean;
}

export interface RepositoryDeleteBranchPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
  branchName: string;
  force: boolean;
}

export interface RepositoryPullLatestPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

export interface RepositorySetMemoryEnabledPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
  memoryEnabled: boolean;
}

export interface RepositoryGetMemoryPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

export interface RepositoryClearMemoryPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

/** 查詢指定 Provider 的 MCP server 清單 */
export interface McpListPayload {
  requestId: string;
  /** claude / codex / opencode 三個 provider 皆支援 MCP 清單查詢 */
  provider: "claude" | "codex" | "opencode";
  /** 同 provider 的不同 Pod 可能帶不同 built-in MCP */
  podId: string;
}

export interface ManagedMcpRegistryListPayload {
  requestId: string;
}

export interface ManagedMcpRegistrySavePayload {
  requestId: string;
  registry: ManagedMcpRegistryInput;
}

export interface ManagedMcpRegistryDeletePayload {
  requestId: string;
  registryId: string;
}

export interface ManagedMcpRegistryTestPayload {
  requestId: string;
  registryId: string;
}

export interface PodMcpAvailabilityListPayload {
  requestId: string;
  podId: string;
  /**
   * compatibility 用欄位：
   * 目前 caller 仍會帶 provider 進來做 cache key 與舊介面轉接，
   * 後端可忽略此欄位，直接依 podId 查 provider。
   */
  provider?: PodProvider;
}

/** 設定指定 Pod 的 MCP server 名稱清單 */
export interface PodSetMcpServerNamesPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  mcpServerNames: string[];
  agentCanvasMcpEnabled?: boolean;
}

export interface CursorMovePayload {
  x: number;
  y: number;
}

export interface ConfigGetPayload {
  requestId: string;
}

export interface ConfigUpdatePayload {
  requestId: string;
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
  memoryProvider?: PodProvider;
  memoryModel?: string;
  memoryThinkingLevel?: string | null;
  connectionLineProvider?: PodProvider;
  connectionLineModel?: string;
  connectionLineThinkingLevel?: string | null;
}

export type PasswordUpdateActionPayload =
  | {
      action: "set";
      newPassword: string;
    }
  | {
      action: "change";
      currentPassword: string;
      newPassword: string;
    }
  | {
      action: "remove";
      currentPassword: string;
    };

export interface AuthBootstrapPayload {
  requestId: string;
}

export interface AuthUnlockWorkspacePayload {
  requestId: string;
  password: string;
}

export interface AuthUnlockCanvasPayload {
  requestId: string;
  canvasId: string;
  password: string;
}

export interface AuthUpdateWorkspacePasswordPayload {
  requestId: string;
  passwordUpdate: PasswordUpdateActionPayload;
}

export interface CanvasSecurityUpdatePayload {
  requestId: string;
  canvasId: string;
  passwordUpdate: PasswordUpdateActionPayload;
}

export interface PodSetPluginsPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  pluginIds: string[];
}

export interface PluginListPayload {
  requestId: string;
}

export interface PluginInstallPayload {
  requestId: string;
  githubRepo: string;
}

export interface PluginDeletePayload {
  requestId: string;
  pluginId: string;
}

export interface PluginUpdatePayload {
  requestId: string;
  pluginId: string;
}

export interface PluginReorderPayload {
  requestId: string;
  pluginIds: string[];
}

export interface RunDeletePayload {
  requestId: string;
  canvasId: string;
  runId: string;
}

export interface RunLoadHistoryPayload {
  requestId: string;
  canvasId: string;
}

export interface RunLoadPodMessagesPayload {
  requestId: string;
  canvasId: string;
  runId: string;
  podId: string;
  limit?: number;
  cursor?: {
    beforeTimestamp: string;
    beforeMessageId: string;
    beforeItemType?: "message" | "goal-round-divider";
  } | null;
}

export interface BackupTestConnectionPayload {
  requestId: string;
  gitRemoteUrl: string;
}

export interface BackupTriggerPayload {
  requestId: string;
  gitRemoteUrl: string;
}
