import { v4 as uuidv4 } from "uuid";
import type { PersistedMessage, PersistedSubMessage } from "../types";
import type { MessageRole, SystemMessageMetadata } from "../types/message.js";
import { Result, ok } from "../types";
import { getStmts } from "../database/stmtsHelper.js";
import { safeJsonParse } from "../utils/safeJsonParse.js";

interface MessageRow {
  id: string;
  pod_id: string;
  canvas_id: string;
  role: string;
  content: string;
  timestamp: string;
  sub_messages_json: string | null;
  metadata_json: string | null;
}

function rowToMessage(row: MessageRow): PersistedMessage {
  return {
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    timestamp: row.timestamp,
    ...(row.metadata_json
      ? {
          metadata:
            safeJsonParse<SystemMessageMetadata>(row.metadata_json) ??
            undefined,
        }
      : {}),
    ...(row.sub_messages_json
      ? {
          subMessages:
            safeJsonParse<PersistedSubMessage[]>(row.sub_messages_json) ??
            undefined,
        }
      : {}),
  };
}

class MessageStore {
  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  /**
   * 新增一則訊息到 DB。
   *
   * @param canvasId - 所屬 Canvas ID
   * @param podId - 所屬 Pod ID
   * @param role - 訊息角色（user / assistant / system）
   * @param content - 訊息文字內容
   * @param subMessages - 可選的子訊息陣列（assistant 的工具呼叫輪次）
   * @param options.id - 可選的外部 id。當 caller 需要讓「外部資源（如附件目錄）的路徑」
   *   與 message id 對齊時可傳入，例如拖檔觸發對話時由 handler 統一產生 chatMessageId，
   *   同時傳給 attachmentWriter 與此方法，確保 DB 中 message id 與 attachments dir id 一致。
   *   若未傳入，則維持原本內部 uuidv4() 行為。
   * @param options.metadata - 可選的 system message metadata（provider / code / severity / rawContent）。
   *   僅 role=system 的訊息才應設定此欄位；rawContent 儲存原始 SDK 錯誤字串供除錯用，
   *   歷史回傳時應遮蔽以避免洩漏敏感資訊（見 handleChatHistory）。
   */
  async addMessage(
    canvasId: string,
    podId: string,
    role: MessageRole,
    content: string,
    subMessages?: PersistedSubMessage[],
    options?: { id?: string; metadata?: SystemMessageMetadata },
  ): Promise<Result<PersistedMessage>> {
    const metadata = options?.metadata;
    const message: PersistedMessage = {
      id: options?.id ?? uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
      ...(subMessages && { subMessages }),
    };

    this.stmts.message.insert.run({
      $id: message.id,
      $podId: podId,
      $canvasId: canvasId,
      $role: role,
      $content: content,
      $timestamp: message.timestamp,
      $subMessagesJson: subMessages ? JSON.stringify(subMessages) : null,
      $metadataJson: metadata ? JSON.stringify(metadata) : null,
    });

    return ok(message);
  }

  getMessages(podId: string): PersistedMessage[] {
    return (this.stmts.message.selectByPodId.all(podId) as MessageRow[]).map(
      rowToMessage,
    );
  }

  clearMessages(podId: string): void {
    this.stmts.message.deleteByPodId.run(podId);
  }

  upsertMessage(
    canvasId: string,
    podId: string,
    message: PersistedMessage,
  ): void {
    this.stmts.message.upsert.run({
      $id: message.id,
      $podId: podId,
      $canvasId: canvasId,
      $role: message.role,
      $content: message.content,
      $timestamp: message.timestamp,
      $subMessagesJson: message.subMessages
        ? JSON.stringify(message.subMessages)
        : null,
      $metadataJson: message.metadata ? JSON.stringify(message.metadata) : null,
    });
  }
}

export const messageStore = new MessageStore();
