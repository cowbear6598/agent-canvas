import { v4 as uuidv4 } from "uuid";
import type { ExecutionStrategy } from "./executionStrategy.js";
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

export function appendSystemMessage(params: {
  canvasId: string;
  podId: string;
  content: string;
  metadata: SystemMessageMetadata;
  strategy: ExecutionStrategy;
  id?: string;
}): PersistedMessage {
  const { canvasId, podId, content, metadata, strategy, id } = params;
  const message = buildSystemMessage({ content, metadata, id });

  strategy.persistMessage(podId, message);
  strategy.createEmitStrategy().emitSystemMessage({
    canvasId,
    podId,
    messageId: message.id,
    content: message.content,
    metadata,
  });

  return message;
}
