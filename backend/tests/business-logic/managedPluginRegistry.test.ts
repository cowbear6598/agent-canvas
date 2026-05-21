import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  initTestDb,
  resetDb,
} from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import {
  managedPluginStore,
  type ManagedPluginRecord,
} from "../../src/services/plugin/managedPluginRegistry.js";

function insertPlugin(
  overrides: Partial<ManagedPluginRecord> & Pick<ManagedPluginRecord, "id">,
): ManagedPluginRecord {
  return managedPluginStore.insert({
    githubRepo: `owner/${overrides.id}`,
    displayName: overrides.id,
    description: null,
    installPath: `/plugins/${overrides.id}`,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  });
}

function listIds(): string[] {
  return managedPluginStore.list().map((plugin) => plugin.id);
}

describe("managedPluginStore.reorder", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  afterEach(() => {
    resetDb();
    closeDb();
  });

  it("成功排序時應寫入 sort_index 並讓 list 回傳確認後順序", () => {
    insertPlugin({ id: "plugin-a", sortIndex: 0 });
    insertPlugin({ id: "plugin-b", sortIndex: 1 });
    insertPlugin({ id: "plugin-c", sortIndex: 2 });

    const result = managedPluginStore.reorder([
      "plugin-c",
      "plugin-a",
      "plugin-b",
    ]);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.toString());
    expect(result.data.map((plugin) => plugin.id)).toEqual([
      "plugin-c",
      "plugin-a",
      "plugin-b",
    ]);
    expect(result.data.map((plugin) => plugin.sortIndex)).toEqual([0, 1, 2]);
    expect(listIds()).toEqual(["plugin-c", "plugin-a", "plugin-b"]);
  });

  it("部分 id 排序時應將未傳入項目依既有順序接在後面", () => {
    insertPlugin({ id: "plugin-a", sortIndex: 0 });
    insertPlugin({ id: "plugin-b", sortIndex: 1 });
    insertPlugin({ id: "plugin-c", sortIndex: 2 });

    const result = managedPluginStore.reorder(["plugin-c"]);

    expect(result.success).toBe(true);
    expect(listIds()).toEqual(["plugin-c", "plugin-a", "plugin-b"]);
  });

  it("未知 id 應回 PLUGIN_NOT_FOUND 且不改寫既有順序", () => {
    insertPlugin({ id: "plugin-a", sortIndex: 0 });
    insertPlugin({ id: "plugin-b", sortIndex: 1 });

    const result = managedPluginStore.reorder(["plugin-b", "plugin-missing"]);

    expect(result).toEqual({ success: false, error: "PLUGIN_NOT_FOUND" });
    expect(listIds()).toEqual(["plugin-a", "plugin-b"]);
  });

  it("重複 id 應回 PLUGIN_REORDER_DUPLICATE_IDS 且不改寫既有順序", () => {
    insertPlugin({ id: "plugin-a", sortIndex: 0 });
    insertPlugin({ id: "plugin-b", sortIndex: 1 });

    const result = managedPluginStore.reorder(["plugin-b", "plugin-b"]);

    expect(result).toEqual({
      success: false,
      error: "PLUGIN_REORDER_DUPLICATE_IDS",
    });
    expect(listIds()).toEqual(["plugin-a", "plugin-b"]);
  });
});
