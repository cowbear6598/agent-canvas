import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import type { InstalledPlugin } from "@/types/plugin";

const {
  mockListPlugins,
  mockInstallPlugin,
  mockDeletePlugin,
  mockUpdatePlugin,
  mockReorderPlugins,
  mockUploadPluginBundle,
} = vi.hoisted(() => ({
  mockListPlugins: vi.fn(),
  mockInstallPlugin: vi.fn(),
  mockDeletePlugin: vi.fn(),
  mockUpdatePlugin: vi.fn(),
  mockReorderPlugins: vi.fn(),
  mockUploadPluginBundle: vi.fn(),
}));

vi.mock("@/services/pluginApi", () => ({
  listPlugins: mockListPlugins,
  installPlugin: mockInstallPlugin,
  deletePlugin: mockDeletePlugin,
  updatePlugin: mockUpdatePlugin,
  reorderPlugins: mockReorderPlugins,
  uploadPluginBundle: mockUploadPluginBundle,
}));

function createMockPlugin(
  overrides?: Partial<InstalledPlugin>,
): InstalledPlugin {
  return {
    id: "plugin-1",
    source: {
      type: "github",
      ref: "owner/repo",
    },
    displayName: "Test Plugin",
    installPath: "/path/to/plugin",
    sortIndex: 0,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("managedPluginStore", () => {
  setupStoreTest();

  describe("install", () => {
    it("重複安裝相同 GitHub 來源時應拋出重複匯入錯誤且不呼叫 API", async () => {
      const store = useManagedPluginStore();
      store.plugins = [
        createMockPlugin({
          id: "plugin-1",
          source: { type: "github", ref: "owner/repo" },
        }),
      ];

      await expect(store.install("owner/repo")).rejects.toThrow();

      expect(mockInstallPlugin).not.toHaveBeenCalled();
    });

    it("安裝新 plugin 成功後應依後端 sortIndex 排序，不強制插入最前面", async () => {
      const store = useManagedPluginStore();
      const existing = createMockPlugin({
        id: "plugin-1",
        source: { type: "github", ref: "owner/repo-a" },
        sortIndex: 0,
      });
      store.plugins = [existing];

      const newPlugin = createMockPlugin({
        id: "plugin-2",
        source: { type: "github", ref: "owner/repo-b" },
        sortIndex: 1,
      });
      mockInstallPlugin.mockResolvedValueOnce(newPlugin);

      await store.install("owner/repo-b");

      expect(store.plugins).toHaveLength(2);
      expect(store.plugins[0]).toEqual(existing);
      expect(store.plugins[1]).toEqual(newPlugin);
    });
  });

  describe("upload", () => {
    it("上傳替換成功後應採用後端完整清單並移除同名舊版本", async () => {
      const store = useManagedPluginStore();
      store.plugins = [
        createMockPlugin({
          id: "upload:old-a",
          source: { type: "upload", ref: "old-a" },
          displayName: "Plan Bundle",
          sortIndex: 1,
        }),
        createMockPlugin({
          id: "upload:old-b",
          source: { type: "upload", ref: "old-b" },
          displayName: "PLAN BUNDLE",
          sortIndex: 3,
        }),
      ];
      const githubPlugin = createMockPlugin({
        id: "owner/plan-bundle",
        source: { type: "github", ref: "owner/plan-bundle" },
        displayName: "Plan Bundle",
        sortIndex: 0,
      });
      const newUpload = createMockPlugin({
        id: "upload:new",
        source: { type: "upload", ref: "new" },
        displayName: "Plan Bundle",
        sortIndex: 1,
      });
      mockUploadPluginBundle.mockResolvedValueOnce({
        bundle: newUpload,
        plugins: [newUpload, githubPlugin],
      });

      const result = await store.upload(
        new File(["zip"], "plan-bundle.zip", { type: "application/zip" }),
      );

      expect(result).toEqual(newUpload);
      expect(store.plugins).toEqual([githubPlugin, newUpload]);
      expect(store.plugins.map((plugin) => plugin.id)).not.toContain(
        "upload:old-a",
      );
      expect(store.plugins.map((plugin) => plugin.id)).not.toContain(
        "upload:old-b",
      );
    });
  });

  describe("reorder", () => {
    it("應先 optimistic update，再套用 API confirmed order", async () => {
      const store = useManagedPluginStore();
      const pluginA = createMockPlugin({ id: "plugin-a", sortIndex: 0 });
      const pluginB = createMockPlugin({ id: "plugin-b", sortIndex: 1 });
      const pluginC = createMockPlugin({ id: "plugin-c", sortIndex: 2 });
      store.plugins = [pluginA, pluginB, pluginC];

      const confirmed = [
        createMockPlugin({ id: "plugin-c", sortIndex: 0 }),
        createMockPlugin({ id: "plugin-a", sortIndex: 1 }),
        createMockPlugin({ id: "plugin-b", sortIndex: 2 }),
      ];
      let resolveReorder!: (plugins: InstalledPlugin[]) => void;
      mockReorderPlugins.mockReturnValueOnce(
        new Promise<InstalledPlugin[]>((resolve) => {
          resolveReorder = resolve;
        }),
      );

      const reorderPromise = store.reorder(["plugin-c", "plugin-a"]);

      expect(store.plugins.map((plugin) => plugin.id)).toEqual([
        "plugin-c",
        "plugin-a",
        "plugin-b",
      ]);
      expect(mockReorderPlugins).toHaveBeenCalledWith([
        "plugin-c",
        "plugin-a",
      ]);

      resolveReorder(confirmed);
      await reorderPromise;

      expect(store.plugins).toEqual(confirmed);
      expect(store.error).toBeNull();
    });

    it("API 失敗時應 rollback 並設定 error", async () => {
      const store = useManagedPluginStore();
      const pluginA = createMockPlugin({ id: "plugin-a", sortIndex: 0 });
      const pluginB = createMockPlugin({ id: "plugin-b", sortIndex: 1 });
      store.plugins = [pluginA, pluginB];
      mockReorderPlugins.mockRejectedValueOnce(new Error("排序失敗"));

      await expect(store.reorder(["plugin-b", "plugin-a"])).rejects.toThrow(
        "排序失敗",
      );

      expect(store.plugins).toEqual([pluginA, pluginB]);
      expect(store.error).toBe("排序失敗");
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
        source: { type: "github", ref: "owner/other" },
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
        source: { type: "github", ref: "owner/other" },
      });
      store.plugins = [toRemove, toKeep];

      mockDeletePlugin.mockResolvedValueOnce({ pluginId: "plugin-1" });

      await store.remove("plugin-1");

      expect(store.plugins).toHaveLength(1);
      expect(store.plugins[0]).toEqual(toKeep);
    });

    it("remove 應呼叫 deletePlugin API 並傳入正確 pluginId", async () => {
      const store = useManagedPluginStore();
      store.plugins = [createMockPlugin({ id: "plugin-1" })];
      mockDeletePlugin.mockResolvedValueOnce({ pluginId: "plugin-1" });

      await store.remove("plugin-1");

      expect(mockDeletePlugin).toHaveBeenCalledWith("plugin-1");
    });
  });
});
