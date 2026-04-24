export type StreamEvent =
  | TextStreamEvent
  | ToolUseStreamEvent
  | ToolResultStreamEvent
  | CompleteStreamEvent
  | ErrorStreamEvent;

interface TextStreamEvent {
  type: "text";
  content: string;
}

interface ToolUseStreamEvent {
  type: "tool_use";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolResultStreamEvent {
  type: "tool_result";
  toolUseId: string;
  toolName: string;
  output: string;
}

interface CompleteStreamEvent {
  type: "complete";
}

interface ErrorStreamEvent {
  type: "error";
  error: string;
  /** true 代表嚴重錯誤，串流應立即中斷 */
  fatal?: boolean;
}

export type StreamCallback = (event: StreamEvent) => void;
