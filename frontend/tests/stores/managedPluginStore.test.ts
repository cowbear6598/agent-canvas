import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "../helpers/testSetup";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import type { InstalledPlugin } from "@/types/plugin";

const {
  mockListPlugins,
  mockInstallPlugin,
  mockDeletePlugin,
  mockUpdatePlugin,
} = vi.hoisted(() => ({
  mockListPlugins: vi.fn(),
  mockInstallPlugin: vi.fn(),
  mockDeletePlugin: vi.fn(),
  mockUpdatePlugin: vi.fn(),
}));

vi.mock("@/services/pluginApi", () => ({
  listPlugins: mockListPlugins,
  installPlugin: mockInstallPlugin,
  deletePlugin: mockDeletePlugin,
  updatePlugin: mockUpdatePlugin,
}));

function createMockPlugin(
  overrides?: Partial<InstalledPlugin>,
): InstalledPlugin {
  return {
    id: "plugin-1",
    githubRepo: "owner/repo",
    displayName: "Test Plugin",
    installPath: "/path/to/plugin",
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("managedPluginStore", () => {
  setupStoreTest();

  describe("install", () => {
    it("重複安裝相同 githubRepo 時應拋出「該 plugin 已安裝」錯誤且不呼叫 API", async () => {
      const store = useManagedPluginStore();
      store.plugins = [
        createMockPlugin({ id: "plugin-1", githubRepo: "owner/repo" }),
      ];

      await expect(store.install("owner/repo")).rejects.toThrow(
        "該 plugin 已安裝",
      );

      expect(mockInstallPlugin).not.toHaveBeenCalled();
    });

    it("安裝新 plugin 成功後應插入陣列最前面", async () => {
      const store = useManagedPluginStore();
      const existing = createMockPlugin({
        id: "plugin-1",
        githubRepo: "owner/repo-a",
      });
      store.plugins = [existing];

      const newPlugin = createMockPlugin({
        id: "plugin-2",
        githubRepo: "owner/repo-b",
      });
      mockInstallPlugin.mockResolvedValueOnce(newPlugin);

      await store.install("owner/repo-b");

      expect(store.plugins).toHaveLength(2);
      expect(store.plugins[0]).toEqual(newPlugin);
      expect(store.plugins[1]).toEqual(existing);
    });
  });

  describe("update", () => {
    it("update 應以 upsert 邏輯替換陣列中同 id 的舊項目", async () => {
      const store = useManagedPluginStore();
      const original = createMockPlugin({
        id: "plugin-1",
        displayName: "舊名稱",
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
      const other = createMockPlugin({
        id: "plugin-2",
        githubRepo: "owner/other",
      });
      store.plugins = [original, other];

      const updated = createMockPlugin({
        id: "plugin-1",
        displayName: "新名稱",
        updatedAt: "2025-06-01T00:00:00.000Z",
      });
      mockUpdatePlugin.mockResolvedValueOnce(updated);

      await store.update("plugin-1");

      expect(store.plugins).toHaveLength(2);
      expect(store.plugins[0]).toEqual(updated);
      expect(store.plugins[0]?.displayName).toBe("新名稱");
      expect(store.plugins[1]).toEqual(other);
    });

    it("update 找不到同 id 時應 append 到陣列末尾", async () => {
      const store = useManagedPluginStore();
      const existing = createMockPlugin({ id: "plugin-1" });
      store.plugins = [existing];

      const newPlugin = createMockPlugin({ id: "plugin-999" });
      mockUpdatePlugin.mockResolvedValueOnce(newPlugin);

      await store.update("plugin-999");

      expect(store.plugins).toHaveLength(2);
      expect(store.plugins[1]).toEqual(newPlugin);
    });
  });

  describe("remove", () => {
    it("remove 成功後應從陣列移除對應 id 的項目", async () => {
      const store = useManagedPluginStore();
      const toRemove = createMockPlugin({ id: "plugin-1" });
      const toKeep = createMockPlugin({
        id: "plugin-2",
        githubRepo: "owner/other",
      });
      store.plugins = [toRemove, toKeep];

      mockDeletePlugin.mockResolvedValueOnce("plugin-1");

      await store.remove("plugin-1");

      expect(store.plugins).toHaveLength(1);
      expect(store.plugins[0]).toEqual(toKeep);
    });

    it("remove 應呼叫 deletePlugin API 並傳入正確 pluginId", async () => {
      const store = useManagedPluginStore();
      store.plugins = [createMockPlugin({ id: "plugin-1" })];
      mockDeletePlugin.mockResolvedValueOnce("plugin-1");

      await store.remove("plugin-1");

      expect(mockDeletePlugin).toHaveBeenCalledWith("plugin-1");
    });
  });
});
