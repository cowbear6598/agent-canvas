import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import {
  parseUpdateError,
  updatePodMcpServers,
} from "@/services/mcpApi";

const mockInvalidatePodMcpAvailabilityCache = vi.fn();

vi.mock("@/services/websocket/WebSocketClient", () => ({
  websocketClient: mockWebSocketClient,
}));

vi.mock("@/services/utils", () => ({
  generateRequestId: vi.fn(() => "req-mcp-update"),
}));

vi.mock("@/services/managedMcpApi", () => ({
  invalidatePodMcpAvailabilityCache: (...args: unknown[]) =>
    mockInvalidatePodMcpAvailabilityCache(...args),
}));

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
}));

describe("mcpApi", () => {
  beforeEach(() => {
    resetMockWebSocket();
    mockWebSocketClient.isConnected.value = true;
    mockInvalidatePodMcpAvailabilityCache.mockReset();
  });

  it("成功更新 pod mcp names 後會失效該 pod 的 availability cache", async () => {
    const requestPromise = updatePodMcpServers("canvas-1", "pod-1", [
      "context7",
    ]);

    expect(mockWebSocketClient.emit).toHaveBeenCalledWith(
      "pod:set-mcp-server-names",
      expect.objectContaining({
        canvasId: "canvas-1",
        podId: "pod-1",
        mcpServerNames: ["context7"],
        requestId: "req-mcp-update",
      }),
    );

    simulateEvent("pod:mcp-server-names:updated", {
      requestId: "req-mcp-update",
      success: true,
    });

    await expect(requestPromise).resolves.toBeUndefined();
    expect(mockInvalidatePodMcpAvailabilityCache).toHaveBeenCalledWith(
      undefined,
      "pod-1",
    );
  });

  it("後端回傳錯誤時應 reject 並回傳 sanitized message", async () => {
    const requestPromise = updatePodMcpServers("canvas-1", "pod-1", [
      "context7",
    ]);

    simulateEvent("pod:mcp-server-names:updated", {
      requestId: "req-mcp-update",
      success: false,
      error: "internal message should not leak",
    });

    await expect(requestPromise).rejects.toEqual({
      reason: "unknown",
      message: "common.error.unknown",
    });
  });

  it("可與使用者 MCP 分開更新內建 Agent Canvas MCP", async () => {
    const requestPromise = updatePodMcpServers(
      "canvas-1",
      "pod-1",
      ["context7"],
      true,
    );

    expect(mockWebSocketClient.emit).toHaveBeenCalledWith(
      "pod:set-mcp-server-names",
      expect.objectContaining({
        mcpServerNames: ["context7"],
        agentCanvasMcpEnabled: true,
      }),
    );
    simulateEvent("pod:mcp-server-names:updated", {
      requestId: "req-mcp-update",
      success: true,
      agentCanvasMcpEnabled: true,
    });

    await expect(requestPromise).resolves.toBeUndefined();
  });

  it("可用獨立 key 更新 Codex 原生 MCP，避免與 Canvas 名稱碰撞", async () => {
    const requestPromise = updatePodMcpServers(
      "canvas-1",
      "pod-1",
      ["docs"],
      undefined,
      ["plugin:openai%2Fdocs:docs", "user:docs"],
    );

    expect(mockWebSocketClient.emit).toHaveBeenCalledWith(
      "pod:set-mcp-server-names",
      expect.objectContaining({
        mcpServerNames: ["docs"],
        codexMcpServerKeys: ["plugin:openai%2Fdocs:docs", "user:docs"],
      }),
    );
    simulateEvent("pod:mcp-server-names:updated", {
      requestId: "req-mcp-update",
      success: true,
    });

    await expect(requestPromise).resolves.toBeUndefined();
  });

  it("parseUpdateError 遇到 i18nError payload 時應保留 reason key", () => {
    expect(
      parseUpdateError({
        key: "pod.error.busy",
        params: { podName: "Pod 1" },
      }),
    ).toEqual({
      reason: "pod.error.busy",
      message: "common.error.unknown",
    });
  });
});
