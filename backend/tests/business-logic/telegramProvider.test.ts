import type { Mock } from "vitest";

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
    processEvent: vi.fn(() => Promise.resolve()),
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
}));

import { telegramProvider } from "../../src/services/integration/providers/telegramProvider.js";
import { integrationAppStore } from "../../src/services/integration/integrationAppStore.js";
import type { IntegrationApp } from "../../src/services/integration/types.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
  return {
    id: "app-1",
    name: "Test Telegram Bot",
    provider: "telegram",
    config: { botToken: "123:ABCdef" },
    connectionStatus: "disconnected",
    resources: [],
    ...overrides,
  };
}

describe("TelegramProvider - validateCreate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(
      undefined,
    );
  });

  it("新的 botToken 應通過驗證", () => {
    const result = telegramProvider.validateCreate({ botToken: "123:ABCdef" });
    expect(result.success).toBe(true);
  });

  it("已存在相同 botToken 應回傳錯誤", () => {
    asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(
      makeApp(),
    );

    const result = telegramProvider.validateCreate({ botToken: "123:ABCdef" });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain(
      "已存在使用相同 Bot Token 的 Telegram Bot",
    );
  });

  it("缺少 botToken 應回傳錯誤", () => {
    const result = telegramProvider.validateCreate({});
    expect(result.success).toBe(false);
  });
});

describe("TelegramProvider - sanitizeConfig", () => {
  it("應回傳空物件（botToken 為敏感資訊）", () => {
    const result = telegramProvider.sanitizeConfig({ botToken: "123:ABCdef" });
    expect(result).toEqual({});
  });
});

describe("TelegramProvider - formatEventMessage", () => {
  const appId = "app-1";

  function makeMessageEvent(overrides: Record<string, unknown> = {}) {
    return {
      message_id: 1,
      from: { id: 111, is_bot: false, username: "sender", first_name: "Test" },
      chat: { id: 123456, type: "private" },
      text: "你好",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndConfigField).mockReturnValue(
      undefined,
    );
  });

  it("Bot 自己發送的訊息應回傳 null", () => {
    const app = makeApp({ id: appId });
    const message = makeMessageEvent({
      from: { id: 99, is_bot: true, first_name: "Bot" },
    });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result).toBeNull();
  });

  it("私聊模式應直接觸發並回傳 NormalizedEvent", () => {
    const app = makeApp({ id: appId });
    const message = makeMessageEvent({
      chat: { id: 111, type: "private" },
      text: "你好",
    });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("telegram");
    expect(result?.appId).toBe(appId);
    expect(result?.text).toContain("[Telegram: @sender]");
    expect(result?.text).toContain("<user_data>");
  });

  it("群組訊息應回傳 null", () => {
    const app = makeApp({ id: appId });
    const message = makeMessageEvent({
      chat: { id: -100123, type: "group" },
      text: "普通群組訊息",
    });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result).toBeNull();
  });

  it("supergroup 訊息應回傳 null", () => {
    const app = makeApp({ id: appId });
    const message = makeMessageEvent({
      chat: { id: -100123, type: "supergroup" },
      text: "普通訊息",
    });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result).toBeNull();
  });

  it("超過最大長度的訊息應被截斷", () => {
    const app = makeApp({ id: appId });
    const longText = "a".repeat(5000);
    const message = makeMessageEvent({ text: longText });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result).not.toBeNull();
    expect(result?.text).toContain("訊息過長，已截斷");
  });

  it("resourceId 應為 chatId 的字串形式", () => {
    const app = makeApp({ id: appId });
    const chatId = 987654;
    const message = makeMessageEvent({ chat: { id: chatId, type: "private" } });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result?.resourceId).toBe(String(chatId));
  });

  it("應將 message_id 填入 NormalizedEvent.messageId", () => {
    const app = makeApp({ id: appId });
    const message = makeMessageEvent({ message_id: 12345 });

    const result = telegramProvider.formatEventMessage(message, app);
    expect(result?.messageId).toBe(12345);
  });
});

describe("TelegramProvider - sendMessage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("找不到 App 時應回傳錯誤", async () => {
    asMock(integrationAppStore.getById).mockReturnValue(undefined);

    const result = await telegramProvider.sendMessage("app-1", "123", "你好");
    expect(result.success).toBe(false);
  });

  it("缺少 botToken 時應回傳錯誤", async () => {
    asMock(integrationAppStore.getById).mockReturnValue(
      makeApp({ config: {} }),
    );

    const result = await telegramProvider.sendMessage("app-1", "123", "你好");
    expect(result.success).toBe(false);
  });
});

describe("TelegramProvider - botToken 不洩漏到日誌", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initialize 失敗時日誌不應包含 botToken", async () => {
    const botToken = "123456:ABCdef-secrettoken";
    const app = makeApp({ config: { botToken } });

    asMock(global.fetch).mockRejectedValue(
      new Error(
        `Failed to fetch https://api.telegram.org/bot${botToken}/getMe`,
      ),
    );

    const { logger } = await import("../../src/utils/logger.js");

    await telegramProvider.initialize(app);

    const allCalls = [
      ...asMock(logger.error).mock.calls,
      ...asMock(logger.warn).mock.calls,
    ];

    for (const call of allCalls) {
      const message = call.join(" ");
      expect(message).not.toContain(botToken);
    }
  });
});

describe("TelegramProvider - 基本屬性", () => {
  it("name 應為 telegram", () => {
    expect(telegramProvider.name).toBe("telegram");
  });

  it("displayName 應為 Telegram", () => {
    expect(telegramProvider.displayName).toBe("Telegram");
  });

  it("webhookPath 應未定義（使用 polling 模式）", () => {
    expect(telegramProvider.webhookPath).toBeUndefined();
  });

  it("createAppSchema 應驗證正確格式的 botToken", () => {
    const validResult = telegramProvider.createAppSchema.safeParse({
      botToken: "123456:ABCdef-xyz",
    });
    expect(validResult.success).toBe(true);
  });

  it("createAppSchema 應拒絕格式不正確的 botToken", () => {
    const invalidResult = telegramProvider.createAppSchema.safeParse({
      botToken: "invalid-token",
    });
    expect(invalidResult.success).toBe(false);
  });
});
