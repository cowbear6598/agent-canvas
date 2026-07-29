import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";
import { ok, err } from "../../../types/index.js";
import type { Result } from "../../../types/index.js";
import { escapeUserInput } from "../../../utils/escapeInput.js";
import { integrationAppStore } from "../integrationAppStore.js";
import { integrationEventPipeline } from "../integrationEventPipeline.js";
import { createDedupTracker } from "../dedupHelper.js";
import {
  broadcastConnectionStatus,
  parseWebhookBody,
} from "../integrationHelpers.js";
import type {
  IntegrationProvider,
  IntegrationApp,
  IntegrationAppConfig,
  IntegrationResource,
  NormalizedEvent,
} from "../types.js";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_NAME_LENGTH = 50;
const MAX_BODY_SIZE = 1_000_000;
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

export type JiraEventFilter = "all" | "status_changed";

function isStatusChangedEvent(rawEvent: unknown): boolean {
  if (typeof rawEvent !== "object" || rawEvent === null) return false;
  const event = rawEvent as Record<string, unknown>;
  if (event["webhookEvent"] !== "jira:issue_updated") return false;
  const changelog = event["changelog"];
  if (typeof changelog !== "object" || changelog === null) return false;
  const items = (changelog as Record<string, unknown>)["items"];
  if (!Array.isArray(items)) return false;
  return items.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as Record<string, unknown>)["field"] === "status",
  );
}

export function shouldFilterJiraEvent(
  eventFilter: string | undefined,
  rawEvent: unknown,
): boolean {
  if (eventFilter === undefined || eventFilter === "all") return false;
  if (eventFilter === "status_changed") return !isStatusChangedEvent(rawEvent);
  return false;
}

const SUPPORTED_EVENTS = new Set([
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
]);

const dedupTracker = createDedupTracker();

const jiraIssueSchema = z.object({
  key: z.string(),
  fields: z
    .object({
      summary: z.string().optional(),
    })
    .optional(),
});

const jiraUserSchema = z.object({
  displayName: z.string().optional(),
  emailAddress: z.string().optional(),
});

const jiraChangelogItemSchema = z.object({
  field: z.string(),
  fromString: z.string().nullable().optional(),
  toString: z.string().nullable().optional(),
});

const jiraChangelogSchema = z.object({
  items: z.array(jiraChangelogItemSchema).optional(),
});

const jiraWebhookPayloadSchema = z.object({
  webhookEvent: z.string(),
  timestamp: z.number(),
  user: jiraUserSchema.optional(),
  issue: jiraIssueSchema.optional(),
  changelog: jiraChangelogSchema.optional(),
});

type JiraWebhookPayload = z.infer<typeof jiraWebhookPayloadSchema>;

function findStatusChange(
  payload: JiraWebhookPayload,
): { from: string; to: string } | null {
  const statusItem = payload.changelog?.items?.find(
    (item) => item.field === "status",
  );
  if (!statusItem) return null;
  return {
    from: escapeUserInput(statusItem.fromString ?? ""),
    to: escapeUserInput(statusItem.toString ?? ""),
  };
}

function buildNonStatusChangeSummary(payload: JiraWebhookPayload): string | null {
  const changes =
    payload.changelog?.items
      ?.filter((item) => item.field !== "status")
      .map((item) => {
        const field = escapeUserInput(item.field);
        const from = escapeUserInput(item.fromString ?? "");
        const to = escapeUserInput(item.toString ?? "");
        return `${field}: ${from} → ${to}`;
      }) ?? [];

  if (changes.length === 0) return null;
  return changes.join(", ");
}

function verifyJiraSignature(
  webhookSecret: string,
  rawBody: string,
  signatureHeader: string,
): boolean {
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const expectedHex = signatureHeader.slice(prefix.length);
  const hmac = createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(hmac, "hex"),
      Buffer.from(expectedHex, "hex"),
    );
  } catch {
    return false;
  }
}

function formatJiraEventMessage(
  webhookEvent: string,
  issueKey: string,
  summary: string,
  payload: JiraWebhookPayload,
): string {
  const escapedIssueKey = escapeUserInput(issueKey);
  const escapedSummary = escapeUserInput(summary);
  const messageParts = [
    `<issue-number>${escapedIssueKey}</issue-number>`,
    `<title>${escapedSummary}</title>`,
  ];

  if (webhookEvent === "jira:issue_updated") {
    const statusChange = findStatusChange(payload);
    if (statusChange) {
      messageParts.push(
        `<pre-status>${statusChange.from}</pre-status>`,
        `<next-status>${statusChange.to}</next-status>`,
      );
    }

    const nonStatusSummary = buildNonStatusChangeSummary(payload);
    if (nonStatusSummary) {
      messageParts.push(`<changes>${nonStatusSummary}</changes>`);
    }
  }

  return messageParts.join("\n");
}

class JiraProvider implements IntegrationProvider {
  readonly name = "jira";
  readonly displayName = "Jira";
  readonly secretConfigKeys = ["webhookSecret"] as const;
  readonly webhookPathMatchMode = "prefix" as const;

  readonly createAppSchema = z.object({
    siteUrl: z
      .string()
      .url("siteUrl 必須為合法 URL")
      .refine((url) => url.startsWith("https://"), "siteUrl 必須使用 https://")
      .transform((url) => url.replace(/\/$/, "")),
    webhookSecret: z.string().min(16, "Webhook Secret 至少需要 16 個字元"),
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
    return {
      siteUrl: config.siteUrl,
    };
  }

  async initialize(app: IntegrationApp): Promise<void> {
    integrationAppStore.updateStatus(app.id, "connected");
    broadcastConnectionStatus(this.name, app.id);
  }

  destroy(appId: string): void {
    integrationAppStore.updateStatus(appId, "disconnected");
    broadcastConnectionStatus(this.name, appId);
  }

  destroyAll(): void {
    // 無狀態，無需特別清理
  }

  async refreshResources(_appId: string): Promise<IntegrationResource[]> {
    return [];
  }

  formatEventMessage(
    event: unknown,
    app: IntegrationApp,
  ): NormalizedEvent | null {
    const parsed = jiraWebhookPayloadSchema.safeParse(event);
    if (!parsed.success) return null;

    const payload = parsed.data;
    const { webhookEvent } = payload;

    const issueKey = payload.issue?.key ?? "";
    const summary = payload.issue?.fields?.summary ?? "";
    const userName =
      payload.user?.displayName ?? payload.user?.emailAddress ?? "unknown";
    const text = formatJiraEventMessage(
      webhookEvent,
      issueKey,
      summary,
      payload,
    );

    return {
      provider: this.name,
      appId: app.id,
      resourceId: "*",
      userName,
      text,
      rawEvent: event,
    };
  }

  readonly webhookPath = "/jira/events";

  async handleWebhookRequest(
    req: Request,
    subPath?: string,
  ): Promise<Response> {
    if (!subPath || !NAME_PATTERN.test(subPath)) {
      return new Response("Not Found", { status: 404 });
    }

    const appName = subPath;
    const app = integrationAppStore.getByProviderAndName("jira", appName);
    if (!app) {
      return new Response("Not Found", { status: 404 });
    }

    const parsed = await parseWebhookBody(req, MAX_BODY_SIZE);
    if (parsed instanceof Response) return parsed;

    const { rawBody, payload: rawPayload } = parsed;

    const signatureHeader = req.headers.get("X-Hub-Signature");
    if (!signatureHeader) {
      return new Response("Forbidden", { status: 403 });
    }

    const webhookSecret = app.config.webhookSecret;
    if (
      typeof webhookSecret !== "string" ||
      webhookSecret.length === 0 ||
      !verifyJiraSignature(webhookSecret, rawBody, signatureHeader)
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    // 簽章驗證通過後，檢查 timestamp 時間窗口防止重放攻擊
    const rawPayloadObj =
      typeof rawPayload === "object" && rawPayload !== null
        ? (rawPayload as Record<string, unknown>)
        : null;
    const timestampMs =
      rawPayloadObj !== null && typeof rawPayloadObj["timestamp"] === "number"
        ? rawPayloadObj["timestamp"]
        : null;
    if (timestampMs === null) {
      return new Response("Forbidden", { status: 403 });
    }
    if (Math.abs(Date.now() - timestampMs) > MAX_WEBHOOK_AGE_MS) {
      return new Response("Forbidden", { status: 403 });
    }

    // 用 signature 做防重放（防止攻擊者重放已驗證的請求）
    if (dedupTracker.isDuplicate(signatureHeader)) {
      return new Response("OK", { status: 200 });
    }

    const schemaResult = jiraWebhookPayloadSchema.safeParse(rawPayload);
    if (!schemaResult.success) {
      return new Response("OK", { status: 200 });
    }

    const webhookPayload = schemaResult.data;
    const { webhookEvent } = webhookPayload;

    if (!SUPPORTED_EVENTS.has(webhookEvent)) {
      return new Response("OK", { status: 200 });
    }

    const issueKey = webhookPayload.issue?.key ?? "";
    const summary = webhookPayload.issue?.fields?.summary ?? "";
    const userName =
      webhookPayload.user?.displayName ??
      webhookPayload.user?.emailAddress ??
      "unknown";
    const text = formatJiraEventMessage(
      webhookEvent,
      issueKey,
      summary,
      webhookPayload,
    );

    const normalizedEvent: NormalizedEvent = {
      provider: this.name,
      appId: app.id,
      resourceId: "*",
      userName,
      text,
      rawEvent: rawPayload,
    };

    // Jira 要求快速回應，使用 fire-and-forget 非同步處理
    integrationEventPipeline.safeProcessEvent(
      this.name,
      app.id,
      normalizedEvent,
    );

    return new Response("OK", { status: 200 });
  }
}

export const jiraProvider = new JiraProvider();
