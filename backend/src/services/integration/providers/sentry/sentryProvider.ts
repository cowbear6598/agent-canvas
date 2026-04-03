import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";
import { ok, err } from "../../../../types/index.js";
import type { Result } from "../../../../types/index.js";
import { logger } from "../../../../utils/logger.js";
import { escapeUserInput } from "../../../../utils/escapeInput.js";
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
const SUPPORTED_ACTIONS = new Set(["created", "unresolved"]);

const dedupTracker = createDedupTracker();

const sentryWebhookPayloadSchema = z.object({
  action: z.string(),
  data: z.object({
    issue: z.object({
      title: z.string(),
      shortId: z.string().optional(),
      culprit: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      web_url: z.string().optional(),
    }),
    project: z
      .object({
        name: z.string().optional(),
        slug: z.string().optional(),
      })
      .optional(),
  }),
});

type SentryWebhookPayload = z.infer<typeof sentryWebhookPayloadSchema>;

function verifySentrySignature(
  clientSecret: string,
  rawBody: string,
  signatureHeader: string,
): boolean {
  const hmac = createHmac("sha256", clientSecret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(hmac, "hex"),
      Buffer.from(signatureHeader, "hex"),
    );
  } catch {
    return false;
  }
}

function formatSentryIssueMessage(
  projectName: string,
  issueTitle: string,
  culprit: string,
  issueUrl: string,
  shortId?: string,
): string {
  const escapedIssueTitle = escapeUserInput(issueTitle);
  const escapedCulprit = escapeUserInput(culprit);
  const escapedIssueUrl = escapeUserInput(issueUrl);
  const titleLine = shortId
    ? `偵測到新 Issue：[${escapeUserInput(shortId)}] ${escapedIssueTitle}`
    : `偵測到新 Issue：${escapedIssueTitle}`;
  const content = `${titleLine}\nCulprit：${escapedCulprit}\nURL：${escapedIssueUrl}`;
  return formatIntegrationMessage("Sentry", projectName, content);
}

class SentryProvider implements IntegrationProvider {
  readonly name = "sentry";
  readonly displayName = "Sentry";
  readonly webhookPath = "/sentry/events";
  readonly webhookPathMatchMode = "prefix" as const;

  readonly createAppSchema = z.object({
    clientSecret: z.string().min(32, "Client Secret 至少需要 32 個字元"),
  });

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

  sanitizeConfig(_config: IntegrationAppConfig): Record<string, unknown> {
    return {};
  }

  async initialize(app: IntegrationApp): Promise<void> {
    integrationAppStore.updateStatus(app.id, "connected");
    broadcastConnectionStatus(this.name, app.id);
    logger.log("Sentry", "Complete", `Sentry App ${app.id} 初始化成功`);
  }

  destroy(appId: string): void {
    integrationAppStore.updateStatus(appId, "disconnected");
    broadcastConnectionStatus(this.name, appId);
    logger.log("Sentry", "Complete", `Sentry App ${appId} 已移除`);
  }

  destroyAll(): void {
    logger.log("Sentry", "Complete", "已清除所有 Sentry App");
  }

  async refreshResources(_appId: string): Promise<IntegrationResource[]> {
    return [];
  }

  formatEventMessage(
    event: unknown,
    app: IntegrationApp,
  ): NormalizedEvent | null {
    const parsed = sentryWebhookPayloadSchema.safeParse(event);
    if (!parsed.success) return null;

    const payload: SentryWebhookPayload = parsed.data;
    const issueTitle = payload.data.issue.title;
    const shortId = payload.data.issue.shortId;
    const culprit = payload.data.issue.culprit ?? "";
    const projectName = payload.data.project?.name ?? "Sentry";
    const issueUrl = payload.data.issue.web_url ?? "";

    const text = formatSentryIssueMessage(
      projectName,
      issueTitle,
      culprit,
      issueUrl,
      shortId,
    );

    return {
      provider: this.name,
      appId: app.id,
      resourceId: "*",
      userName: "Sentry",
      text,
      rawEvent: event,
    };
  }

  async handleWebhookRequest(
    req: Request,
    subPath?: string,
  ): Promise<Response> {
    if (!subPath || !NAME_PATTERN.test(subPath)) {
      logger.warn("Sentry", "Error", "缺少或不合法的 appName 子路徑");
      return new Response("Not Found", { status: 404 });
    }

    const appName = subPath;
    const app = integrationAppStore.getByProviderAndName("sentry", appName);
    if (!app) {
      logger.warn("Sentry", "Error", `找不到 Sentry App：${appName}`);
      return new Response("Not Found", { status: 404 });
    }

    const parsed = await parseWebhookBody(req, MAX_BODY_SIZE);
    if (parsed instanceof Response) return parsed;

    const { rawBody, payload: rawPayload } = parsed;

    const signatureHeader = req.headers.get("sentry-hook-signature");
    if (!signatureHeader) {
      logger.warn("Sentry", "Error", "缺少 sentry-hook-signature header");
      return new Response("Forbidden", { status: 403 });
    }

    const clientSecret = app.config.clientSecret;
    if (
      typeof clientSecret !== "string" ||
      clientSecret.length === 0 ||
      !verifySentrySignature(clientSecret, rawBody, signatureHeader)
    ) {
      logger.warn("Sentry", "Error", "Sentry 簽章驗證失敗");
      return new Response("Forbidden", { status: 403 });
    }

    // 簽章驗證通過後，用 signature 做防重放（防止攻擊者重放已驗證的請求）
    if (dedupTracker.isDuplicate(signatureHeader)) {
      logger.log("Sentry", "Complete", "重複的 Webhook 簽章，略過處理");
      return new Response("OK", { status: 200 });
    }

    const hookResource = req.headers.get("sentry-hook-resource");
    if (hookResource !== "issue") {
      logger.log(
        "Sentry",
        "Complete",
        `收到非 issue 類型的 Sentry 事件（${hookResource}），略過`,
      );
      return new Response("OK", { status: 200 });
    }

    const schemaResult = sentryWebhookPayloadSchema.safeParse(rawPayload);
    if (!schemaResult.success) {
      logger.warn(
        "Sentry",
        "Error",
        `無效的 Webhook payload：${schemaResult.error.message}`,
      );
      return new Response("OK", { status: 200 });
    }

    const webhookPayload = schemaResult.data;
    if (!SUPPORTED_ACTIONS.has(webhookPayload.action)) {
      logger.log(
        "Sentry",
        "Complete",
        `收到不支援的 Sentry action（${webhookPayload.action}），略過`,
      );
      return new Response("OK", { status: 200 });
    }

    const normalizedEvent = this.formatEventMessage(webhookPayload, app);
    if (!normalizedEvent) {
      logger.warn("Sentry", "Error", "formatEventMessage 回傳 null，略過處理");
      return new Response("OK", { status: 200 });
    }

    // Sentry 要求快速回應，使用 fire-and-forget 非同步處理
    integrationEventPipeline.safeProcessEvent(
      this.name,
      app.id,
      normalizedEvent,
    );

    return new Response("OK", { status: 200 });
  }
}

export const sentryProvider = new SentryProvider();
