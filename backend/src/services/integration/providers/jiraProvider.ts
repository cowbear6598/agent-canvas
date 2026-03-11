import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { ok, err } from '../../../types/index.js';
import type { Result } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';
import { getErrorMessage } from '../../../utils/errorHelpers.js';
import { escapeUserInput } from '../../../utils/escapeInput.js';
import { integrationAppStore } from '../integrationAppStore.js';
import { integrationEventPipeline } from '../integrationEventPipeline.js';
import { createDedupTracker } from '../dedupHelper.js';
import { destroyProvider, initializeProvider, parseWebhookBody } from '../integrationHelpers.js';
import type { IntegrationProvider, IntegrationApp, IntegrationAppConfig, IntegrationResource, NormalizedEvent } from '../types.js';

// SSRF 防護：封鎖私有 IP 範圍
const PRIVATE_IP_PATTERN = /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|localhost)/i;

export function isPrivateUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return PRIVATE_IP_PATTERN.test(hostname) || isPrivate172Range(hostname);
  } catch {
    return false;
  }
}

function isPrivate172Range(hostname: string): boolean {
  const match = hostname.match(/^172\.(\d+)\./);
  if (!match) return false;
  const second = parseInt(match[1], 10);
  return second >= 16 && second <= 31;
}

const MAX_BODY_SIZE = 1_000_000;

const SUPPORTED_EVENTS = new Set(['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted']);

const dedupTracker = createDedupTracker();

const jiraIssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().optional(),
  }).optional(),
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

interface JiraClientInfo {
  authHeader: string;
  siteUrl: string;
}

function verifyJiraSignature(webhookSecret: string, rawBody: string, signatureHeader: string): boolean {
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const expectedHex = signatureHeader.slice(prefix.length);
  const hmac = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

function findMatchedApp(rawBody: string, signature: string, apps: IntegrationApp[]): IntegrationApp | null {
  return apps.find((app) => {
    const webhookSecret = app.config.webhookSecret as string | undefined;
    if (!webhookSecret) return false;
    return verifyJiraSignature(webhookSecret, rawBody, signature);
  }) ?? null;
}

function formatJiraEventMessage(webhookEvent: string, issueKey: string, summary: string, userName: string, payload: JiraWebhookPayload): string {
  const escapedUserName = escapeUserInput(userName);
  const escapedIssueKey = escapeUserInput(issueKey);
  const escapedSummary = escapeUserInput(summary);

  if (webhookEvent === 'jira:issue_created') {
    return `[Jira: ${escapedUserName}] <user_data>建立了 Issue ${escapedIssueKey}: ${escapedSummary}</user_data>`;
  }

  if (webhookEvent === 'jira:issue_updated') {
    const changelogItems = payload.changelog?.items ?? [];
    const changelogDesc = changelogItems
      .map((item) => {
        const field = escapeUserInput(item.field);
        const from = escapeUserInput(item.fromString ?? '');
        const to = escapeUserInput(item.toString ?? '');
        return `${field}: ${from} → ${to}`;
      })
      .join(', ');
    return `[Jira: ${escapedUserName}] <user_data>更新了 Issue ${escapedIssueKey}: ${escapedSummary}\n變更: ${changelogDesc}</user_data>`;
  }

  return `[Jira: ${escapedUserName}] <user_data>刪除了 Issue ${escapedIssueKey}: ${escapedSummary}</user_data>`;
}

class JiraProvider implements IntegrationProvider {
  readonly name = 'jira';
  readonly displayName = 'Jira';

  readonly createAppSchema = z.object({
    siteUrl: z
      .string()
      .url('siteUrl 必須為合法 URL')
      .refine((url) => url.startsWith('https://'), 'siteUrl 必須使用 https://')
      .refine((url) => !isPrivateUrl(url), 'siteUrl 不可指向私有 IP 或 localhost')
      .transform((url) => url.replace(/\/$/, '')),
    email: z.string().email('email 格式不正確'),
    apiToken: z.string().min(1),
    webhookSecret: z.string().min(1),
  });

  readonly bindSchema = z.object({
    resourceId: z.string().min(1),
  });

  private clients: Map<string, JiraClientInfo> = new Map();

  // AppStore 層

  validateCreate(config: IntegrationAppConfig): Result<void> {
    const siteUrl = config.siteUrl as string | undefined;
    const email = config.email as string | undefined;

    if (!siteUrl || !email) {
      return err('siteUrl 和 email 為必填欄位');
    }

    const existing = integrationAppStore.getByProviderAndConfigField('jira', '$.siteUrl', siteUrl);
    if (existing) {
      const existingEmail = existing.config.email as string | undefined;
      if (existingEmail === email) {
        return err('此 Site URL 與 Email 組合已存在');
      }
    }

    return ok(undefined);
  }

  sanitizeConfig(config: IntegrationAppConfig): Record<string, unknown> {
    return {
      siteUrl: config.siteUrl,
      email: config.email,
    };
  }

  // ClientManager 層

  async initialize(app: IntegrationApp): Promise<void> {
    await initializeProvider(
      app,
      async () => {
        const { siteUrl, email, apiToken } = app.config as { siteUrl: string; email: string; apiToken: string };

        if (isPrivateUrl(siteUrl)) {
          logger.error('Jira', 'Error', `Jira App ${app.id} 初始化失敗：siteUrl 指向私有 IP 或 localhost`);
          return false;
        }

        const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;

        try {
          const res = await fetch(`${siteUrl}/rest/api/3/myself`, {
            headers: { Authorization: authHeader, Accept: 'application/json' },
          });

          if (!res.ok) {
            throw new Error(`API 驗證失敗，狀態碼：${res.status}`);
          }
        } catch (error) {
          logger.error('Jira', 'Error', `Jira App ${app.id} 初始化失敗：${getErrorMessage(error)}`);
          return false;
        }

        this.clients.set(app.id, { authHeader, siteUrl });
        return true;
      },
      async () => {
        const client = this.clients.get(app.id);
        if (!client) return;
        try {
          await this.fetchProjects(app.id, client.siteUrl, client.authHeader);
        } catch (error) {
          logger.warn('Jira', 'Warn', `Jira App ${app.id} 取得 Projects 失敗，繼續初始化：${getErrorMessage(error)}`);
        }
      },
      'Jira',
    );
  }

  destroy(appId: string): void {
    destroyProvider(this.clients as Map<string, unknown>, appId, 'Jira');
  }

  destroyAll(): void {
    this.clients.clear();
    logger.log('Jira', 'Complete', '已清除所有 Jira Client');
  }

  async refreshResources(appId: string): Promise<IntegrationResource[]> {
    const client = this.clients.get(appId);
    if (!client) {
      throw new Error(`Jira App ${appId} 尚未初始化`);
    }

    return this.fetchProjects(appId, client.siteUrl, client.authHeader);
  }

  // EventService 層

  formatEventMessage(event: unknown, app: IntegrationApp): NormalizedEvent | null {
    const parsed = jiraWebhookPayloadSchema.safeParse(event);
    if (!parsed.success) return null;

    const payload = parsed.data;
    const { webhookEvent } = payload;

    const issueKey = payload.issue?.key ?? '';
    const projectKey = issueKey.split('-')[0] ?? '';

    if (!projectKey) {
      logger.warn('Jira', 'Warn', `[JiraProvider] 無法從 issue.key 解析 projectKey：${issueKey}`);
      return null;
    }

    const summary = payload.issue?.fields?.summary ?? '';
    const userName = payload.user?.displayName ?? payload.user?.emailAddress ?? 'unknown';
    const text = formatJiraEventMessage(webhookEvent, issueKey, summary, userName, payload);

    return {
      provider: this.name,
      appId: app.id,
      resourceId: projectKey,
      userName,
      text,
      rawEvent: event,
    };
  }

  // Webhook 層

  readonly webhookPath = '/jira/events';

  async handleWebhookRequest(req: Request): Promise<Response> {
    const parsed = await parseWebhookBody(req, MAX_BODY_SIZE);
    if (parsed instanceof Response) return parsed;

    const { rawBody, payload: rawPayload } = parsed;

    const signatureHeader = req.headers.get('X-Hub-Signature');
    if (!signatureHeader) {
      logger.warn('Jira', 'Error', '缺少 X-Hub-Signature header');
      return new Response('Forbidden', { status: 403 });
    }

    const jiraApps = integrationAppStore.list('jira');
    const matchedApp = findMatchedApp(rawBody, signatureHeader, jiraApps);
    if (!matchedApp) {
      logger.warn('Jira', 'Error', 'Jira 簽名驗證失敗');
      return new Response('Forbidden', { status: 403 });
    }

    // 簽章驗證通過後，用 signature 做防重放（防止攻擊者重放已驗證的請求）
    if (dedupTracker.isDuplicate(signatureHeader)) {
      logger.log('Jira', 'Complete', '重複的 Webhook 簽章，略過處理');
      return new Response('OK', { status: 200 });
    }

    const schemaResult = jiraWebhookPayloadSchema.safeParse(rawPayload);
    if (!schemaResult.success) {
      logger.warn('Jira', 'Error', `無效的 Webhook payload：${schemaResult.error.message}`);
      return new Response('OK', { status: 200 });
    }

    const webhookPayload = schemaResult.data;
    const { webhookEvent } = webhookPayload;

    if (!SUPPORTED_EVENTS.has(webhookEvent)) {
      logger.log('Jira', 'Complete', `收到不支援的 Jira 事件類型：${webhookEvent}，略過`);
      return new Response('OK', { status: 200 });
    }

    const normalizedEvent = this.formatEventMessage(rawPayload, matchedApp);
    if (!normalizedEvent) {
      return new Response('OK', { status: 200 });
    }

    // Jira 要求快速回應，使用 fire-and-forget 非同步處理
    integrationEventPipeline.processEvent(this.name, matchedApp.id, normalizedEvent).catch((error) => {
      logger.error('Jira', 'Error', `處理 Jira 事件 ${webhookEvent} 失敗`, error);
    });

    return new Response('OK', { status: 200 });
  }

  private async fetchProjects(appId: string, siteUrl: string, authHeader: string): Promise<IntegrationResource[]> {
    if (isPrivateUrl(siteUrl)) {
      throw new Error(`Jira App ${appId} fetchProjects 失敗：siteUrl 指向私有 IP 或 localhost`);
    }

    const res = await fetch(`${siteUrl}/rest/api/3/project`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`取得 Projects 失敗，狀態碼：${res.status}`);
    }

    const data = await res.json() as Array<{ key: string; name: string }>;
    const resources: IntegrationResource[] = data.map((p) => ({ id: p.key, name: p.name }));

    integrationAppStore.updateResources(appId, resources);
    logger.log('Jira', 'Complete', `Jira App ${appId} 取得 ${resources.length} 個 Projects`);

    return resources;
  }

}

export const jiraProvider = new JiraProvider();
