import type { WebSocketMessage } from "@/types/websocket";

type FakeWebSocketPayload = string | ArrayBuffer | Uint8Array;

interface BunRuntime {
  serve<TData>(options: {
    port?: number;
    fetch: (
      request: Request,
      server: {
        upgrade: (request: Request, options?: { data?: TData }) => boolean;
      },
    ) => Response | undefined;
    websocket: {
      open?: (socket: BunServerWebSocket<TData>) => void;
      message?: (
        socket: BunServerWebSocket<TData>,
        message: FakeWebSocketPayload,
      ) => void | Promise<void>;
      close?: (
        socket: BunServerWebSocket<TData>,
        code: number,
        reason: string,
      ) => void;
    };
  }): BunServer;
}

interface BunServer {
  url: URL;
  stop(force?: boolean): void;
}

interface BunServerWebSocket<TData> {
  data: TData;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

interface SocketData {
  id: string;
}

type FakeClientSocket = BunServerWebSocket<SocketData>;

type MessageHandler<TMessage extends WebSocketMessage = WebSocketMessage> = (
  message: TMessage,
  client: FakeWebSocketClient,
) => void | Promise<void>;

interface WaitOptions {
  timeoutMs?: number;
}

export interface FakeWebSocketRoute<TRequest extends WebSocketMessage> {
  requestEvent: string;
  responseEvent: string;
  buildPayload: (
    request: TRequest,
    client: FakeWebSocketClient,
  ) => unknown | Promise<unknown>;
}

export interface FakeWebSocketServerOptions {
  routes?: FakeWebSocketRoute<WebSocketMessage>[];
  onMessage?: MessageHandler;
}

export interface FakeWebSocketClient {
  id: string;
  send<TPayload>(
    type: string,
    payload: TPayload,
    requestId?: string,
  ): void;
  close(code?: number, reason?: string): void;
}

const DEFAULT_WAIT_TIMEOUT_MS = 1000;

function getBunRuntime(): BunRuntime {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  if (!runtime) {
    throw new Error("fakeWebSocketServer requires the Bun test runtime.");
  }
  return runtime;
}

function waitFor<T>(
  resolveNow: () => T | undefined,
  subscribe: (resolve: (value: T) => void) => () => void,
  options?: WaitOptions,
): Promise<T> {
  const existing = resolveNow();
  if (existing !== undefined) {
    return Promise.resolve(existing);
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    let unsubscribe = (): void => {};
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for fake WebSocket event.`,
        ),
      );
    }, timeoutMs);

    unsubscribe = subscribe((value) => {
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(value);
    });
  });
}

function parseIncomingMessage(message: FakeWebSocketPayload): WebSocketMessage {
  const text =
    typeof message === "string" ? message : new TextDecoder().decode(message);
  return JSON.parse(text) as WebSocketMessage;
}

export function startFakeWebSocketServer(
  options: FakeWebSocketServerOptions = {},
) {
  let clientCounter = 0;
  const sockets = new Map<string, FakeClientSocket>();
  const clients = new Map<string, FakeWebSocketClient>();
  const receivedMessages: WebSocketMessage[] = [];
  const pendingConnectionResolvers = new Set<
    (client: FakeWebSocketClient) => void
  >();
  const pendingMessageResolvers = new Set<
    (message: WebSocketMessage) => boolean
  >();

  const createClient = (socket: FakeClientSocket): FakeWebSocketClient => ({
    id: socket.data.id,
    send(type, payload, requestId) {
      const response: WebSocketMessage = { type, payload, requestId };
      socket.send(JSON.stringify(response));
    },
    close(code, reason) {
      socket.close(code, reason);
    },
  });

  const server = getBunRuntime().serve<SocketData>({
    port: 0,
    fetch(request, bunServer) {
      const upgraded = bunServer.upgrade(request, {
        data: { id: `fake-ws-client-${++clientCounter}` },
      });
      if (upgraded) {
        return undefined;
      }
      return new Response("Expected WebSocket upgrade", { status: 426 });
    },
    websocket: {
      open(socket) {
        sockets.set(socket.data.id, socket);
        const client = createClient(socket);
        clients.set(socket.data.id, client);
        pendingConnectionResolvers.forEach((resolve) => resolve(client));
        pendingConnectionResolvers.clear();
      },
      async message(socket, rawMessage) {
        const message = parseIncomingMessage(rawMessage);
        receivedMessages.push(message);
        pendingMessageResolvers.forEach((resolve) => {
          if (resolve(message)) {
            pendingMessageResolvers.delete(resolve);
          }
        });

        const client = clients.get(socket.data.id);
        if (!client) {
          return;
        }

        const route = options.routes?.find(
          (candidate) => candidate.requestEvent === message.type,
        );
        if (route) {
          const payload = await route.buildPayload(message, client);
          client.send(route.responseEvent, payload, message.requestId);
        }

        await options.onMessage?.(message, client);
      },
      close(socket) {
        sockets.delete(socket.data.id);
        clients.delete(socket.data.id);
      },
    },
  });

  return {
    url: server.url.toString(),
    receivedMessages,
    get clients(): FakeWebSocketClient[] {
      return Array.from(clients.values());
    },
    waitForConnection(options?: WaitOptions): Promise<FakeWebSocketClient> {
      return waitFor(
        () => Array.from(clients.values())[0],
        (resolve) => {
          pendingConnectionResolvers.add(resolve);
          return () => pendingConnectionResolvers.delete(resolve);
        },
        options,
      );
    },
    waitForMessage<TMessage extends WebSocketMessage = WebSocketMessage>(
      predicate?: (message: TMessage) => boolean,
      options?: WaitOptions,
    ): Promise<TMessage> {
      const matches = (message: WebSocketMessage): message is TMessage =>
        !predicate || predicate(message as TMessage);

      return waitFor(
        () => receivedMessages.find(matches),
        (resolve) => {
          const resolver = (message: WebSocketMessage): boolean => {
            if (matches(message)) {
              resolve(message);
              return true;
            }
            return false;
          };
          pendingMessageResolvers.add(resolver);
          return () => pendingMessageResolvers.delete(resolver);
        },
        options,
      );
    },
    emit<TPayload>(type: string, payload: TPayload, requestId?: string): void {
      clients.forEach((client) => client.send(type, payload, requestId));
    },
    close(): void {
      clients.forEach((client) => client.close(1000, "fake server closed"));
      sockets.clear();
      clients.clear();
      server.stop(true);
    },
  };
}
