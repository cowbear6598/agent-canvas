import type { WebSocketMessage } from "@/types/websocket";

type FakeWebSocketPayload = string | ArrayBuffer | Uint8Array;

interface BunRuntime {
  serve<TData>(options: {
    hostname?: string;
    port: number;
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
  port?: number;
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
const TEST_HOSTNAME = "127.0.0.1";
const TEST_PORT_BASE = 43000;
const TEST_PORT_BLOCK = 200;
const TEST_PORT_RETRY_COUNT = 200;
const workerId = Number(process.env.VITEST_POOL_ID ?? "0");
const initialTestPort =
  TEST_PORT_BASE + (workerId % 50) * TEST_PORT_BLOCK + (process.pid % 10) * 10;
const TEST_PORT_COUNTER_KEY = "__claudeCodeCanvasFakeWsNextPort";

function getBunRuntime(): BunRuntime {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  if (!runtime) {
    throw new Error("fakeWebSocketServer requires the Bun test runtime.");
  }
  return runtime;
}

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "EADDRINUSE"
  );
}

function getNextTestPort(): number {
  const testGlobal = globalThis as typeof globalThis & {
    __claudeCodeCanvasFakeWsNextPort?: number;
  };

  if (testGlobal[TEST_PORT_COUNTER_KEY] === undefined) {
    testGlobal[TEST_PORT_COUNTER_KEY] = initialTestPort;
  }

  const port = testGlobal[TEST_PORT_COUNTER_KEY] ?? initialTestPort;
  testGlobal[TEST_PORT_COUNTER_KEY] = port + 1;
  return port;
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
  const runtime = getBunRuntime();
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

  let server: BunServer | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < TEST_PORT_RETRY_COUNT; attempt += 1) {
    const port = getNextTestPort();

    try {
      server = runtime.serve<SocketData>({
        port,
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
            const typedSocket = socket as FakeClientSocket;
            sockets.set(typedSocket.data.id, typedSocket);
            const client = createClient(typedSocket);
            clients.set(typedSocket.data.id, client);
            pendingConnectionResolvers.forEach((resolve) => resolve(client));
            pendingConnectionResolvers.clear();
          },
          async message(socket, rawMessage) {
            const typedSocket = socket as FakeClientSocket;
            const message = parseIncomingMessage(rawMessage);
            receivedMessages.push(message);
            pendingMessageResolvers.forEach((resolve) => {
              if (resolve(message)) {
                pendingMessageResolvers.delete(resolve);
              }
            });

            const client = clients.get(typedSocket.data.id);
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
            const typedSocket = socket as FakeClientSocket;
            sockets.delete(typedSocket.data.id);
            clients.delete(typedSocket.data.id);
          },
        },
      });
      break;
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  if (!server) {
    throw lastError ?? new Error("Failed to allocate a test WebSocket port.");
  }

  const resolvedPort = server.port ?? Number(server.url.port);

  return {
    url: `http://${TEST_HOSTNAME}:${resolvedPort}`,
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
