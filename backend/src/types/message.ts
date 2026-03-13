export type MessageRole = 'user' | 'assistant';

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
  toolUse: ToolUseInfo | null;
  createdAt: Date;
  sessionId?: string;
}
