import type { MessageRole, SystemMessageMetadata } from "./message.js";

export interface PersistedToolUseInfo {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  status: "completed" | "error";
}

export interface PersistedSubMessage {
  id: string;
  content: string;
  toolUse?: PersistedToolUseInfo[];
}

export interface PersistedMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: SystemMessageMetadata;
  subMessages?: PersistedSubMessage[];
}
