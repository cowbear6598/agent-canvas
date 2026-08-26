const { mockImportBundleArchive, mockEmitToCanvas } = vi.hoisted(() => ({
  mockImportBundleArchive: vi.fn(),
  mockEmitToCanvas: vi.fn(),
}));

vi.mock("../../src/services/plugin/pluginInstallService.js", () => ({
  MAX_BUNDLE_ARCHIVE_BYTES: 10 * 1024 * 1024,
  formatBundleImportError: (error: string) => error,
  importBundleArchive: mockImportBundleArchive,
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: mockEmitToCanvas,
  },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleImportBundle } from "../../src/api/bundleImportApi.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";

function createUploadRequest(): Request {
  const formData = new FormData();
  formData.append(
    "bundle",
    new File(["zip"], "plan-bundle.zip", { type: "application/zip" }),
  );
  return new Request("http://localhost/api/bundles/import", {
    method: "POST",
    body: formData,
  });
}

describe("handleImportBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("匯入成功時回傳完整 plugin 清單並同步受影響 pod", async () => {
    const plugin = {
      id: "upload:new",
      source: { type: "upload" as const, ref: "new" },
      githubRepo: "new",
      displayName: "Plan Bundle",
      description: "新版",
      installPath: "/plugins/upload__new",
      sortIndex: 1,
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const pod = {
      id: "pod-1",
      name: "Pod 1",
      workspacePath: "/workspace",
      x: 0,
      y: 0,
      rotation: 0,
      sessionId: null,
      mcpServerNames: [],
      agentCanvasMcpEnabled: false,
      pluginIds: ["other-plugin"],
      codexSkillKeys: [],
      codexSkillsInitialized: true,
      provider: "claude" as const,
      providerConfig: null,
      repositoryId: null,
    };
    mockImportBundleArchive.mockResolvedValue({
      success: true,
      data: {
        plugin,
        plugins: [plugin],
        affectedPods: [{ canvasId: "canvas-1", pod }],
      },
    });

    const response = await handleImportBundle(createUploadRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      bundle: plugin,
      plugins: [plugin],
    });
    expect(mockEmitToCanvas).toHaveBeenCalledWith(
      "canvas-1",
      WebSocketResponseEvents.POD_PLUGINS_SET,
      expect.objectContaining({
        canvasId: "canvas-1",
        success: true,
        pod: expect.objectContaining({
          id: "pod-1",
          pluginIds: ["other-plugin"],
        }),
      }),
    );
  });
});
