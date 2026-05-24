import { WebSocketResponseEvents } from "../schemas/index.js";
import { socketService } from "./socketService.js";
import type { ChatEmitStrategy } from "./executionStrategy.js";
import type { SystemMessageMetadata } from "../types/message.js";

/**
 * 建立 Chat 的事件發送策略。
 * 使用 RUN 相關 WebSocket 事件向前端廣播，並附帶 runId。
 */
export function createChatEmitStrategy(runId: string): ChatEmitStrategy {
  return {
    emitText({ canvasId, podId, messageId, content }): void {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        {
          runId,
          canvasId,
          podId,
          messageId,
          content,
          isPartial: true,
          role: "assistant",
        },
      );
    },
    emitToolUse({
      canvasId,
      podId,
      messageId,
      toolUseId,
      toolName,
      input,
    }): void {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_TOOL_USE,
        {
          runId,
          canvasId,
          podId,
          messageId,
          toolUseId,
          toolName,
          input,
        },
      );
    },
    emitToolResult({
      canvasId,
      podId,
      messageId,
      toolUseId,
      toolName,
      output,
    }): void {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT,
        {
          runId,
          canvasId,
          podId,
          messageId,
          toolUseId,
          toolName,
          output,
        },
      );
    },
    emitComplete({ canvasId, podId, messageId, fullContent }): void {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_COMPLETE,
        {
          runId,
          canvasId,
          podId,
          messageId,
          fullContent,
        },
      );
    },
    emitGoalRoundDivider({ canvasId, divider }): void {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_GOAL_ROUND_DIVIDER,
        {
          ...divider,
          canvasId,
        },
      );
    },
    emitSystemMessage({
      canvasId,
      podId,
      messageId,
      content,
      metadata,
    }: {
      canvasId: string;
      podId: string;
      messageId: string;
      content: string;
      metadata: SystemMessageMetadata;
    }): void {
      socketService.emitToCanvas(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        {
          runId,
          canvasId,
          podId,
          messageId,
          content,
          isPartial: false,
          role: "system",
          metadata,
        },
      );
    },
  };
}
