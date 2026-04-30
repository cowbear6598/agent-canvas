import type { ModelType, Schedule, PodProvider, ProviderConfig } from "../pod";
import type { AnchorPosition } from "@/types";

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

export interface PodSetModelPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  /** 傳送 provider-agnostic 的 model 字串，後端依 provider 解析 */
  model: string;
}

export interface PodSetSchedulePayload {
  requestId: string;
  canvasId: string;
  podId: string;
  schedule: Schedule | null;
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

export interface PodChatHistoryPayload {
  requestId: string;
  canvasId: string;
  podId: string;
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

export interface WorkflowGetDownstreamPodsPayload {
  requestId: string;
  canvasId: string;
  sourcePodId: string;
}

export interface WorkflowClearPayload {
  requestId: string;
  canvasId: string;
  sourcePodId: string;
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
  mcpServerNames?: string[];
  pluginIds?: string[];
  repositoryId?: string | null;
  commandId?: string | null;
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
  triggerMode?: "auto" | "ai-decide" | "direct";
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  aiDecideModel?: ModelType;
}

export interface ConnectionUpdatePayload {
  requestId: string;
  canvasId: string;
  connectionId: string;
  triggerMode?: "auto" | "ai-decide" | "direct";
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel?: string;
  aiDecideModel?: ModelType;
}

export interface CanvasPastePayload {
  requestId: string;
  canvasId: string;
  pods: PastePodItem[];
  repositoryNotes: PasteRepositoryNoteItem[];
  commandNotes: PasteCommandNoteItem[];
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

export interface PodSetMultiInstancePayload {
  requestId: string;
  canvasId: string;
  podId: string;
  multiInstance: boolean;
}

export interface CommandNoteCreatePayload {
  requestId: string;
  canvasId: string;
  commandId: string;
  name: string;
  x: number;
  y: number;
  boundToPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface PasteCommandNoteItem {
  commandId: string;
  name: string;
  x: number;
  y: number;
  boundToOriginalPodId: string | null;
  originalPosition: { x: number; y: number } | null;
}

export interface RepositoryCheckGitPayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
}

export interface RepositoryWorktreeCreatePayload {
  requestId: string;
  canvasId: string;
  repositoryId: string;
  worktreeName: string;
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

export interface GroupCreatePayload {
  requestId: string;
  canvasId: string;
  name: string;
  type: "command";
}

export interface GroupListPayload {
  requestId: string;
  canvasId: string;
  type: "command";
}

export interface GroupDeletePayload {
  requestId: string;
  canvasId: string;
  groupId: string;
}

export interface MoveToGroupPayload {
  requestId: string;
  canvasId: string;
  itemId: string;
  groupId: string | null;
}

/** 查詢指定 Provider 的 MCP server 清單 */
export interface McpListPayload {
  requestId: string;
  /**
   * 目前 mcp 不支援 gemini，本欄位刻意維持 `"claude" | "codex"`。
   * 新增 gemini mcp 支援時需同步擴充此型別並更新後端對應的 handler。
   */
  provider: "claude" | "codex";
}

/** 設定指定 Pod 的 MCP server 名稱清單 */
export interface PodSetMcpServerNamesPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  mcpServerNames: string[];
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
}

export interface PodSetPluginsPayload {
  requestId: string;
  canvasId: string;
  podId: string;
  pluginIds: string[];
}

export interface PluginListPayload {
  requestId: string;
  /** 依 provider 過濾 plugin 清單；限制為已知 provider 字面量，獲得型別系統列舉約束 */
  provider?: "claude" | "codex" | "gemini";
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
}

export interface BackupTestConnectionPayload {
  requestId: string;
  gitRemoteUrl: string;
}

export interface BackupTriggerPayload {
  requestId: string;
  gitRemoteUrl: string;
}
