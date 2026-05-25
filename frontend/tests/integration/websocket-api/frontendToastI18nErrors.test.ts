import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import {
  installPlugin,
  listPlugins,
  reorderPlugins,
  updatePlugin,
} from "@/services/pluginApi";
import { unlockCanvas, unlockWorkspace } from "@/services/securityApi";
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
  "websocket.reconnectGrantRedeemFailed",
  "security.transportWarning.blocked",
  "security.workspace.reconnectGrantMissing",
  "errors.auth.passwordEmpty",
  "errors.auth.passwordTooLong",
  "errors.auth.wrongCanvasPassword",
  "errors.auth.wrongWorkspacePassword",
  "errors.auth.workspacePasswordExists",
  "errors.auth.workspacePasswordNotSet",
  "errors.auth.canvasPasswordExists",
  "errors.auth.canvasPasswordNotSet",
  "errors.auth.workspaceLocked",
  "errors.auth.sessionMissing",
  "errors.auth.transportSecurityMissing",
  "errors.auth.rateLimited",
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
    i18n.global.locale.value = "zh-TW";
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

  it("plugin install/update/reorder success 缺少回傳資料時會回報 contract 錯誤", async () => {
    const installRequest = installPlugin("owner/repo");
    simulateEvent("plugin:installed", {
      requestId: "req-plugin-list",
      success: true,
    });
    await expect(installRequest).rejects.toThrow(
      "安裝 plugin 成功但後端未回傳 plugin 資料",
    );

    const updateRequest = updatePlugin("plugin-1");
    simulateEvent("plugin:updated", {
      requestId: "req-plugin-list",
      success: true,
    });
    await expect(updateRequest).rejects.toThrow(
      "更新 plugin 成功但後端未回傳 plugin 資料",
    );

    const reorderRequest = reorderPlugins(["plugin-1"]);
    simulateEvent("plugin:reordered", {
      requestId: "req-plugin-list",
      success: true,
    });
    await expect(reorderRequest).rejects.toThrow(
      "重排 plugin 成功但後端未回傳 plugin 清單",
    );
  });

  it("auth password 錯誤使用後端 i18nError key 顯示目前語系", async () => {
    const canvasUnlockRequest = unlockCanvas("canvas-1", "bad-password");
    simulateEvent("auth:unlock-canvas:result", {
      requestId: "req-plugin-list",
      success: false,
      error: { key: "errors.auth.wrongCanvasPassword" },
    });

    await expect(canvasUnlockRequest).rejects.toThrow("Canvas 密碼錯誤");

    i18n.global.locale.value = "en";
    const workspaceUnlockRequest = unlockWorkspace("bad-password");
    simulateEvent("auth:unlock-workspace:result", {
      requestId: "req-plugin-list",
      success: false,
      error: { key: "errors.auth.wrongWorkspacePassword" },
    });

    await expect(workspaceUnlockRequest).rejects.toThrow(
      "Wrong workspace password",
    );
  });

  it("auth rate limit 錯誤會套用 i18n 參數", async () => {
    const canvasUnlockRequest = unlockCanvas("canvas-1", "bad-password");
    simulateEvent("auth:unlock-canvas:result", {
      requestId: "req-plugin-list",
      success: false,
      error: {
        key: "errors.auth.rateLimited",
        params: { seconds: 30 },
      },
    });

    await expect(canvasUnlockRequest).rejects.toThrow(
      "嘗試次數過多，請稍後再試（剩餘 30 秒）",
    );
  });
});
