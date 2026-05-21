/**
 * pluginHandlers wire-up smoke tests
 *
 * 涵蓋範圍：
 *   handlePluginList      - F1 happy path（呼叫 refreshAllPlugins + emit PLUGIN_LIST_RESULT）
 *   handlePluginInstall   - F2 happy path（呼叫 installPlugin + emit PLUGIN_INSTALLED to connection + all）
 *   handlePluginDelete    - F5 happy path（呼叫 removePlugin + emit PLUGIN_DELETED to connection + all）
 *   handlePluginUpdate    - F6 happy path（呼叫 updatePlugin + emit PLUGIN_UPDATED to connection + all）
 *
 * Mock 邊界：
 *   必須 mock：socketService（WebSocket boundary）、pluginInstallService（避免真實 git 操作）
 *   不可 mock：handler 本身的邏輯、事件常數
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

const {
  mockEmitToConnection,
  mockEmitToAll,
  mockRefreshAllPlugins,
  mockInstallPlugin,
  mockRemovePlugin,
  mockUpdatePlugin,
  mockManagedPluginList,
  mockManagedPluginReorder,
} = vi.hoisted(() => ({
  mockEmitToConnection: vi.fn(),
  mockEmitToAll: vi.fn(),
  mockRefreshAllPlugins: vi.fn(),
  mockInstallPlugin: vi.fn(),
  mockRemovePlugin: vi.fn(),
  mockUpdatePlugin: vi.fn(),
  mockManagedPluginList: vi.fn(),
  mockManagedPluginReorder: vi.fn(),
}));

// socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
    emitToAll: mockEmitToAll,
    emitToCanvas: vi.fn(),
  },
}));

// pluginInstallService：避免真實 git / fs 操作
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

// ─── imports ──────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  handlePluginList,
  handlePluginInstall,
  handlePluginDelete,
  handlePluginUpdate,
} from "../../src/handlers/pluginHandlers.js";
import { WebSocketResponseEvents } from "../../src/schemas/index.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CONNECTION_ID = "conn-plugin-test";
const REQUEST_ID = "req-plugin-test";

const MOCK_PLUGIN_RECORD = {
  id: "owner/repo",
  githubRepo: "owner/repo",
  displayName: "My Plugin",
  description: "A test plugin",
  installPath: "/plugins/owner/repo",
  sortIndex: 2,
  installedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockManagedPluginList.mockReturnValue([MOCK_PLUGIN_RECORD]);
});

// ─── PLUGIN_LIST handler ──────────────────────────────────────────────────────

describe("handlePluginList", () => {
  it("F1 happy path：呼叫 refreshAllPlugins，emitToConnection 回傳 PLUGIN_LIST_RESULT success=true", async () => {
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

// ─── PLUGIN_INSTALL handler ───────────────────────────────────────────────────

describe("handlePluginInstall", () => {
  it("F2 happy path：呼叫 installPlugin，emitToConnection 與 emitToAll 各傳一次 PLUGIN_INSTALLED success=true", async () => {
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

    // emitToConnection
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, connEvent, connPayload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(connEvent).toBe(WebSocketResponseEvents.PLUGIN_INSTALLED);
    expect(connPayload.success).toBe(true);
    expect(connPayload.plugin).toEqual(MOCK_PLUGIN_RECORD);
    expect(connPayload.plugin.sortIndex).toBe(2);

    // emitToAll
    expect(mockEmitToAll).toHaveBeenCalledOnce();
    const [allEvent, allPayload] = mockEmitToAll.mock.calls[0];
    expect(allEvent).toBe(WebSocketResponseEvents.PLUGIN_INSTALLED);
    expect(allPayload.success).toBe(true);
    expect(allPayload.plugin).toEqual(MOCK_PLUGIN_RECORD);
    expect(allPayload.plugin.sortIndex).toBe(2);
  });
});

// ─── PLUGIN_DELETE handler ────────────────────────────────────────────────────

describe("handlePluginDelete", () => {
  it("F5 happy path：呼叫 removePlugin，emitToConnection 與 emitToAll 各傳一次 PLUGIN_DELETED success=true", async () => {
    mockRemovePlugin.mockResolvedValue({
      success: true,
      data: undefined,
    });

    await handlePluginDelete(
      CONNECTION_ID,
      { requestId: REQUEST_ID, pluginId: "owner/repo" },
      REQUEST_ID,
    );

    expect(mockRemovePlugin).toHaveBeenCalledOnce();
    expect(mockRemovePlugin).toHaveBeenCalledWith("owner/repo");

    // emitToConnection
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, connEvent, connPayload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(connEvent).toBe(WebSocketResponseEvents.PLUGIN_DELETED);
    expect(connPayload.success).toBe(true);
    expect(connPayload.pluginId).toBe("owner/repo");
    expect(connPayload.plugins).toEqual([MOCK_PLUGIN_RECORD]);

    // emitToAll
    expect(mockEmitToAll).toHaveBeenCalledOnce();
    const [allEvent, allPayload] = mockEmitToAll.mock.calls[0];
    expect(allEvent).toBe(WebSocketResponseEvents.PLUGIN_DELETED);
    expect(allPayload.success).toBe(true);
    expect(allPayload.pluginId).toBe("owner/repo");
    expect(allPayload.plugins).toEqual([MOCK_PLUGIN_RECORD]);
  });
});

// ─── PLUGIN_UPDATE handler ────────────────────────────────────────────────────

describe("handlePluginUpdate", () => {
  it("F6 happy path：呼叫 updatePlugin，emitToConnection 與 emitToAll 各傳一次 PLUGIN_UPDATED success=true", async () => {
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

    // emitToConnection
    expect(mockEmitToConnection).toHaveBeenCalledOnce();
    const [connId, connEvent, connPayload] = mockEmitToConnection.mock.calls[0];
    expect(connId).toBe(CONNECTION_ID);
    expect(connEvent).toBe(WebSocketResponseEvents.PLUGIN_UPDATED);
    expect(connPayload.success).toBe(true);
    expect(connPayload.plugin).toEqual(MOCK_PLUGIN_RECORD);
    expect(connPayload.plugin.sortIndex).toBe(2);

    // emitToAll
    expect(mockEmitToAll).toHaveBeenCalledOnce();
    const [allEvent, allPayload] = mockEmitToAll.mock.calls[0];
    expect(allEvent).toBe(WebSocketResponseEvents.PLUGIN_UPDATED);
    expect(allPayload.success).toBe(true);
    expect(allPayload.plugin).toEqual(MOCK_PLUGIN_RECORD);
    expect(allPayload.plugin.sortIndex).toBe(2);
  });
});
