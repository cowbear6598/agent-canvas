import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { WebClient } from "@slack/web-api";
import { ok, err } from "../../../types/index.js";
import type { Result } from "../../../types/index.js";
import { logger } from "../../../utils/logger.js";
import { getErrorMessage } from "../../../utils/errorHelpers.js";
import { integrationAppStore } from "../integrationAppStore.js";
import { integrationEventPipeline } from "../integrationEventPipeline.js";
import { createDedupTracker } from "../dedupHelper.js";
import {
  destroyProvider,
  initializeProvider,
  formatIntegrationMessage,
  parseWebhookBody,
} from "../integrationHelpers.js";
import { escapeUserInput } from "../../../utils/escapeInput.js";
import type {
  IntegrationApp,
  IntegrationAppConfig,
  IntegrationProvider,
  IntegrationResource,
  NormalizedEvent,
} from "../types.js";

const SLACK_CHANNEL_LIST_PAGE_SIZE = 200;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_BODY_SIZE = 1_000_000;
const MAX_SLACK_MESSAGE_LENGTH = 4000;
const SLACK_USER_ID_REGEX = /^[A-Z0-9]{6,12}$/;

const dedupTracker = createDedupTracker();

const slackEventSchema = z.object({
  type: z.string(),
  channel: z.string(),
  user: z.string().optional(),
  text: z.string(),
  ts: z.string(),
  event_ts: z.string(),
  thread_ts: z.string().optional(),
});

const slackEventPayloadSchema = z.object({
  type: z.literal("event_callback"),
  event_id: z.string().min(1),
  event_time: z.number(),
  api_app_id: z.string().min(1),
  event: slackEventSchema,
});

type SlackEventPayload = z.infer<typeof slackEventPayloadSchema>;

type AppMentionEvent = z.infer<typeof slackEventSchema>;

function isTimestampValid(timestampSeconds: string): boolean {
  const ts = parseInt(timestampSeconds, 10);
  if (isNaN(ts)) return false;
  return Math.abs(Date.now() - ts * 1000) < FIVE_MINUTES_MS;
}

function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  try {
    return timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch {
    // timingSafeEqual 在兩個 Buffer 長度不同時會拋出，視為簽名不符合直接回傳 false
    return false;
  }
}

function verifySignatureHeaders(
  req: Request,
): { timestamp: string; signature: string } | Response {
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (!timestamp) {
    logger.warn(
      "Integration",
      "Error",
      "缺少 x-slack-request-timestamp header",
    );
    return new Response("Forbidden", { status: 403 });
  }

  if (!signature) {
    logger.warn("Integration", "Error", "缺少 x-slack-signature header");
    return new Response("Forbidden", { status: 403 });
  }

  if (!isTimestampValid(timestamp)) {
    logger.warn("Integration", "Error", "Slack 請求 timestamp 已過期");
    return new Response("Forbidden", { status: 403 });
  }

  return { timestamp, signature };
}

function findMatchedApp(
  timestamp: string,
  rawBody: string,
  signature: string,
  apps: IntegrationApp[],
): IntegrationApp | null {
  return (
    apps.find((app) => {
      const signingSecret = app.config["signingSecret"];
      if (typeof signingSecret !== "string") return false;
      return verifySlackSignature(signingSecret, timestamp, rawBody, signature);
    }) ?? null
  );
}

async function handleUrlVerification(
  body: Record<string, unknown>,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<Response> {
  const apps = integrationAppStore.list("slack");
  const matchedApp = findMatchedApp(timestamp, rawBody, signature, apps);

  if (!matchedApp) {
    logger.warn(
      "Integration",
      "Error",
      "Slack 簽名驗證失敗（url_verification）",
    );
    return new Response("Forbidden", { status: 403 });
  }

  const challenge = body["challenge"];
  if (!challenge || typeof challenge !== "string" || challenge.length === 0) {
    return new Response("缺少或無效的 challenge 欄位", { status: 400 });
  }

  return Response.json({ challenge });
}

/**
 * 查找符合簽名驗證的 Slack App。
 * 整合「查 app + 驗簽」兩個步驟，驗證失敗時回傳 null。
 */
function findVerifiedApp(
  timestamp: string,
  rawBody: string,
  signature: string,
): IntegrationApp | null {
  const apps = integrationAppStore.list("slack");
  return findMatchedApp(timestamp, rawBody, signature, apps);
}

async function handleEventCallback(
  body: Record<string, unknown>,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<Response> {
  const apiAppId = body["api_app_id"];
  if (!apiAppId || typeof apiAppId !== "string") {
    return new Response("缺少 api_app_id 欄位", { status: 400 });
  }

  const app = findVerifiedApp(timestamp, rawBody, signature);

  if (!app) {
    logger.warn("Integration", "Error", "Slack 簽名驗證失敗");
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = slackEventPayloadSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn(
      "Integration",
      "Error",
      `無效的事件格式: ${parsed.error.message}`,
    );
    return new Response("無效的事件格式", { status: 400 });
  }

  const eventPayload: SlackEventPayload = parsed.data;
  const { event_id, event } = eventPayload;

  if (dedupTracker.isDuplicate(event_id)) {
    logger.log(
      "Integration",
      "Complete",
      `重複的 event_id ${event_id}，略過處理`,
    );
    return new Response("OK", { status: 200 });
  }

  if (event.type !== "app_mention") {
    return new Response("OK", { status: 200 });
  }

  const normalizedEvent = slackProvider.formatEventMessage(
    event as AppMentionEvent,
    app,
  );
  if (!normalizedEvent) {
    return new Response("OK", { status: 200 });
  }

  // Slack 要求 3 秒內回應，使用 fire-and-forget 非同步處理
  integrationEventPipeline.safeProcessEvent("slack", app.id, normalizedEvent);

  return new Response("OK", { status: 200 });
}

class SlackProvider implements IntegrationProvider {
  readonly name = "slack";
  readonly displayName = "Slack";
  readonly strictResourceValidation = true;

  readonly createAppSchema = z.object({
    botToken: z.string().startsWith("xoxb-"),
    signingSecret: z
      .string()
      .regex(/^[a-f0-9]{32}$/, "Signing Secret 格式不正確"),
  });

  private clients: Map<string, WebClient> = new Map();

  /** 頻道清單快取：避免高頻 refreshResources 呼叫時重複全量拉取 Slack API */
  private channelCache: Map<
    string,
    { channels: IntegrationResource[]; expiresAt: number }
  > = new Map();

  /** 頻道快取 TTL：60 秒 */
  private static readonly CHANNEL_CACHE_TTL_MS = 60_000;

  validateCreate(config: IntegrationAppConfig): Result<void> {
    const botToken = config["botToken"];
    if (typeof botToken !== "string") {
      return err("botToken 格式不正確");
    }

    const existing = integrationAppStore.getByProviderAndConfigField(
      "slack",
      "$.botToken",
      botToken,
    );
    if (existing) {
      return err("已存在使用相同 Bot Token 的 Slack App");
    }

    return ok(undefined);
  }

  sanitizeConfig(_config: IntegrationAppConfig): Record<string, unknown> {
    return {};
  }

  async initialize(app: IntegrationApp): Promise<void> {
    await initializeProvider(
      app,
      async () => {
        const botToken = app.config["botToken"];
        if (typeof botToken !== "string") {
          logger.error(
            "Integration",
            "Error",
            `Slack App ${app.id} 缺少 botToken`,
          );
          return false;
        }

        const client = new WebClient(botToken);

        try {
          const authResult = await client.auth.test();
          if (authResult.user_id) {
            integrationAppStore.updateExtraJson(app.id, {
              botUserId: authResult.user_id,
            });
          }
        } catch (error) {
          logger.error(
            "Integration",
            "Error",
            `Slack App ${app.id} 初始化失敗：${getErrorMessage(error)}`,
          );
          return false;
        }

        this.clients.set(app.id, client);
        return true;
      },
      async () => {
        const client = this.clients.get(app.id);
        if (!client) return;
        try {
          await this.fetchAndUpdateChannels(app.id, client);
        } catch (error) {
          logger.warn(
            "Integration",
            "Warn",
            `Slack App ${app.id} 取得頻道失敗，繼續初始化：${getErrorMessage(error)}`,
          );
        }
      },
      "Slack",
    );
  }

  destroy(appId: string): void {
    destroyProvider(
      this.clients as Map<string, unknown>,
      appId,
      "slack",
      "Slack",
    );
  }

  destroyAll(): void {
    this.clients.clear();
    logger.log("Integration", "Complete", "已清除所有 Slack WebClient");
  }

  async refreshResources(appId: string): Promise<IntegrationResource[]> {
    const client = this.clients.get(appId);
    if (!client) {
      logger.warn(
        "Integration",
        "Warn",
        `Slack App ${appId} 尚未初始化，無法重新整理頻道`,
      );
      return [];
    }

    // 主動 refresh 時 forceRefresh = true，確保拿到最新頻道清單
    return this.fetchAndUpdateChannels(appId, client, true);
  }

  async sendMessage(
    appId: string,
    resourceId: string,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<Result<void>> {
    const client = this.clients.get(appId);
    if (!client) {
      return err(`Slack App ${appId} 尚未初始化`);
    }

    const senderId =
      typeof extra?.["senderId"] === "string" ? extra["senderId"] : undefined;
    const messageTs =
      typeof extra?.["messageTs"] === "string" ? extra["messageTs"] : undefined;
    const threadTs =
      typeof extra?.["threadTs"] === "string" ? extra["threadTs"] : undefined;

    const finalText =
      senderId && SLACK_USER_ID_REGEX.test(senderId)
        ? `<@${senderId}> ${text}`
        : text;
    const finalThreadTs = threadTs ?? messageTs;

    try {
      await client.chat.postMessage({
        channel: resourceId,
        text: finalText,
        thread_ts: finalThreadTs,
      });
      return ok(undefined);
    } catch (error) {
      logger.error(
        "Integration",
        "Error",
        `發送訊息至頻道 ${resourceId} 失敗：${getErrorMessage(error)}`,
      );
      return err("發送訊息失敗");
    }
  }

  buildAckExtra(event: NormalizedEvent): Record<string, unknown> {
    return {
      senderId: event.senderId,
      messageTs: event.messageTs,
      threadTs: event.threadTs,
    };
  }

  formatEventMessage(
    event: unknown,
    app: IntegrationApp,
  ): NormalizedEvent | null {
    const mentionEvent = event as AppMentionEvent;
    const { channel, user, text, ts, thread_ts } = mentionEvent;

    const rawCleanedText = text.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, "").trim();
    const truncatedText =
      rawCleanedText.length > MAX_SLACK_MESSAGE_LENGTH
        ? rawCleanedText.slice(0, MAX_SLACK_MESSAGE_LENGTH) +
          "\n...(訊息過長，已截斷)"
        : rawCleanedText;
    const cleanedText = escapeUserInput(truncatedText);

    const userName = user ?? "unknown";
    const formattedText = formatIntegrationMessage(
      "Slack",
      userName,
      cleanedText,
    );

    return {
      provider: "slack",
      appId: app.id,
      resourceId: channel,
      userName,
      text: formattedText,
      rawEvent: event,
      senderId: user,
      messageTs: ts,
      threadTs: thread_ts,
    };
  }

  readonly webhookPath = "/slack/events";

  async handleWebhookRequest(req: Request): Promise<Response> {
    const parsed = await parseWebhookBody(req, MAX_BODY_SIZE);
    if (parsed instanceof Response) return parsed;

    const { rawBody, payload } = parsed;
    const body = payload as Record<string, unknown>;

    const headersResult = verifySignatureHeaders(req);
    if (headersResult instanceof Response) {
      return headersResult;
    }

    const { timestamp, signature } = headersResult;

    if (body.type === "url_verification") {
      return handleUrlVerification(body, timestamp, rawBody, signature);
    }

    if (body.type === "event_callback") {
      return handleEventCallback(body, timestamp, rawBody, signature);
    }

    logger.warn(
      "Integration",
      "Error",
      `收到未知的 Slack 事件類型: ${body.type}`,
    );
    return new Response("OK", { status: 200 });
  }

  private async fetchAndUpdateChannels(
    appId: string,
    client: WebClient,
    forceRefresh = false,
  ): Promise<IntegrationResource[]> {
    // 被動讀取時（forceRefresh = false）優先回傳快取，避免高頻呼叫重複拉取 Slack API
    if (!forceRefresh) {
      const cached = this.channelCache.get(appId);
      if (cached && Date.now() < cached.expiresAt) {
        logger.log(
          "Integration",
          "Complete",
          `Slack App ${appId} 頻道清單命中快取（${cached.channels.length} 個頻道）`,
        );
        return cached.channels;
      }
    }

    const channels: IntegrationResource[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.conversations.list({
        types: "public_channel,private_channel",
        cursor,
        limit: SLACK_CHANNEL_LIST_PAGE_SIZE,
      });

      const filteredChannels = (result.channels ?? [])
        .filter((ch) => ch.is_member && ch.id && ch.name)
        .map((ch) => ({ id: ch.id as string, name: ch.name as string }));

      channels.push(...filteredChannels);
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // 更新快取與 DB
    this.channelCache.set(appId, {
      channels,
      expiresAt: Date.now() + SlackProvider.CHANNEL_CACHE_TTL_MS,
    });
    integrationAppStore.updateResources(appId, channels);
    logger.log(
      "Integration",
      "Complete",
      `Slack App ${appId} 取得 ${channels.length} 個頻道`,
    );

    return channels;
  }
}

export const slackProvider = new SlackProvider();
