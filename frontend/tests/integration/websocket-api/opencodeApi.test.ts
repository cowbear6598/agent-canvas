import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import { listAliases, reorderAliases } from "@/services/opencodeApi";

vi.mock("@/services/websocket/WebSocketClient", () => ({
  websocketClient: mockWebSocketClient,
}));

vi.mock("@/services/utils", () => ({
  generateRequestId: vi.fn(() => "req-opencode-aliases"),
}));

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

describe("opencodeApi", () => {
  beforeEach(() => {
    resetMockWebSocket();
    mockWebSocketClient.isConnected.value = true;
  });

  it("alias list contract 破裂時回報明確錯誤，而不是顯示空清單", async () => {
    const requestPromise = listAliases();

    simulateEvent("opencode:aliases:list:result", {
      requestId: "req-opencode-aliases",
      success: true,
    });

    await expect(requestPromise).rejects.toThrow(
      "載入 opencode model 別稱失敗：後端未回傳 items",
    );
  });

  it("reorder contract 破裂時回報明確錯誤，而不是吞掉排序結果", async () => {
    const requestPromise = reorderAliases(["alias-1"]);

    simulateEvent("opencode:aliases:reorder:result", {
      requestId: "req-opencode-aliases",
      success: true,
    });

    await expect(requestPromise).rejects.toThrow(
      "重排 opencode model 別稱失敗：後端未回傳 items",
    );
  });
});
