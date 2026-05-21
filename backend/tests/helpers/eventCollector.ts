import type { TestWebSocketClient } from "../setup/socketClient.js";

export interface CollectedEvent<TPayload = unknown> {
  name: string;
  payload: TPayload;
  receivedAt: number;
}

export interface EventCollectorOptions<TPayload = unknown> {
  timeout?: number;
  predicate?: (payload: TPayload) => boolean;
}

type EventPayloadMatcher<TPayload> =
  | Partial<TPayload>
  | ((payload: TPayload) => boolean);

type EventHandler = (payload: unknown) => void;

interface EventWaiter<TPayload = unknown> {
  eventName: string;
  predicate?: (payload: TPayload) => boolean;
  resolve: (event: CollectedEvent<TPayload>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface EventCollector {
  listenTo: (eventName: string | string[]) => void;
  stop: () => void;
  clear: () => void;
  all: () => CollectedEvent[];
  byName: <TPayload = unknown>(eventName: string) => CollectedEvent<TPayload>[];
  latest: <TPayload = unknown>(
    eventName: string,
  ) => CollectedEvent<TPayload> | undefined;
  waitFor: <TPayload = unknown>(
    eventName: string,
    options?: EventCollectorOptions<TPayload>,
  ) => Promise<CollectedEvent<TPayload>>;
  expectEvent: <TPayload = unknown>(
    eventName: string,
    matcher?: EventPayloadMatcher<TPayload>,
  ) => CollectedEvent<TPayload>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepPartialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === actual) return true;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    return expected.every((item, index) => deepPartialMatch(actual[index], item));
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      deepPartialMatch(actual[key], value),
    );
  }

  return false;
}

function matchesPayload<TPayload>(
  payload: TPayload,
  matcher?: EventPayloadMatcher<TPayload>,
): boolean {
  if (!matcher) return true;
  if (typeof matcher === "function") return matcher(payload);
  return deepPartialMatch(payload, matcher);
}

export function createEventCollector(
  client: Pick<TestWebSocketClient, "on" | "off">,
  eventNames: string[] = [],
): EventCollector {
  const events: CollectedEvent[] = [];
  const handlers = new Map<string, EventHandler>();
  const waiters = new Set<EventWaiter>();

  const resolveMatchingWaiters = (event: CollectedEvent) => {
    for (const waiter of [...waiters]) {
      if (waiter.eventName !== event.name) continue;

      const predicate = waiter.predicate as
        | ((payload: unknown) => boolean)
        | undefined;
      if (predicate && !predicate(event.payload)) continue;

      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  };

  const listenTo = (eventNameOrNames: string | string[]) => {
    const names = Array.isArray(eventNameOrNames)
      ? eventNameOrNames
      : [eventNameOrNames];

    for (const eventName of names) {
      if (handlers.has(eventName)) continue;

      const handler = (payload: unknown) => {
        const event: CollectedEvent = {
          name: eventName,
          payload,
          receivedAt: Date.now(),
        };

        events.push(event);
        resolveMatchingWaiters(event);
      };

      handlers.set(eventName, handler);
      client.on(eventName, handler);
    }
  };

  const stop = () => {
    for (const [eventName, handler] of handlers.entries()) {
      client.off(eventName, handler);
    }
    handlers.clear();

    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Stopped waiting for event: ${waiter.eventName}`));
    }
    waiters.clear();
  };

  const byName = <TPayload = unknown>(
    eventName: string,
  ): CollectedEvent<TPayload>[] =>
    events.filter((event) => event.name === eventName) as CollectedEvent<TPayload>[];

  const latest = <TPayload = unknown>(
    eventName: string,
  ): CollectedEvent<TPayload> | undefined => byName<TPayload>(eventName).at(-1);

  const waitFor = <TPayload = unknown>(
    eventName: string,
    options: EventCollectorOptions<TPayload> = {},
  ): Promise<CollectedEvent<TPayload>> => {
    listenTo(eventName);

    const existing = byName<TPayload>(eventName).find((event) =>
      options.predicate ? options.predicate(event.payload) : true,
    );
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const waiter: EventWaiter<TPayload> = {
        eventName,
        predicate: options.predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.delete(waiter as EventWaiter);
          reject(new Error(`Timeout waiting for event: ${eventName}`));
        }, options.timeout ?? 5000),
      };

      waiters.add(waiter as EventWaiter);
    });
  };

  const expectEvent = <TPayload = unknown>(
    eventName: string,
    matcher?: EventPayloadMatcher<TPayload>,
  ): CollectedEvent<TPayload> => {
    const event = byName<TPayload>(eventName).find((candidate) =>
      matchesPayload(candidate.payload, matcher),
    );

    if (!event) {
      throw new Error(`Expected collected event: ${eventName}`);
    }

    return event;
  };

  listenTo(eventNames);

  return {
    listenTo,
    stop,
    clear: () => {
      events.length = 0;
    },
    all: () => [...events],
    byName,
    latest,
    waitFor,
    expectEvent,
  };
}
