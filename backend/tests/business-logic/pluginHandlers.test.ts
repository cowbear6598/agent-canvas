const {
  mockEmitToConnection,
  mockEmitToAll,
  mockEmitToCanvas,
  mockRefreshAllPlugins,
  mockInstallPlugin,
  mockRemovePlugin,
  mockUpdatePlugin,
  mockManagedPluginList,
  mockManagedPluginReorder,
  mockGetPodsByPluginIdGlobal,
} = vi.hoisted(() => ({
  mockEmitToConnection: vi.fn(),
  mockEmitToAll: vi.fn(),
  mockEmitToCanvas: vi.fn(),
  mockRefreshAllPlugins: vi.fn(),
  mockInstallPlugin: vi.fn(),
  mockRemovePlugin: vi.fn(),
  mockUpdatePlugin: vi.fn(),
  mockManagedPluginList: vi.fn(),
  mockManagedPluginReorder: vi.fn(),
  mockGetPodsByPluginIdGlobal: vi.fn(),
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
    emitToAll: mockEmitToAll,
    emitToCanvas: mockEmitToCanvas,
  },
}));

vi.mock("../../src/services/plugin/pluginInstallService.js", () => ({
  refreshAllPlugins: mockRefreshAllPlugins,
  installPlugin: mockInstallPlugin,
  removePlugin: mockRemovePlugin,
  updatePlugin: mockUpdatePlugin,
}));

vi.mock("../../src/services/plugin/managedPluginRegistry.js", () => ({
  managedPluginStore: {
    list: mockManagedPluginList,
    reorder: mockManagedPluginReorder,
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getPodsByPluginIdGlobal: mockGetPodsByPluginIdGlobal,
  },
}));

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  handlePluginList,
  handlePluginInstall,
  handlePluginDelete,
  handlePluginUpdate,
  handlePluginReorder,
} from "../../src/handlers/pluginHandlers.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";

const CONNECTION_ID = "conn-plugin-test";
const REQUEST_ID = "req-plugin-test";

const MOCK_PLUGIN_RECORD = {
  id: "owner/repo",
  source: { type: "github", ref: "owner/repo" },
  githubRepo: "owner/repo",
  displayName: "My Plugin",
  description: "A test plugin",
  installPath: "/plugins/owner/repo",
  sortIndex: 2,
  installedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockManagedPluginList.mockReturnValue([MOCK_PLUGIN_RECORD]);
  mockGetPodsByPluginIdGlobal.mockReturnValue([]);
});

describe("handlePluginList", () => {
  it("happy path：呼叫 refreshAllPlugins，回傳 PLUGIN_LIST_RESULT success=true", async () => {
    mockRefreshAllPlugins.mockResolvedValue({
      success: true,
      data: [MOCK_PLUGIN_RECORD],
    });

    await handlePluginList(
      CONNECTION_ID,
      { requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(mockRefreshAllPlugins).toHaveBeenCalledOnce();

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_LIST_RESULT);
    expect(payload.requestId).toBe(REQUEST_ID);
    expect(payload.success).toBe(true);
    expect(payload.plugins).toEqual([MOCK_PLUGIN_RECORD]);
  });
});

describe("handlePluginInstall", () => {
  it("happy path：呼叫 installPlugin，回傳 PLUGIN_INSTALLED success=true", async () => {
    mockInstallPlugin.mockResolvedValue({
      success: true,
      data: MOCK_PLUGIN_RECORD,
    });

    await handlePluginInstall(
      CONNECTION_ID,
      { requestId: REQUEST_ID, githubRepo: "owner/repo" },
      REQUEST_ID,
    );

    expect(mockInstallPlugin).toHaveBeenCalledOnce();
    expect(mockInstallPlugin).toHaveBeenCalledWith("owner/repo");

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, connEvent, connPayload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(connEvent).toBe(WebSocketResponseEvents.PLUGIN_INSTALLED);
    expect(connPayload.success).toBe(true);
    expect(connPayload.plugin).toEqual(MOCK_PLUGIN_RECORD);
    expect(connPayload.plugin.sortIndex).toBe(2);

    expect(mockEmitToAll).not.toHaveBeenCalled();
  });

  it("invalid repo：回傳 i18n 錯誤而非 raw INVALID_GITHUB_REPO_FORMAT", async () => {
    mockInstallPlugin.mockResolvedValue({
      success: false,
      error: "INVALID_GITHUB_REPO_FORMAT",
    });

    await handlePluginInstall(
      CONNECTION_ID,
      { requestId: REQUEST_ID, githubRepo: "ddd/ss/extra" },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_INSTALLED);
    expect(payload).toMatchObject({
      requestId: REQUEST_ID,
      success: false,
      code: "INVALID_GITHUB_REPO_FORMAT",
      error: {
        key: "errors.pluginInvalidGithubRepoFormat",
        params: { repo: "ddd/ss/extra" },
      },
    });
  });

  it("clone failed：回傳完整 i18n 安裝失敗說明", async () => {
    mockInstallPlugin.mockResolvedValue({
      success: false,
      error: "clone plugin ddd/ss",
    });

    await handlePluginInstall(
      CONNECTION_ID,
      { requestId: REQUEST_ID, githubRepo: "ddd/ss" },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_INSTALLED);
    expect(payload).toMatchObject({
      requestId: REQUEST_ID,
      success: false,
      code: "PLUGIN_INSTALL_FAILED",
      error: {
        key: "errors.pluginInstallFailed",
        params: { repo: "ddd/ss", reason: "clone plugin ddd/ss" },
      },
    });
  });
});

describe("handlePluginDelete", () => {
  it("happy path：呼叫 removePlugin，回傳 PLUGIN_DELETED success=true", async () => {
    mockRemovePlugin.mockResolvedValue({
      success: true,
      data: undefined,
    });
    mockGetPodsByPluginIdGlobal.mockReturnValue([
      {
        canvasId: "canvas-1",
        pod: {
          id: "pod-1",
          name: "Pod 1",
          x: 0,
          y: 0,
          rotation: 0,
          mcpServerNames: [],
          pluginIds: [],
          provider: "claude",
          providerConfig: null,
          repositoryId: null,
        },
      },
    ]);

    await handlePluginDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginId: "owner/repo" },
      REQUEST_ID,
    );

    expect(mockRemovePlugin).toHaveBeenCalledOnce();
    expect(mockRemovePlugin).toHaveBeenCalledWith("owner/repo");

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, connEvent, connPayload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(connEvent).toBe(WebSocketResponseEvents.PLUGIN_DELETED);
    expect(connPayload.success).toBe(true);
    expect(connPayload.pluginId).toBe("owner/repo");
    expect(connPayload.plugins).toEqual([MOCK_PLUGIN_RECORD]);

    expect(mockEmitToAll).not.toHaveBeenCalled();
    expect(mockEmitToCanvas).toHaveBeenCalledWith(
      "canvas-1",
      WebSocketResponseEvents.POD_PLUGINS_SET,
      expect.objectContaining({
        success: true,
        pod: expect.objectContaining({
          id: "pod-1",
          pluginIds: [],
        }),
      }),
    );
  });
});

describe("handlePluginUpdate", () => {
  it("happy path：呼叫 updatePlugin，回傳 PLUGIN_UPDATED success=true", async () => {
    mockUpdatePlugin.mockResolvedValue({
      success: true,
      data: MOCK_PLUGIN_RECORD,
    });

    await handlePluginUpdate(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginId: "owner/repo" },
      REQUEST_ID,
    );

    expect(mockUpdatePlugin).toHaveBeenCalledOnce();
    expect(mockUpdatePlugin).toHaveBeenCalledWith("owner/repo");

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, connEvent, connPayload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(connEvent).toBe(WebSocketResponseEvents.PLUGIN_UPDATED);
    expect(connPayload.success).toBe(true);
    expect(connPayload.plugin).toEqual(MOCK_PLUGIN_RECORD);
    expect(connPayload.plugin.sortIndex).toBe(2);

    expect(mockEmitToAll).not.toHaveBeenCalled();
  });

  it("update failed：回傳 i18n 錯誤而非 raw clone operation", async () => {
    mockUpdatePlugin.mockResolvedValue({
      success: false,
      error: "update clone plugin owner/repo",
    });

    await handlePluginUpdate(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginId: "owner/repo" },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_UPDATED);
    expect(payload).toMatchObject({
      requestId: REQUEST_ID,
      success: false,
      code: "PLUGIN_UPDATE_FAILED",
      error: {
        key: "errors.pluginUpdateFailed",
        params: {
          pluginId: "owner/repo",
          reason: "update clone plugin owner/repo",
        },
      },
    });
  });
});

describe("handlePluginReorder", () => {
  it("success：呼叫 managedPluginStore.reorder，回傳確認後 plugins 清單", async () => {
    mockManagedPluginReorder.mockReturnValue({
      success: true,
      data: [MOCK_PLUGIN_RECORD],
    });

    await handlePluginReorder(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginIds: ["owner/repo"] },
      REQUEST_ID,
    );

    expect(mockManagedPluginReorder).toHaveBeenCalledWith(["owner/repo"]);
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_REORDERED);
    expect(payload).toEqual({
      requestId: REQUEST_ID,
      success: true,
      plugins: [MOCK_PLUGIN_RECORD],
    });
    expect(mockEmitToAll).not.toHaveBeenCalled();
  });

  it("not found：PLUGIN_NOT_FOUND 應回 NOT_FOUND 合約", async () => {
    mockManagedPluginReorder.mockReturnValue({
      success: false,
      error: "PLUGIN_NOT_FOUND",
    });

    await handlePluginReorder(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginIds: ["missing-plugin"] },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_REORDERED);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.requestId).toBe(REQUEST_ID);
  });

  it("duplicate/invalid reorder：非 not found 錯誤應回 INVALID_PLUGIN_REORDER 合約", async () => {
    mockManagedPluginReorder.mockReturnValue({
      success: false,
      error: "PLUGIN_REORDER_DUPLICATE_IDS",
    });

    await handlePluginReorder(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginIds: ["owner/repo", "owner/repo"] },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [, event, payload] = mockEmitToConnection.mock.calls[0];
    expect(event).toBe(WebSocketResponseEvents.PLUGIN_REORDERED);
    expect(payload).toMatchObject({
      requestId: REQUEST_ID,
      success: false,
      error: "PLUGIN_REORDER_DUPLICATE_IDS",
      code: "INVALID_PLUGIN_REORDER",
    });
  });
});
