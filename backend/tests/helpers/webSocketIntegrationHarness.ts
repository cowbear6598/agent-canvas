import {
  closeTestServer,
  createTestServer,
  type TestServerInstance,
} from "../setup/testServer.js";
import {
  createSocketClient,
  disconnectSocket,
  emitAndWaitResponse,
  waitForEvent,
  type TestWebSocketClient,
} from "../setup/socketClient.js";
import { createEventCollector, type EventCollector } from "./eventCollector.js";

export interface WebSocketIntegrationClient {
  client: TestWebSocketClient;
  canvasId: string;
  emit: <TPayload>(eventName: string, payload: TPayload) => void;
  waitFor: <TPayload = unknown>(
    eventName: string,
    timeout?: number,
  ) => Promise<TPayload>;
  request: <TRequest, TResponse>(
    requestEvent: string,
    responseEvent: string,
    payload: TRequest,
    timeout?: number,
  ) => Promise<TResponse>;
  collectEvents: (eventNames?: string[]) => EventCollector;
  disconnect: () => Promise<void>;
}

export interface WebSocketIntegrationHarness extends WebSocketIntegrationClient {
  server: TestServerInstance;
  baseUrl: string;
  wsUrl: string;
  connectClient: (canvasId?: string) => Promise<WebSocketIntegrationClient>;
  cleanup: () => Promise<void>;
}

function createClientFacade(
  client: TestWebSocketClient,
  canvasId: string,
): WebSocketIntegrationClient {
  return {
    client,
    canvasId,
    emit: (eventName, payload) => client.emit(eventName, payload),
    waitFor: (eventName, timeout) =>
      waitForEvent(client, eventName, timeout),
    request: (requestEvent, responseEvent, payload, timeout) =>
      emitAndWaitResponse(
        client,
        requestEvent,
        responseEvent,
        payload,
        timeout,
      ),
    collectEvents: (eventNames = []) => createEventCollector(client, eventNames),
    disconnect: () => disconnectSocket(client),
  };
}

export async function createWebSocketIntegrationHarness(
  canvasId?: string,
): Promise<WebSocketIntegrationHarness> {
  const server = await createTestServer();
  const clients = new Set<TestWebSocketClient>();

  const connectClient = async (targetCanvasId = canvasId ?? server.canvasId) => {
    const client = await createSocketClient(server.baseUrl, targetCanvasId);
    clients.add(client);
    return createClientFacade(client, targetCanvasId);
  };

  const primary = await connectClient();

  return {
    ...primary,
    server,
    baseUrl: server.baseUrl,
    wsUrl: server.wsUrl,
    connectClient,
    cleanup: async () => {
      await Promise.all(
        [...clients].map(async (client) => {
          if (client.connected) {
            await disconnectSocket(client);
          }
        }),
      );
      await closeTestServer(server);
    },
  };
}
