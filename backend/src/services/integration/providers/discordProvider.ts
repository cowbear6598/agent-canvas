import { z } from "zod";
import { err, ok } from "../../../types/index.js";
import type { Result } from "../../../types/index.js";
import { escapeUserInput } from "../../../utils/escapeInput.js";
import { logger, sanitizeSensitiveInfo } from "../../../utils/logger.js";
import { integrationAppStore } from "../integrationAppStore.js";
import { integrationEventPipeline } from "../integrationEventPipeline.js";
import {
  destroyProvider,
  initializeProvider,
} from "../integrationHelpers.js";
import type {
  IntegrationApp,
  IntegrationAppConfig,
  IntegrationProvider,
  IntegrationResource,
  NormalizedEvent,
} from "../types.js";
import {
  discordClientFactory,
  type DiscordClient,
  type DiscordGuildTextChannel,
  type DiscordMentionMessage,
} from "./discordClient.js";

const createAppSchema = z.object({
  botToken: z.string().min(1, "botToken 為必填"),
});
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

function formatDiscordEventMessage(message: DiscordMentionMessage): string {
  const escapedAuthorName = escapeUserInput(message.authorName);
  const escapedGuildName = escapeUserInput(message.channel.guild.name);
  const escapedChannelName = escapeUserInput(message.bindingChannelName);
  const escapedContent = escapeUserInput(message.cleanContent);
  const escapedThreadName =
    typeof message.threadName === "string"
      ? escapeUserInput(message.threadName)
      : null;

  const lines = [
    `<guild>${escapedGuildName}</guild>`,
    `<channel>${escapedChannelName}</channel>`,
  ];

  if (escapedThreadName) {
    lines.push(`<thread>${escapedThreadName}</thread>`);
  }

  lines.push(
    `<username>${escapedAuthorName}</username>`,
    `<message>${escapedContent}</message>`,
  );

  return lines.join("\n");
}

function mapChannelToResource(
  channel: DiscordGuildTextChannel,
): IntegrationResource {
  return {
    id: channel.id,
    name: channel.name,
    guildId: channel.guild.id,
    guildName: channel.guild.name,
    channelName: channel.name,
  };
}

class DiscordProvider implements IntegrationProvider {
  readonly name = "discord";
  readonly displayName = "Discord";
  readonly strictResourceValidation = true;
  readonly createAppSchema = createAppSchema;

  private readonly clients = new Map<string, DiscordClient>();
  private readonly mentionUnsubscribers = new Map<string, () => void>();

  validateCreate(config: IntegrationAppConfig): Result<void> {
    const botToken = config["botToken"];
    if (typeof botToken !== "string" || botToken.trim().length === 0) {
      return err("botToken 格式不正確");
    }

    const existing = integrationAppStore.getByProviderAndConfigField(
      "discord",
      "$.botToken",
      botToken,
    );
    if (existing) {
      return err("已存在使用相同 Bot Token 的 Discord App");
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
        if (typeof botToken !== "string" || botToken.trim().length === 0) {
          return false;
        }

        const client = discordClientFactory.create(botToken);

        try {
          const identity = await client.connect();
          this.clients.set(app.id, client);
          this.attachMentionHandler(app.id, client);
          integrationAppStore.updateExtraJson(app.id, {
            botUserId: identity.userId,
            botUserName: identity.userName,
          });
          return true;
        } catch (error) {
          logger.warn(
            "Integration",
            "Warn",
            `[DiscordProvider] 連線失敗（appId=${app.id}）: ${sanitizeSensitiveInfo(
              error instanceof Error ? error.message : String(error),
            )}`,
          );
          await client.disconnect();
          return false;
        }
      },
      async () => {
        const client = this.clients.get(app.id);
        if (!client) {
          return;
        }

        try {
          await this.fetchAndUpdateResources(app.id, client);
        } catch (error) {
          logger.warn(
            "Integration",
            "Warn",
            `[DiscordProvider] 同步頻道失敗（appId=${app.id}）: ${sanitizeSensitiveInfo(
              error instanceof Error ? error.message : String(error),
            )}`,
          );
        }
      },
      "Integration",
    );
  }

  destroy(appId: string): void {
    const client = this.clients.get(appId);
    this.mentionUnsubscribers.get(appId)?.();
    this.mentionUnsubscribers.delete(appId);
    void client?.disconnect();

    destroyProvider(
      this.clients as Map<string, unknown>,
      appId,
      "discord",
      "Integration",
    );
  }

  destroyAll(): void {
    for (const unsubscribe of this.mentionUnsubscribers.values()) {
      unsubscribe();
    }
    this.mentionUnsubscribers.clear();

    for (const client of this.clients.values()) {
      void client.disconnect();
    }

    this.clients.clear();
  }

  async refreshResources(appId: string): Promise<IntegrationResource[]> {
    const client = await this.getOrCreateClient(appId);
    if (!client) {
      return [];
    }

    return this.fetchAndUpdateResources(appId, client);
  }

  formatEventMessage(
    event: unknown,
    app: IntegrationApp,
  ): NormalizedEvent | null {
    const message = event as Partial<DiscordMentionMessage> | null;
    if (
      !message ||
      typeof message.id !== "string" ||
      typeof message.cleanContent !== "string" ||
      typeof message.authorName !== "string" ||
      typeof message.channel?.id !== "string" ||
      typeof message.bindingChannelId !== "string"
    ) {
      return null;
    }

    return {
      provider: this.name,
      appId: app.id,
      resourceId: message.bindingChannelId,
      userName: message.authorName,
      text: formatDiscordEventMessage(message as DiscordMentionMessage),
      rawEvent: event,
      senderId:
        typeof message.authorId === "string" ? message.authorId : undefined,
      messageId: message.id,
      replyChannelId: message.channel.id,
    };
  }

  async sendMessage(
    appId: string,
    resourceId: string,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<Result<void>> {
    const client = await this.getOrCreateClient(appId);
    if (!client) {
      return err(`找不到 Discord App ${appId}`);
    }

    const content =
      text.length > MAX_DISCORD_MESSAGE_LENGTH
        ? `${text.slice(0, MAX_DISCORD_MESSAGE_LENGTH - 14)}\n...(訊息已截斷)`
        : text;

    try {
      await client.sendMessage(this.getReplyChannelId(resourceId, extra), content, {
        replyToMessageId: this.getReplyToMessageId(extra),
      });
      return ok(undefined);
    } catch (error) {
      logger.warn(
        "Integration",
        "Warn",
        `[DiscordProvider] 發送訊息失敗（appId=${appId}, resourceId=${resourceId}）: ${sanitizeSensitiveInfo(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      return err("發送 Discord 訊息失敗");
    }
  }

  buildAckExtra(event: NormalizedEvent): Record<string, unknown> {
    return {
      senderId: event.senderId,
      messageId: event.messageId,
      replyChannelId: event.replyChannelId,
    };
  }

  async acknowledgeEvent(
    appId: string,
    event: NormalizedEvent,
  ): Promise<Result<void>> {
    const client = await this.getOrCreateClient(appId);
    if (!client) {
      return err(`找不到 Discord App ${appId}`);
    }

    if (
      typeof event.replyChannelId !== "string" ||
      event.replyChannelId === "" ||
      (typeof event.messageId !== "string" && typeof event.messageId !== "number")
    ) {
      return ok(undefined);
    }

    try {
      await client.addReaction(event.replyChannelId, String(event.messageId), "👀");
      return ok(undefined);
    } catch (error) {
      logger.warn(
        "Integration",
        "Warn",
        `[DiscordProvider] 加入 reaction 失敗（appId=${appId}, channelId=${event.replyChannelId}）: ${sanitizeSensitiveInfo(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
      return err("加入 Discord reaction 失敗");
    }
  }

  private async getOrCreateClient(appId: string): Promise<DiscordClient | null> {
    const existing = this.clients.get(appId);
    if (existing) {
      return existing;
    }

    const app = integrationAppStore.getById(appId);
    const botToken = app?.config["botToken"];
    if (typeof botToken !== "string" || botToken.trim().length === 0) {
      return null;
    }

    const client = discordClientFactory.create(botToken);
    await client.connect();
    this.clients.set(appId, client);
    this.attachMentionHandler(appId, client);
    return client;
  }

  private async fetchAndUpdateResources(
    appId: string,
    client: DiscordClient,
  ): Promise<IntegrationResource[]> {
    const channels = await client.listGuildTextChannels();
    const resources = channels.map(mapChannelToResource);
    integrationAppStore.updateResources(appId, resources);
    return resources;
  }

  private attachMentionHandler(appId: string, client: DiscordClient): void {
    this.mentionUnsubscribers.get(appId)?.();
    const unsubscribe = client.onMention((message) => {
      const app = integrationAppStore.getById(appId);
      if (!app) {
        return;
      }

      const normalizedEvent = this.formatEventMessage(message, app);
      if (!normalizedEvent) {
        return;
      }

      integrationEventPipeline.safeProcessEvent(this.name, app.id, normalizedEvent);
    });
    this.mentionUnsubscribers.set(appId, unsubscribe);
  }

  private getReplyToMessageId(
    extra?: Record<string, unknown>,
  ): string | undefined {
    const messageId = extra?.["messageId"];
    if (typeof messageId === "string" && messageId !== "") {
      return messageId;
    }
    if (typeof messageId === "number" && Number.isFinite(messageId)) {
      return String(messageId);
    }
    return undefined;
  }

  private getReplyChannelId(
    resourceId: string,
    extra?: Record<string, unknown>,
  ): string {
    const replyChannelId = extra?.["replyChannelId"];
    if (typeof replyChannelId === "string" && replyChannelId !== "") {
      return replyChannelId;
    }
    return resourceId;
  }
}

export const discordProvider = new DiscordProvider();
