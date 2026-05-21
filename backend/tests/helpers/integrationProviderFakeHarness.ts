import { createHash, createHmac } from "crypto";
import type {
  IntegrationApp,
  IntegrationResource,
} from "../../src/services/integration/types.js";
import type { IntegrationConnectionStatus } from "../../src/types/integration.js";
import type { SlackClient } from "../../src/services/integration/providers/slackClient.js";

export interface IntegrationFakeAppOptions {
  provider: string;
  id?: string;
  name?: string;
  config?: Record<string, unknown>;
  connectionStatus?: IntegrationConnectionStatus;
  resources?: IntegrationResource[];
}

export function createIntegrationFakeApp(
  options: IntegrationFakeAppOptions,
): IntegrationApp {
  return {
    id: options.id ?? `app-${options.provider}-fake`,
    name: options.name ?? `${options.provider}-fake`,
    provider: options.provider,
    config: options.config ?? {},
    connectionStatus: options.connectionStatus ?? "connected",
    resources: options.resources ?? [],
  };
}

export function createJsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function createSentryWebhookRequest(options: {
  appName: string;
  clientSecret: string;
  payload?: unknown;
  signature?: string;
}): Request {
  const payload =
    options.payload ??
    createSentryIssuePayload({
      title: "Fake Sentry issue",
      shortId: "FAKE-1",
    });
  const rawBody = JSON.stringify(payload);
  const signature =
    options.signature ??
    createHmac("sha256", options.clientSecret).update(rawBody).digest("hex");

  return new Request(`http://localhost/sentry/events/${options.appName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "sentry-hook-signature": signature,
      "sentry-hook-resource": "issue",
    },
    body: rawBody,
  });
}

export function createSlackWebhookRequest(options: {
  signingSecret: string;
  payload?: unknown;
  timestampSeconds?: number;
  signature?: string;
}): Request {
  const payload =
    options.payload ??
    createSlackAppMentionPayload({ text: "<@U_BOT> fake slack event" });
  const rawBody = JSON.stringify(payload);
  const timestamp = String(
    options.timestampSeconds ?? Math.floor(Date.now() / 1000),
  );
  const baseString = `v0:${timestamp}:${rawBody}`;
  const signature =
    options.signature ??
    `v0=${createHmac("sha256", options.signingSecret)
      .update(baseString)
      .digest("hex")}`;

  return new Request("http://localhost/slack/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body: rawBody,
  });
}

export function createJiraWebhookRequest(options: {
  appName: string;
  webhookSecret: string;
  payload?: unknown;
  signature?: string;
}): Request {
  const payload =
    options.payload ??
    createJiraIssuePayload({
      webhookEvent: "jira:issue_created",
      issueKey: "FAKE-1",
    });
  const rawBody = JSON.stringify(payload);
  const signature =
    options.signature ??
    `sha256=${createHmac("sha256", options.webhookSecret)
      .update(rawBody)
      .digest("hex")}`;

  return new Request(`http://localhost/jira/events/${options.appName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature": signature,
    },
    body: rawBody,
  });
}

export function createWebhookProviderRequest(options: {
  appName: string;
  token: string;
  payload?: unknown;
  bearerToken?: string;
}): Request {
  return createJsonRequest(
    `http://localhost/webhook/${options.appName}`,
    options.payload ?? { event: "fake-webhook-event" },
    {
      authorization: `Bearer ${options.bearerToken ?? options.token}`,
    },
  );
}

export function createSentryIssuePayload(options: {
  title?: string;
  shortId?: string;
  culprit?: string;
  projectName?: string;
  issueUrl?: string;
  action?: string;
} = {}): Record<string, unknown> {
  return {
    action: options.action ?? "created",
    data: {
      issue: {
        title: options.title ?? "Fake Sentry issue",
        shortId: options.shortId ?? "FAKE-1",
        culprit: options.culprit ?? "fake.module",
        web_url: options.issueUrl ?? "https://sentry.example/issues/1",
      },
      project: {
        name: options.projectName ?? "Fake Project",
      },
    },
  };
}

export function createSlackAppMentionPayload(options: {
  text?: string;
  eventId?: string;
  channel?: string;
  user?: string;
  ts?: string;
} = {}): Record<string, unknown> {
  const ts = options.ts ?? "1710000000.000100";
  return {
    type: "event_callback",
    event_id: options.eventId ?? "EvFakeSlack",
    event_time: Math.floor(Date.now() / 1000),
    api_app_id: "A_FAKE",
    event: {
      type: "app_mention",
      channel: options.channel ?? "C_FAKE",
      user: options.user ?? "U_FAKE",
      text: options.text ?? "<@U_BOT> fake slack event",
      ts,
      event_ts: ts,
    },
  };
}

export function createJiraIssuePayload(options: {
  webhookEvent?: string;
  issueKey?: string;
  summary?: string;
  userName?: string;
  timestamp?: number;
} = {}): Record<string, unknown> {
  return {
    webhookEvent: options.webhookEvent ?? "jira:issue_created",
    timestamp: options.timestamp ?? Date.now(),
    issue: {
      key: options.issueKey ?? "FAKE-1",
      fields: { summary: options.summary ?? "Fake Jira issue" },
    },
    user: { displayName: options.userName ?? "Fake User" },
    changelog: {
      items: [{ field: "status", fromString: "Todo", toString: "Done" }],
    },
  };
}

export function createTelegramMessagePayload(options: {
  chatId?: number;
  messageId?: number;
  text?: string;
  username?: string;
  isBot?: boolean;
} = {}): Record<string, unknown> {
  return {
    message_id: options.messageId ?? 100,
    from: {
      id: 200,
      is_bot: options.isBot ?? false,
      username: options.username ?? "fake_user",
      first_name: "Fake",
    },
    chat: {
      id: options.chatId ?? 300,
      type: "private",
      username: options.username ?? "fake_user",
    },
    text: options.text ?? "fake telegram message",
  };
}

export interface FakeSlackClientOptions {
  botUserId?: string;
  channels?: Array<{ id: string; name: string; is_member?: boolean }>;
  postMessageError?: Error;
}

export interface FakeSlackClient extends SlackClient {
  postedMessages: Array<{
    channel: string;
    text: string;
    thread_ts?: string;
  }>;
}

export function createFakeSlackClient(
  options: FakeSlackClientOptions = {},
): FakeSlackClient {
  const postedMessages: FakeSlackClient["postedMessages"] = [];
  return {
    postedMessages,
    auth: {
      async test() {
        return { user_id: options.botUserId ?? "U_FAKE_BOT" };
      },
    },
    chat: {
      async postMessage(args) {
        if (options.postMessageError) throw options.postMessageError;
        postedMessages.push(args);
        return { ok: true };
      },
    },
    conversations: {
      async list() {
        return {
          channels:
            options.channels ??
            [{ id: "C_FAKE", name: "fake-channel", is_member: true }],
          response_metadata: { next_cursor: "" },
        };
      },
    },
  };
}

export type FetchCall = {
  url: string;
  init?: RequestInit;
};

export function createQueuedFetchFake(
  responses: Array<{ status?: number; body: unknown }> = [
    { body: { ok: true, result: { username: "fake_bot" } } },
  ],
): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];

  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      const next = queue.shift() ?? { status: 500, body: { ok: false } };
      return Response.json(next.body, { status: next.status ?? 200 });
    },
  };
}

export function createWebhookBodyHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
