import { v4 as uuidv4 } from 'uuid';
import type { PersistedMessage, PersistedSubMessage } from '../types';
import { Result, ok } from '../types';
import { getDb } from '../database/index.js';
import { getStatements } from '../database/statements.js';
import { safeJsonParse } from '../utils/safeJsonParse.js';

interface MessageRow {
  id: string;
  pod_id: string;
  canvas_id: string;
  role: string;
  content: string;
  timestamp: string;
  sub_messages_json: string | null;
}

function rowToMessage(row: MessageRow): PersistedMessage {
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.timestamp,
    ...(row.sub_messages_json ? { subMessages: safeJsonParse<PersistedSubMessage[]>(row.sub_messages_json) ?? undefined } : {}),
  };
}

class MessageStore {
  private get stmts(): ReturnType<typeof getStatements> {
    return getStatements(getDb());
  }

  async addMessage(
    canvasId: string,
    podId: string,
    role: 'user' | 'assistant',
    content: string,
    subMessages?: PersistedSubMessage[]
  ): Promise<Result<PersistedMessage>> {
    const message: PersistedMessage = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
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
    });

    return ok(message);
  }

  getMessages(podId: string): PersistedMessage[] {
    return (this.stmts.message.selectByPodId.all(podId) as MessageRow[]).map(rowToMessage);
  }

  clearMessages(podId: string): void {
    this.stmts.message.deleteByPodId.run(podId);
  }

  upsertMessage(canvasId: string, podId: string, message: PersistedMessage): void {
    this.stmts.message.upsert.run({
      $id: message.id,
      $podId: podId,
      $canvasId: canvasId,
      $role: message.role,
      $content: message.content,
      $timestamp: message.timestamp,
      $subMessagesJson: message.subMessages ? JSON.stringify(message.subMessages) : null,
    });
  }

}

export const messageStore = new MessageStore();
