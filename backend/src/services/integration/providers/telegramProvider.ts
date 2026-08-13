import { z } from "zod";
import { ok, err } from "../../../types/index.js";
import type { Result } from "../../../types/index.js";
import { integrationAppStore } from "../integrationAppStore.js";
import { integrationEventPipeline } from "../integrationEventPipeline.js";
import {
  broadcastConnectionStatus,
  initializeProvider,
} from "../integrationHelpers.js";
import { escapeUserInput } from "../../../utils/escapeInput.js";
import { logger } from "../../../utils/logger.js";
import type {
  IntegrationProvider,
  IntegrationApp,
  IntegrationAppConfig,
  IntegrationResource,
  NormalizedEvent,
} from "../types.js";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const POLLING_TIMEOUT = 30;
const MAX_RETRY_DELAY = 60_000;
const INITIAL_RETRY_DELAY = 1_000;
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;

function formatTelegramEventMessage(
  username: string,
  content: string,
): string {
  const escapedUsername = escapeUserInput(username);
  const escapedContent = escapeUserInput(content);
  return `<username>${escapedUsername}</username>\n<message>${escapedContent}</message>`;
}

export interface TelegramApiChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface TelegramApiMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    username?: string;
    first_name?: string;
  };
  chat: TelegramApiChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramApiMessage;
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

const createAppSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, "Bot Token 格式不正確"),
});

class TelegramProvider implements IntegrationProvider {
  readonly name = "telegram";
  readonly displayName = "Telegram";
  readonly secretConfigKeys = ["botToken"] as const;
  readonly createAppSchema = createAppSchema;

  private pollingControllers: Map<string, AbortController> = new Map();
  private pollingOffsets: Map<string, number> = new Map();

  validateCreate(config: IntegrationAppConfig): Result<void> {
    const botToken = config["botToken"] as string | undefined;
    if (!botToken) return err("botToken 為必填");

    const existing = integrationAppStore.getByProviderAndConfigField(
      "telegram",
      "$.botToken",
      botToken,
    );
    if (existing) return err("已存在使用相同 Bot Token 的 Telegram Bot");

    return ok();
  }

  sanitizeConfig(_config: IntegrationAppConfig): Record<string, unknown> {
    return {};
  }

  async initialize(app: IntegrationApp): Promise<void> {
    await initializeProvider(
      app,
      async () => {
        const botToken = app.config["botToken"] as string | undefined;
        if (!botToken) return false;

        const botUsername = await this.fetchBotUsername(botToken);
        if (!botUsername) return false;

        integrationAppStore.updateExtraJson(app.id, { botUsername });
        return true;
      },
      async () => {},
      "Telegram",
    );

    const connectedApp = integrationAppStore.getById(app.id);
    if (connectedApp?.connectionStatus === "connected") {
      this.startPolling(app.id, app.config);
    }
  }

  destroy(appId: string): void {
    this.stopPolling(appId);
    this.pollingOffsets.delete(appId);

    integrationAppStore.updateStatus(appId, "disconnected");
    broadcastConnectionStatus("telegram", appId);
  }

  destroyAll(): void {
    for (const controller of this.pollingControllers.values()) {
      controller.abort();
    }
    this.pollingControllers.clear();
    this.pollingOffsets.clear();
  }

  async refreshResources(_appId: string): Promise<IntegrationResource[]> {
    return [];
  }

  async sendMessage(
    appId: string,
    resourceId: string,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<Result<void>> {
    const app = integrationAppStore.getById(appId);
    if (!app) return err(`找不到 Telegram Bot ${appId}`);

    const botToken = app.config["botToken"] as string | undefined;
    if (!botToken) return err(`Telegram Bot ${appId} 缺少 botToken`);

    const chatId = Number(resourceId);
    if (isNaN(chatId)) {
      return err("無效的 chatId");
    }

    const body: Record<string, unknown> = { chat_id: chatId, text };

    const replyToMessageId = extra?.["replyToMessageId"] as number | undefined;
    if (replyToMessageId !== undefined) {
      body["reply_to_message_id"] = replyToMessageId;
    }

    try {
      const response = await fetch(
        `${TELEGRAM_API_BASE}${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data = (await response.json()) as TelegramApiResponse;
      if (!data.ok) {
        return err("發送訊息失敗");
      }

      return ok();
    } catch {
      return err("發送訊息失敗");
    }
  }

  buildAckExtra(event: NormalizedEvent): Record<string, unknown> {
    return { replyToMessageId: event.messageId };
  }

  formatEventMessage(
    event: unknown,
    app: IntegrationApp,
  ): NormalizedEvent | null {
    const message = event as TelegramApiMessage;
    if (message.from?.is_bot === true) return null;
    if (message.chat.type !== "private") return null;

    const rawText = message.text ?? "";

    const truncatedText =
      rawText.length > MAX_TELEGRAM_MESSAGE_LENGTH
        ? rawText.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH) +
          "\n...(訊息過長，已截斷)"
        : rawText;

    const rawUserName =
      message.from?.username ?? message.from?.first_name ?? "unknown";
    const userName = escapeUserInput(rawUserName);
    const cleanedText = escapeUserInput(truncatedText);
    const chatId = message.chat.id;
    const formattedText = formatTelegramEventMessage(userName, cleanedText);

    return {
      provider: this.name,
      appId: app.id,
      resourceId: String(chatId),
      userName,
      text: formattedText,
      rawEvent: event,
      messageId: message.message_id,
    };
  }

  // 使用 polling，無 webhookPath

  // 每個 Bot 有獨立的 polling 迴圈，透過 AbortController 控制生命週期，避免 memory leak
  startPolling(appId: string, config: IntegrationAppConfig): void {
    const botToken = config["botToken"] as string | undefined;
    if (!botToken) {
      return;
    }

    const existing = this.pollingControllers.get(appId);
    if (existing) {
      existing.abort();
    }

    const controller = new AbortController();
    this.pollingControllers.set(appId, controller);
    if (!this.pollingOffsets.has(appId)) {
      this.pollingOffsets.set(appId, 0);
    }

    this.runPollingLoop(appId, botToken, controller).catch((error) => {
      logger.error(
        "Telegram",
        "Error",
        `[Telegram] polling 迴圈非預期中止：appId=${appId}`,
        error,
      );
    });
  }

  stopPolling(appId: string): void {
    const controller = this.pollingControllers.get(appId);
    if (controller) {
      controller.abort();
      this.pollingControllers.delete(appId);
    }
  }

  private async fetchBotUsername(botToken: string): Promise<string | null> {
    try {
      const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/getMe`);
      const data = (await response.json()) as TelegramApiResponse<{
        username?: string;
      }>;

      if (!data.ok) {
        return null;
      }

      return data.result?.username ?? "";
    } catch {
      return null;
    }
  }

  private processUpdate(appId: string, update: TelegramUpdate): void {
    const message = update.message;
    if (!message) return;

    const app = integrationAppStore.getById(appId);
    if (!app) return;

    const normalizedEvent = this.formatEventMessage(message, app);
    if (!normalizedEvent) return;

    integrationEventPipeline.safeProcessEvent(
      this.name,
      appId,
      normalizedEvent,
    );
  }

  private async getUpdates(
    botToken: string,
    offset: number,
    timeout: number,
    signal: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    const url = `${TELEGRAM_API_BASE}${botToken}/getUpdates?offset=${offset}&timeout=${timeout}`;
    const response = await fetch(url, { signal });
    const data = (await response.json()) as TelegramApiResponse<
      TelegramUpdate[]
    >;

    if (!data.ok) {
      throw new Error(
        `getUpdates 回傳失敗: [${data.error_code}] ${data.description}`,
      );
    }

    return data.result ?? [];
  }

  private async runPollingLoop(
    appId: string,
    botToken: string,
    controller: AbortController,
  ): Promise<void> {
    let retryDelay = INITIAL_RETRY_DELAY;

    while (this.isPollingActive(appId, controller)) {
      const offset = this.pollingOffsets.get(appId) ?? 0;

      try {
        const updates = await this.getUpdates(
          botToken,
          offset,
          POLLING_TIMEOUT,
          controller.signal,
        );
        retryDelay = INITIAL_RETRY_DELAY;

        for (const update of updates) {
          this.processUpdate(appId, update);
          this.pollingOffsets.set(appId, update.update_id + 1);
        }
      } catch {
        if (!this.isPollingActive(appId, controller)) break;

        logger.warn(
          "Telegram",
          "Warn",
          `[Telegram] polling 失敗：appId=${appId}，${retryDelay}ms 後重試`,
        );

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        // destroy 競態防禦：等待結束後再次確認 controller 仍是目前執行中的 polling，
        // 避免 destroy 已完成但 loop 仍進入下一輪重試
        if (!this.isPollingActive(appId, controller)) return;
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      }
    }
  }

  private isPollingActive(appId: string, controller: AbortController): boolean {
    return (
      !controller.signal.aborted &&
      this.pollingControllers.get(appId) === controller
    );
  }
}

export const telegramProvider = new TelegramProvider();
