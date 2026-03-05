export interface PersistedToolUseInfo {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'completed' | 'error';
}

export interface PersistedSubMessage {
  id: string;
  content: string;
  toolUse?: PersistedToolUseInfo[];
}

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  subMessages?: PersistedSubMessage[];
}

