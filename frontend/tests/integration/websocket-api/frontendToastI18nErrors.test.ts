import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import { listPlugins } from "@/services/pluginApi";
import { i18n } from "@/i18n";
import zhTW from "@/locales/zh-TW.json";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";

vi.mock("@/services/websocket/WebSocketClient", () => ({
  websocketClient: mockWebSocketClient,
}));

vi.mock("@/services/utils", () => ({
  generateRequestId: vi.fn(() => "req-plugin-list"),
}));

const addedErrorKeys = [
  "errors.opencodeAliasListMissingItems",
  "errors.opencodeAliasCreateMissingItem",
  "errors.opencodeAliasUpdateMissingItem",
  "errors.opencodeAliasReorderMissingItems",
  "errors.opencodeAliasRefreshPresetsMissingItem",
  "errors.pluginListMissingPlugins",
  "errors.pluginInstallMissingPlugin",
  "errors.pluginUpdateMissingPlugin",
  "errors.pluginReorderMissingPlugins",
  "websocket.sendFailed",
  "security.workspace.reconnectGrantMissing",
  "managedMcp.surfaceTargetsIgnoredTitle",
] as const;

function readLocaleKey(
  messages: Record<string, unknown>,
  key: string,
): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
}

describe("frontend toast i18n errors", () => {
  beforeEach(() => {
    resetMockWebSocket();
    mockWebSocketClient.isConnected.value = true;
  });

  it("新增錯誤顯示 key 在 zh-TW / en / ja 都存在", () => {
    for (const key of addedErrorKeys) {
      expect(readLocaleKey(zhTW, key), `zh-TW missing ${key}`).toEqual(
        expect.any(String),
      );
      expect(readLocaleKey(en, key), `en missing ${key}`).toEqual(
        expect.any(String),
      );
      expect(readLocaleKey(ja, key), `ja missing ${key}`).toEqual(
        expect.any(String),
      );
    }
  });

  it("切換 locale 後 plugin API contract 錯誤會使用目前語系", async () => {
    i18n.global.locale.value = "en";
    const enRequest = listPlugins();
    simulateEvent("plugin:list:result", {
      requestId: "req-plugin-list",
      success: true,
    });

    await expect(enRequest).rejects.toThrow(
      "Plugin list succeeded but backend did not return plugins",
    );

    i18n.global.locale.value = "ja";
    const jaRequest = listPlugins();
    simulateEvent("plugin:list:result", {
      requestId: "req-plugin-list",
      success: true,
    });

    await expect(jaRequest).rejects.toThrow(
      "plugin 一覧の取得は成功しましたが backend が plugin 一覧を返しませんでした",
    );
  });
});
