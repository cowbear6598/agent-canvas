import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listPlugins,
  invalidatePluginListCache,
} from "@/services/pluginApi";
import { createWebSocketRequest } from "@/services/websocket/createWebSocketRequest";

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  createWebSocketRequest: vi.fn(),
}));

describe("pluginApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidatePluginListCache();
  });

  it("legacy gemini provider 不應送出 plugin 查詢", async () => {
    const result = await listPlugins("gemini");

    expect(result).toEqual([]);
    expect(createWebSocketRequest).not.toHaveBeenCalled();
  });

  it("支援的 provider 應送出 allowlist 內的 payload", async () => {
    vi.mocked(createWebSocketRequest).mockResolvedValue({
      plugins: [{ id: "plugin-1", name: "Plugin One" }],
    } as never);

    const result = await listPlugins("codex");

    expect(result).toEqual([{ id: "plugin-1", name: "Plugin One" }]);
    expect(createWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { provider: "codex" },
      }),
    );
  });
});
