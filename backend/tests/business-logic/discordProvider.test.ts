import type { Mock } from "vitest";

const createdClients: FakeDiscordClient[] = [];

vi.mock("../../src/services/integration/providers/discordClient.js", () => ({
  discordClientFactory: {
    create: vi.fn((botToken: string) => {
      const client = createFakeDiscordClient(botToken);
      createdClients.push(client);
      return client;
    }),
  },
}));

vi.mock("../../src/services/integration/integrationAppStore.js", () => ({
  integrationAppStore: {
    getByProviderAndConfigField: vi.fn(() => undefined),
    getById: vi.fn(() => undefined),
    updateExtraJson: vi.fn(),
    updateResources: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock("../../src/services/integration/integrationEventPipeline.js", () => ({
  integrationEventPipeline: {
    safeProcessEvent: vi.fn(),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToAll: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  sanitizeSensitiveInfo: vi.fn((value: string) => value),
}));

import { discordProvider } from "../../src/services/integration/providers/discordProvider.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import { integrationEventPipeline } from "../../src/services/integration/integrationEventPipeline.js";
import type {
  IntegrationApp,
  IntegrationResource,
} from "../../src/services/integration/types.js";
import type {
  DiscordClient,
  DiscordGuildTextChannel,
  DiscordMentionListener,
  DiscordMentionMessage,
} from "../../src/services/integration/providers/discordClient.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

type FakeDiscordClient = DiscordClient & {
  botToken: string;
  emitMention: (message: DiscordMentionMessage) => Promise<void>;
  listGuildTextChannelsMock: Mock<any>;
  sendMessageMock: Mock<any>;
  addReactionMock: Mock<any>;
};

function createFakeDiscordClient(botToken: string): FakeDiscordClient {
  let mentionListener: DiscordMentionListener | null = null;

  const client: FakeDiscordClient = {
    botToken,
    connect: vi.fn(async () => ({
      userId: "discord-bot-1",
      userName: "agent-canvas-bot",
    })),
    disconnect: vi.fn(async () => undefined),
    onMention: vi.fn((listener: DiscordMentionListener) => {
      mentionListener = listener;
      return () => {
        mentionListener = null;
      };
    }),
    listGuildTextChannels: vi.fn(async (): Promise<DiscordGuildTextChannel[]> => [
      {
        id: "channel-1",
        name: "deployments",
        guild: { id: "guild-1", name: "Release Guild" },
      },
      {
        id: "channel-2",
        name: "alerts",
        guild: { id: "guild-2", name: "Ops Guild" },
      },
    ]),
    addReaction: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    emitMention: async (message: DiscordMentionMessage) => {
      await mentionListener?.(message);
    },
    listGuildTextChannelsMock: vi.fn(),
    sendMessageMock: vi.fn(),
  };

  client.listGuildTextChannelsMock = client.listGuildTextChannels as Mock<any>;
  client.sendMessageMock = client.sendMessage as Mock<any>;
  client.addReactionMock = client.addReaction as Mock<any>;
  return client;
}

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
  return {
    id: "discord-app-1",
    name: "Discord Release Bot",
    provider: "discord",
    config: { botToken: "discord-token" },
    connectionStatus: "disconnected",
    resources: [],
    ...overrides,
  };
}

function makeMention(
  overrides: Partial<DiscordMentionMessage> = {},
): DiscordMentionMessage {
  return {
    id: "message-1",
    content: "<@123> deploy now",
    cleanContent: "deploy now",
    authorId: "user-1",
    authorName: "Cowbear",
    channel: {
      id: "channel-1",
      name: "deployments",
      guild: {
        id: "guild-1",
        name: "Release Guild",
      },
    },
    bindingChannelId: "channel-1",
    bindingChannelName: "deployments",
    ...overrides,
  };
}

describe("DiscordProvider", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createdClients.length = 0;
    asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(
      undefined,
    );
    asMock(integrationAppStore.getById).mockReturnValue(makeApp());
  });

  it("新的 botToken 應通過驗證，重複 token 應拒絕", () => {
    expect(
      discordProvider.validateCreate({ botToken: "discord-token" }).success,
    ).toBe(true);

    asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(
      makeApp(),
    );

    const duplicated = discordProvider.validateCreate({
      botToken: "discord-token",
    });
    expect(duplicated.success).toBe(false);
    expect((duplicated as { success: false; error: string }).error).toContain(
      "已存在使用相同 Bot Token 的 Discord App",
    );
  });

  it("initialize 後會同步 guild text channel 並註冊 mention 事件", async () => {
    const app = makeApp();

    await discordProvider.initialize(app);

    const client = createdClients[0];
    expect(client).toBeTruthy();
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.onMention).toHaveBeenCalledTimes(1);
    expect(integrationAppStore.updateExtraJson).toHaveBeenCalledWith(app.id, {
      botUserId: "discord-bot-1",
      botUserName: "agent-canvas-bot",
    });
    expect(integrationAppStore.updateResources).toHaveBeenCalledWith(app.id, [
      {
        id: "channel-1",
        name: "deployments",
        guildId: "guild-1",
        guildName: "Release Guild",
        channelName: "deployments",
      },
      {
        id: "channel-2",
        name: "alerts",
        guildId: "guild-2",
        guildName: "Ops Guild",
        channelName: "alerts",
      },
    ] satisfies IntegrationResource[]);

    await client.emitMention(makeMention());

    expect(integrationEventPipeline.safeProcessEvent).toHaveBeenCalledWith(
      "discord",
      app.id,
      expect.objectContaining({
        provider: "discord",
        appId: app.id,
        resourceId: "channel-1",
        senderId: "user-1",
        messageId: "message-1",
        replyChannelId: "channel-1",
      }),
    );
  });

  it("formatEventMessage 會把綁定 channel id 當成 resourceId，缺少必要欄位時忽略", () => {
    const app = makeApp();

    const event = discordProvider.formatEventMessage(makeMention(), app);
    expect(event).toMatchObject({
      resourceId: "channel-1",
      senderId: "user-1",
      messageId: "message-1",
      replyChannelId: "channel-1",
      text: expect.stringContaining("<channel>deployments</channel>"),
    });

    const invalid = discordProvider.formatEventMessage(
      { id: "broken-message" },
      app,
    );
    expect(invalid).toBeNull();
  });

  it("thread mention 應沿用 parent channel 當 resourceId，並保留 thread reply channel", () => {
    const app = makeApp();

    const event = discordProvider.formatEventMessage(
      makeMention({
        channel: {
          id: "thread-1",
          name: "hotfix-thread",
          guild: {
            id: "guild-1",
            name: "Release Guild",
          },
        },
        bindingChannelId: "channel-1",
        bindingChannelName: "deployments",
        threadName: "hotfix-thread",
      }),
      app,
    );

    expect(event).toMatchObject({
      resourceId: "channel-1",
      replyChannelId: "thread-1",
      text: expect.stringContaining("<thread>hotfix-thread</thread>"),
    });
  });

  it("sendMessage 會優先帶 replyToMessageId 回覆原始訊息", async () => {
    const app = makeApp();
    await discordProvider.initialize(app);

    const result = await discordProvider.sendMessage(
      app.id,
      "channel-1",
      "hello discord",
      { messageId: "message-99" },
    );

    expect(result.success).toBe(true);
    expect(createdClients[0]?.sendMessageMock).toHaveBeenCalledWith(
      "channel-1",
      "hello discord",
      { replyToMessageId: "message-99" },
    );
  });

  it("sendMessage 有 replyChannelId 時，應回覆到原始 thread channel", async () => {
    const app = makeApp();
    await discordProvider.initialize(app);

    const result = await discordProvider.sendMessage(
      app.id,
      "channel-1",
      "hello thread",
      {
        messageId: "message-101",
        replyChannelId: "thread-1",
      },
    );

    expect(result.success).toBe(true);
    expect(createdClients[0]?.sendMessageMock).toHaveBeenCalledWith(
      "thread-1",
      "hello thread",
      { replyToMessageId: "message-101" },
    );
  });

  it("acknowledgeEvent 應對原始訊息加入 :eyes: reaction", async () => {
    const app = makeApp();
    await discordProvider.initialize(app);

    const result = await discordProvider.acknowledgeEvent?.(app.id, {
      provider: "discord",
      appId: app.id,
      resourceId: "channel-1",
      userName: "Cowbear",
      text: "deploy now",
      rawEvent: {},
      messageId: "message-1",
      replyChannelId: "thread-1",
    });

    expect(result?.success).toBe(true);
    expect(createdClients[0]?.addReactionMock).toHaveBeenCalledWith(
      "thread-1",
      "message-1",
      "👀",
    );
  });
});
