import { expect } from "vitest";
import { nextTick } from "vue";
import { websocketClient, WebSocketResponseEvents } from "@/services/websocket";
import { useChatStore } from "@/stores/chat/chatStore";
import { startFakeWebSocketServer } from "@tests/helpers/fakeWebSocketServer";
import type { WebSocketMessage } from "@/types/websocket";

type FakeServer = ReturnType<typeof startFakeWebSocketServer>;

export async function waitForExpect(
  assertion: () => void,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await nextTick();
    }
  }

  throw lastError;
}

export async function connectChatStoreToFakeServer(
  server: FakeServer,
  socketId = "socket-test",
): Promise<void> {
  const chatStore = useChatStore();

  chatStore.registerListeners();
  chatStore.connectionStatus = "connecting";
  websocketClient.disconnect();
  websocketClient.connect(server.url);

  const client = await server.waitForConnection();
  client.send(WebSocketResponseEvents.CONNECTION_READY, { socketId });

  await waitForExpect(() => {
    expect(chatStore.connectionStatus).toBe("connected");
    expect(chatStore.socketId).toBe(socketId);
  });
}

export async function disconnectChatStoreFromFakeServer(
  server?: FakeServer,
): Promise<void> {
  const chatStore = useChatStore();
  chatStore.unregisterListeners();
  websocketClient.disconnect();
  websocketClient.isConnected.value = false;
  websocketClient.disconnectReason.value = null;
  server?.close();
  await nextTick();
}

export function expectMessagePayload<TPayload>(
  message: WebSocketMessage,
): TPayload {
  return message.payload as TPayload;
}
