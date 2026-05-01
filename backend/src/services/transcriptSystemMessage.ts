import { v4 as uuidv4 } from "uuid";
import type {
  ChatEmitStrategy,
  ExecutionStrategy,
} from "./executionStrategy.js";
import type { PersistedMessage } from "../types/persistence.js";
import type { SystemMessageMetadata } from "../types/message.js";

export function buildSystemMessage(params: {
  content: string;
  metadata: SystemMessageMetadata;
  id?: string;
}): PersistedMessage {
  return {
    id: params.id ?? uuidv4(),
    role: "system",
    content: params.content,
    metadata: params.metadata,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 將 system message 持久化並透過 WebSocket 發送給前端。
 *
 * @param params.emitStrategy - 可選。若呼叫端已持有 emitStrategy（如 StreamContext），
 *   請直接傳入以重用已建立的實例，避免 createEmitStrategy() 重複建立物件造成 GC 壓力。
 *   若未傳入，則內部呼叫 strategy.createEmitStrategy() 建立新實例（向後相容）。
 */
export function appendSystemMessage(params: {
  canvasId: string;
  podId: string;
  content: string;
  metadata: SystemMessageMetadata;
  strategy: ExecutionStrategy;
  /** 已建立的 emitStrategy，可重用以避免重複呼叫 createEmitStrategy() */
  emitStrategy?: ChatEmitStrategy;
  id?: string;
}): PersistedMessage {
  const { canvasId, podId, content, metadata, strategy, emitStrategy, id } =
    params;
  const message = buildSystemMessage({ content, metadata, id });

  strategy.persistMessage(podId, message);
  // 優先使用呼叫端傳入的 emitStrategy（效能優先），否則透過 strategy 建立新實例（向後相容）
  const emit = emitStrategy ?? strategy.createEmitStrategy();
  emit.emitSystemMessage({
    canvasId,
    podId,
    messageId: message.id,
    content: message.content,
    metadata,
  });

  return message;
}
