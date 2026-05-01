import type { PodProvider } from "./pod";

export type MessageRole = "user" | "assistant" | "system";

export type SystemMessageSeverity = "info" | "warning" | "error" | "fatal";

export interface SystemMessageMetadata {
  /** Provider 名稱（必填），與後端契約一致 */
  provider: PodProvider;
  /** 結構化錯誤代碼（必填，無代碼時為 null），與後端契約一致 */
  code: string | null;
  severity: SystemMessageSeverity;
  /** Provider 原始錯誤文字（必填），與後端契約一致 */
  rawContent: string;
}

export type HistoryLoadingStatus = "idle" | "loading" | "loaded" | "error";

export type ToolUseStatus = "pending" | "running" | "completed" | "error";

const VALID_TOOL_USE_STATUSES: ToolUseStatus[] = [
  "pending",
  "running",
  "completed",
  "error",
];

export function isValidToolUseStatus(value: unknown): value is ToolUseStatus {
  return (
    typeof value === "string" &&
    (VALID_TOOL_USE_STATUSES as string[]).includes(value)
  );
}

export interface ToolUseInfo {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string | Record<string, unknown> | unknown[];
  status: ToolUseStatus;
}

export interface SubMessage {
  id: string;
  content: string;
  isPartial?: boolean;
  toolUse?: ToolUseInfo[];
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  metadata?: SystemMessageMetadata;
  isPartial?: boolean;
  toolUse?: ToolUseInfo[];
  timestamp?: string;
  isSummarized?: boolean;
  sourceInfo?: { podId: string; podName: string };
  subMessages?: SubMessage[];
}
