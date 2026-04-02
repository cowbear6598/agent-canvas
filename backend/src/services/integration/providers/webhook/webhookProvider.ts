import { z } from "zod";
import { randomBytes, timingSafeEqual, createHash } from "crypto";
import { ok, err } from "../../../../types/index.js";
import type { Result } from "../../../../types/index.js";
import { logger } from "../../../../utils/logger.js";
import { integrationAppStore } from "../../integrationAppStore.js";
import { integrationEventPipeline } from "../../integrationEventPipeline.js";
import { createDedupTracker } from "../../dedupHelper.js";
import {
  broadcastConnectionStatus,
  parseWebhookBody,
  formatIntegrationMessage,
} from "../../integrationHelpers.js";
import type {
  IntegrationProvider,
  IntegrationApp,
  IntegrationAppConfig,
  IntegrationResource,
  NormalizedEvent,
} from "../../types.js";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_NAME_LENGTH = 50;
const MAX_BODY_SIZE = 1_000_000;
const dedupTracker = createDedupTracker();

class WebhookProvider implements IntegrationProvider {
  readonly name = "webhook";
  readonly displayName = "Webhook";
  readonly webhookPath = "/webhook";
  readonly webhookPathMatchMode = "prefix" as const;

  readonly createAppSchema = z.object({});

  readonly bindSchema = z.object({
    resourceId: z.literal("*"),
  });

  validateCreate(config: IntegrationAppConfig): Result<void> {
    const name = config.name as string | undefined;
    if (name !== undefined) {
      if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
        return err(
          `name 只允許英數字、底線和連字符，最多 ${MAX_NAME_LENGTH} 個字元`,
        );
      }
    }

    return ok(undefined);
  }

  sanitizeConfig(config: IntegrationAppConfig): Record<string, unknown> {
    // token 是系統產生的，使用者需要看到才能配置外部應用
    return { token: config.token };
  }

  getExtraDbFields(_config: IntegrationAppConfig): Record<string, unknown> {
    const token = randomBytes(32).toString("hex");
    return { token };
  }

  async initialize(app: IntegrationApp): Promise<void> {
    integrationAppStore.updateStatus(app.id, "connected");
    broadcastConnectionStatus(this.name, app.id);
    logger.log("Webhook", "Complete", `Webhook App ${app.id} 初始化成功`);
  }

  destroy(appId: string): void {
    integrationAppStore.updateStatus(appId, "disconnected");
    broadcastConnectionStatus(this.name, appId);
    logger.log("Webhook", "Complete", `Webhook App ${appId} 已移除`);
  }

  destroyAll(): void {
    logger.log("Webhook", "Complete", "已清除所有 Webhook App");
  }

  async refreshResources(_appId: string): Promise<IntegrationResource[]> {
    // hasNoResource，不需要 resources
    return [];
  }

  formatEventMessage(
    event: unknown,
    app: IntegrationApp,
  ): NormalizedEvent | null {
    if (event == null) return null;

    const formattedJson = JSON.stringify(event, null, 2);
    const text = formatIntegrationMessage("Webhook", app.name, formattedJson);

    return {
      provider: "webhook",
      appId: app.id,
      resourceId: "*",
      userName: "Webhook",
      text,
      rawEvent: event,
    };
  }

  async handleWebhookRequest(
    req: Request,
    subPath?: string,
  ): Promise<Response> {
    if (!subPath || !NAME_PATTERN.test(subPath)) {
      logger.warn("Webhook", "Error", "缺少或不合法的 appName 子路徑");
      return new Response("Not Found", { status: 404 });
    }

    const appName = subPath;
    const app = integrationAppStore.getByProviderAndName("webhook", appName);
    if (!app) {
      logger.warn("Webhook", "Error", `找不到 Webhook App：${appName}`);
      return new Response("Not Found", { status: 404 });
    }

    const parsed = await parseWebhookBody(req, MAX_BODY_SIZE);
    if (parsed instanceof Response) return parsed;

    const { rawBody, payload } = parsed;

    // 驗證 Bearer Token
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Webhook", "Error", "缺少或格式不符的 Authorization header");
      return new Response("Unauthorized", { status: 401 });
    }

    const incomingToken = authHeader.slice("Bearer ".length);
    const storedToken = app.config.token;
    if (typeof storedToken !== "string" || storedToken.length === 0) {
      logger.warn("Webhook", "Error", "App 缺少有效的 token 設定");
      return new Response("Unauthorized", { status: 401 });
    }

    // 先對兩個 token 分別做 SHA-256 hash，確保長度固定（32 bytes）
    // 避免長度不同時 timingSafeEqual 拋例外導致時間差異洩漏 token 長度
    const hashedIncoming = createHash("sha256").update(incomingToken).digest();
    const hashedStored = createHash("sha256").update(storedToken).digest();
    const tokenValid = timingSafeEqual(hashedIncoming, hashedStored);

    if (!tokenValid) {
      logger.warn("Webhook", "Error", "Bearer Token 驗證失敗");
      return new Response("Unauthorized", { status: 401 });
    }

    // 使用 rawBody hash 做去重
    const hash = createHash("sha256").update(rawBody).digest("hex");
    if (dedupTracker.isDuplicate(hash)) {
      logger.log("Webhook", "Complete", "重複的 Webhook 請求，略過處理");
      return new Response("OK", { status: 200 });
    }

    const normalizedEvent = this.formatEventMessage(payload, app);
    if (!normalizedEvent) {
      logger.warn("Webhook", "Error", "formatEventMessage 回傳 null，略過處理");
      return new Response("OK", { status: 200 });
    }

    // fire-and-forget 非同步處理
    integrationEventPipeline.safeProcessEvent(
      this.name,
      app.id,
      normalizedEvent,
    );

    return new Response("OK", { status: 200 });
  }
}

export const webhookProvider = new WebhookProvider();
