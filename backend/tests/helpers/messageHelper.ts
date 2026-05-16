import type { TestWebSocketClient } from "../setup";
import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse } from "../setup";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type ChatSendPayload,
} from "../../src/schemas";

export async function seedPodMessages(
  client: TestWebSocketClient,
  podId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<void> {
  if (!client.id) {
    throw new Error("Socket not connected");
  }

  const canvasModule = await import("../../src/services/canvasStore.js");
  const canvasId = canvasModule.canvasStore.getActiveCanvas(client.id);

  if (!canvasId) {
    throw new Error("No active canvas for socket");
  }

  for (const message of messages) {
    if (message.role === "user") {
      const payload: ChatSendPayload = {
        requestId: uuidv4(),
        canvasId,
        podId,
        message: message.content,
      };

      await emitAndWaitResponse(
        client,
        WebSocketRequestEvents.POD_CHAT_SEND,
        WebSocketResponseEvents.RUN_CHAT_COMPLETE,
        payload,
      );
    }
  }
}
