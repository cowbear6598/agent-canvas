import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import {
  listAliases,
  listOpencodeProviders as requestOpencodeProviders,
  refreshAliasPresets,
  reorderAliases,
} from "@/services/opencodeApi";

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
      "errors.opencodeAliasListMissingItems",
    );
  });

  it("reorder contract 破裂時回報明確錯誤，而不是吞掉排序結果", async () => {
    const requestPromise = reorderAliases(["alias-1"]);

    simulateEvent("opencode:aliases:reorder:result", {
      requestId: "req-opencode-aliases",
      success: true,
    });

    await expect(requestPromise).rejects.toThrow(
      "errors.opencodeAliasReorderMissingItems",
    );
  });

  it("provider list 會把 models record normalize 成 array", async () => {
    const requestPromise = requestOpencodeProviders();

    simulateEvent("opencode:provider:list:result", {
      requestId: "req-opencode-aliases",
      success: true,
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-3-5-sonnet": {
              id: "claude-3-5-sonnet",
              name: "Claude Sonnet",
            },
            "claude-3-5-haiku": {
              id: "claude-3-5-haiku",
              name: "Claude Haiku",
            },
          },
        },
      ],
      default: { anthropic: "claude-3-5-sonnet" },
      connected: ["anthropic"],
    });

    await expect(requestPromise).resolves.toEqual({
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: [
            { id: "claude-3-5-sonnet", name: "Claude Sonnet" },
            { id: "claude-3-5-haiku", name: "Claude Haiku" },
          ],
        },
      ],
      default: { anthropic: "claude-3-5-sonnet" },
      connected: ["anthropic"],
    });
  });

  it("refreshAliasPresets success 時回傳 item", async () => {
    const requestPromise = refreshAliasPresets("alias-1");

    simulateEvent("opencode:aliases:refresh-presets:result", {
      requestId: "req-opencode-aliases",
      success: true,
      item: {
        id: "alias-1",
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet",
        alias: "Sonnet",
        orderIdx: 0,
        thinkingLevels: ["balanced"],
        thinkingLevelLabels: { balanced: "Balanced" },
        defaultThinkingLevel: "balanced",
        thinkingMetadataFetchedAt: 1234567890,
      },
    });

    await expect(requestPromise).resolves.toMatchObject({
      id: "alias-1",
      thinkingLevels: ["balanced"],
      defaultThinkingLevel: "balanced",
    });
  });

  it("refreshAliasPresets contract 破裂時回報缺少 item", async () => {
    const requestPromise = refreshAliasPresets("alias-1");

    simulateEvent("opencode:aliases:refresh-presets:result", {
      requestId: "req-opencode-aliases",
      success: true,
    });

    await expect(requestPromise).rejects.toThrow(
      "errors.opencodeAliasRefreshPresetsMissingItem",
    );
  });
});
