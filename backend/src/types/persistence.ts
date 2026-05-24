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

export interface PersistedRunGoalRoundDivider {
  type: "goal-round-divider";
  id: string;
  runId: string;
  podId: string;
  sourcePodIds: string[];
  sourcePodNames: string[];
  status: "completed" | "blocked";
  blockedReason: string | null;
  completedAt: string;
  connectionIds: string[];
}
