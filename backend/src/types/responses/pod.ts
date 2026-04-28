import type { PodPublicView, PodStatus } from "../pod.js";
import type { MessageRole } from "../message.js";

export interface PodCreatedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodListResultPayload {
  requestId: string;
  success: boolean;
  pods?: PodPublicView[];
  error?: string;
}

export interface PodGetResultPayload {
  requestId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodMovedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodRenamedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  podId?: string;
  name?: string;
  error?: string;
}

export interface PodModelSetPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodScheduleSetPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

/** Pod plugin 設定結果（discriminated union，以 success 欄位區分兩條路徑） */
export type PodPluginsSetPayload =
  | {
      requestId: string;
      canvasId: string;
      success: true;
      pod?: PodPublicView;
      /** self-healing 過濾掉的 plugin ID 清單（未安裝的 plugin） */
      ignoredIds: string[];
    }
  | {
      requestId: string;
      canvasId: string;
      podId?: string;
      success: false;
      /** pod-busy：Pod 正忙碌，無法修改 plugin 設定 */
      reason: "pod-busy";
    };

export interface PodDeletedPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  podId?: string;
  deletedNoteIds?: {
    repositoryNote?: string[];
    commandNote?: string[];
  };
  error?: string;
}

export interface PodChatMessagePayload {
  canvasId: string;
  podId: string;
  messageId: string;
  content: string;
  isPartial: boolean;
  role?: MessageRole;
}

export interface PodChatToolUsePayload {
  canvasId: string;
  podId: string;
  messageId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PodChatToolResultPayload {
  canvasId: string;
  podId: string;
  messageId: string;
  toolUseId: string;
  toolName: string;
  output: string;
}

export interface PodChatCompletePayload {
  canvasId: string;
  podId: string;
  messageId: string;
  fullContent: string;
}

export interface PodChatAbortedPayload {
  canvasId: string;
  podId: string;
  messageId: string;
}

export interface PodChatHistoryResultPayload {
  requestId: string;
  success: boolean;
  messages?: Array<{
    id: string;
    role: MessageRole;
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
  }>;
  error?: string;
}

export interface PodErrorPayload {
  requestId?: string;
  podId?: string;
  error: string;
  code: string;
}

export interface PodRepositoryBoundPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodRepositoryUnboundPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodMultiInstanceSetPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodCommandBoundPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodCommandUnboundPayload {
  requestId: string;
  canvasId: string;
  success: boolean;
  pod?: PodPublicView;
  error?: string;
}

export interface PodStatusChangedPayload {
  podId: string;
  status: PodStatus;
  previousStatus: PodStatus;
}

export interface PodMessagesClearedPayload {
  podId: string;
}
