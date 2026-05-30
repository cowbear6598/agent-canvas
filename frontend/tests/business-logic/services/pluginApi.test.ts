import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPluginBundle } from "@/services/pluginApi";
import type { InstalledPlugin } from "@/types/plugin";

vi.mock("@/services/utils", () => ({
  getApiBaseUrl: vi.fn(() => "http://localhost:3001"),
}));

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  createWebSocketRequest: vi.fn(),
}));

function createPlugin(overrides?: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    id: "upload:abc123",
    source: { type: "upload", ref: "abc123" },
    displayName: "Bundle A",
    installPath: "/plugins/upload__abc123",
    sortIndex: 0,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("pluginApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploadPluginBundle 會帶上 credentials include", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ bundle: createPlugin() }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await uploadPluginBundle(
      new File(["zip"], "bundle.zip", { type: "application/zip" }),
    );

    expect(result).toEqual(createPlugin());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/bundles/import",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.any(FormData),
      }),
    );
  });

  it("uploadPluginBundle 失敗時會把錯誤碼轉成 i18n 訊息", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "PLUGIN_ALREADY_INSTALLED",
          error: "PLUGIN_ALREADY_INSTALLED",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      uploadPluginBundle(
        new File(["zip"], "bundle.zip", { type: "application/zip" }),
      ),
    ).rejects.toThrow("這個本地 skill 已經新增過了。");
  });
});
