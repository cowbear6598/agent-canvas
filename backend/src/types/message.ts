export type MessageRole = "user" | "assistant" | "system";

export type SystemMessageSeverity = "info" | "warning" | "error" | "fatal";

export interface SystemMessageMetadata {
  provider: string;
  code: string | null;
  severity: SystemMessageSeverity;
  rawContent: string;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  base64Data: string;
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

export interface ToolUseInfo {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: string | null;
}

export interface Message {
  id: string;
  podId: string;
  role: MessageRole;
  content: string;
  metadata?: SystemMessageMetadata;
  toolUse: ToolUseInfo | null;
  createdAt: Date;
  sessionId?: string;
}
