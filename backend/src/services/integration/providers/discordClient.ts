import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
} from "discord.js";
import { logger, sanitizeSensitiveInfo } from "../../../utils/logger.js";

export interface DiscordGuild {
  id: string;
  name: string;
}

export interface DiscordGuildTextChannel {
  id: string;
  name: string;
  guild: DiscordGuild;
}

export interface DiscordGuildMessageChannel {
  id: string;
  name: string;
  guild: DiscordGuild;
}

export interface DiscordMentionMessage {
  id: string;
  content: string;
  cleanContent: string;
  authorId: string;
  authorName: string;
  channel: DiscordGuildMessageChannel;
  bindingChannelId: string;
  bindingChannelName: string;
  threadName?: string;
}

export interface DiscordBotIdentity {
  userId: string;
  userName: string;
}

export type DiscordMentionListener = (
  message: DiscordMentionMessage,
) => void | Promise<void>;

export interface DiscordSendMessageOptions {
  replyToMessageId?: string;
}

export interface DiscordClient {
  connect(): Promise<DiscordBotIdentity>;
  disconnect(): Promise<void>;
  onMention(listener: DiscordMentionListener): () => void;
  listGuildTextChannels(): Promise<DiscordGuildTextChannel[]>;
  addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
  sendMessage(
    channelId: string,
    text: string,
    options?: DiscordSendMessageOptions,
  ): Promise<void>;
}

export interface DiscordClientFactory {
  create(botToken: string): DiscordClient;
}

class DiscordJsClient implements DiscordClient {
  private readonly client: Client;
  private readonly mentionListeners = new Set<DiscordMentionListener>();
  private connectPromise: Promise<DiscordBotIdentity> | null = null;

  constructor(private readonly botToken: string) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessageCreate(message);
    });
  }

  async connect(): Promise<DiscordBotIdentity> {
    const currentUser = this.client.user;
    if (currentUser) {
      return {
        userId: currentUser.id,
        userName: currentUser.username,
      };
    }

    if (!this.connectPromise) {
      this.connectPromise = this.loginAndWaitReady();
    }

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.mentionListeners.clear();
    this.connectPromise = null;
    this.client.destroy();
  }

  onMention(listener: DiscordMentionListener): () => void {
    this.mentionListeners.add(listener);
    return () => {
      this.mentionListeners.delete(listener);
    };
  }

  async listGuildTextChannels(): Promise<DiscordGuildTextChannel[]> {
    await this.connect();

    const guildRefs = await this.client.guilds.fetch();
    const channels: DiscordGuildTextChannel[] = [];

    for (const guildRef of guildRefs.values()) {
      const guild = await guildRef.fetch();
      const fetchedChannels = await guild.channels.fetch();

      for (const channel of fetchedChannels.values()) {
        if (!channel || channel.type !== ChannelType.GuildText) {
          continue;
        }

        channels.push({
          id: channel.id,
          name: channel.name,
          guild: {
            id: guild.id,
            name: guild.name,
          },
        });
      }
    }

    return channels.sort((left, right) => {
      const guildComparison = left.guild.name.localeCompare(right.guild.name);
      if (guildComparison !== 0) {
        return guildComparison;
      }
      return left.name.localeCompare(right.name);
    });
  }

  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    await this.connect();

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !isSupportedMessageChannel(channel.type)) {
      throw new Error(`找不到可加入 reaction 的 Discord 頻道：${channelId}`);
    }

    const reactionChannel = channel as unknown as {
      messages: {
        fetch(id: string): Promise<{ react(emojiText: string): Promise<void> }>;
      };
    };
    const message = await reactionChannel.messages.fetch(messageId);
    await message.react(emoji);
  }

  async sendMessage(
    channelId: string,
    text: string,
    options?: DiscordSendMessageOptions,
  ): Promise<void> {
    await this.connect();

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !isSupportedMessageChannel(channel.type)) {
      throw new Error(`找不到可發送訊息的 Discord 頻道：${channelId}`);
    }

    const sendChannel = channel as unknown as {
      send(payload: {
        content: string;
        reply?:
          | {
              messageReference: string;
              failIfNotExists: boolean;
            }
          | undefined;
      }): Promise<unknown>;
    };

    await sendChannel.send({
      content: text,
      reply: options?.replyToMessageId
        ? {
            messageReference: options.replyToMessageId,
            failIfNotExists: false,
          }
        : undefined,
    });
  }

  private async loginAndWaitReady(): Promise<DiscordBotIdentity> {
    try {
      const readyPromise = new Promise<DiscordBotIdentity>((resolve, reject) => {
        const cleanup = (): void => {
          this.client.off(Events.ClientReady, handleReady);
          this.client.off(Events.Error, handleError);
        };

        const handleReady = (): void => {
          cleanup();
          const currentUser = this.client.user;
          if (!currentUser) {
            reject(new Error("Discord Bot 尚未取得登入後的使用者資訊"));
            return;
          }

          resolve({
            userId: currentUser.id,
            userName: currentUser.username,
          });
        };

        const handleError = (error: Error): void => {
          cleanup();
          reject(error);
        };

        this.client.once(Events.ClientReady, handleReady);
        this.client.once(Events.Error, handleError);
      });

      await this.client.login(this.botToken);
      return await readyPromise;
    } catch (error) {
      this.connectPromise = null;
      this.client.destroy();
      throw error;
    }
  }

  private async handleMessageCreate(message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild()) {
      return;
    }

    const guild = message.guild;
    if (!guild) {
      return;
    }

    const botUserId = this.client.user?.id;
    if (!botUserId || !message.mentions.users.has(botUserId)) {
      return;
    }

    const bindingChannel = resolveBindingChannel(message, guild);
    if (!bindingChannel) {
      return;
    }

    const mentionMessage: DiscordMentionMessage = {
      id: message.id,
      content: message.content,
      cleanContent: stripBotMention(message.content, botUserId),
      authorId: message.author.id,
      authorName: message.author.username,
      channel: {
        id: message.channel.id,
        name: message.channel.name,
        guild: {
          id: guild.id,
          name: guild.name,
        },
      },
      bindingChannelId: bindingChannel.id,
      bindingChannelName: bindingChannel.name,
      threadName:
        message.channel.id !== bindingChannel.id ? message.channel.name : undefined,
    };

    for (const listener of this.mentionListeners) {
      try {
        await listener(mentionMessage);
      } catch (error) {
        logger.error(
          "Integration",
          "Error",
          `[DiscordClient] mention listener 執行失敗：${sanitizeSensitiveInfo(
            error instanceof Error ? error.message : String(error),
          )}`,
          error,
        );
      }
    }
  }
}

function resolveBindingChannel(
  message: Message,
  guild: DiscordGuild,
): DiscordGuildTextChannel | null {
  if (message.channel.type === ChannelType.GuildText) {
    return {
      id: message.channel.id,
      name: message.channel.name,
      guild: {
        id: guild.id,
        name: guild.name,
      },
    };
  }

  if (
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread ||
    message.channel.type === ChannelType.AnnouncementThread
  ) {
    const parent = message.channel.parent;
    if (!parent || parent.type !== ChannelType.GuildText) {
      return null;
    }

    return {
      id: parent.id,
      name: parent.name,
      guild: {
        id: guild.id,
        name: guild.name,
      },
    };
  }

  return null;
}

function isSupportedMessageChannel(channelType: ChannelType): boolean {
  return (
    channelType === ChannelType.GuildText ||
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread
  );
}

function stripBotMention(content: string, botUserId: string): string {
  return content
    .replace(new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g"), "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const discordClientFactory: DiscordClientFactory = {
  create(botToken: string): DiscordClient {
    return new DiscordJsClient(botToken);
  },
};
