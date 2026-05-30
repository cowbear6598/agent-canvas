/**
 * pluginInstallService 商業邏輯單元測試
 *
 * User Flow 涵蓋：
 *   F2：install 成功（clone → extractMetadata → store.insert）
 *   F3：install clone 失敗 → 不寫入 store
 *   F4：重複安裝 → 直接回 PLUGIN_ALREADY_INSTALLED，不呼叫 clone
 *   F5：remove（rm + store.delete）
 *   F6：update（staging clone → activate → store.update，保留 id）
 *   F1：refreshAllPlugins（只 pull 有差的 plugin，無差的不觸發 store.update）
 *
 * Mock 邊界：
 *   - managedPluginRegistry（store CRUD 方法）
 *   - operationHelpers（gitOperation / gitOperationWithPath / fsOperation）
 *   - simple-git（simpleGit factory，供 gitOperation 內部使用）
 *   - database/index（getDb，供 removePlugin 清除 pod_plugin_ids 使用）
 *   - fs.promises.readFile（模擬 extractPluginMetadata 讀取 plugin.json）
 */

// ─── hoisted：simple-git mock factory ──────────────────────────────────────
// vi.mock 工廠被 hoist 到最頂層，不能直接引用 let 變數；
// 透過 vi.hoisted 先建立一個可被後續 beforeEach 控制的 spy 容器
const { mockClone, mockLoggerWarn } = vi.hoisted(() => ({
  mockClone: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("simple-git", () => ({
  simpleGit: () => ({
    clone: mockClone,
  }),
}));

// ─── mock managedPluginRegistry ─────────────────────────────────────────────
vi.mock("../../src/services/plugin/managedPluginRegistry.js", () => ({
  managedPluginStore: {
    getBySource: vi.fn(),
    getByGithubRepo: vi.fn(),
    getById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
}));

// ─── mock operationHelpers ────────────────────────────────────────────────
// gitOperation：直接執行 operation 並包成 ok(data)，讓測試控制 simpleGit clone
// gitOperationWithPath：直接用 fake git 物件呼叫 operation
// fsOperation：允許各測試透過 vi.mocked 設定回傳值
vi.mock("../../src/utils/operationHelpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/utils/operationHelpers.js")
    >();
  return {
    ...actual,
    gitOperation: vi.fn(async (operation: () => Promise<unknown>) => {
      try {
        const data = await operation();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }),
    gitOperationWithPath: vi.fn(),
    fsOperation: vi.fn(),
  };
});

// ─── mock database/index（getDb().prepare().run()）────────────────────────
const mockDbRun = vi.fn();
vi.mock("../../src/database/index.js", () => ({
  getDb: () => ({
    prepare: () => ({ run: mockDbRun }),
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/services/plugin/pluginScanFs.js", () => ({
  listSkillsForPlugin: vi.fn(async () => [
    { skillName: "skills/test", description: "測試 skill" },
  ]),
}));

// ─── mock fs.promises（模擬 extractPluginMetadata 讀取 plugin.json）────────
// fs 是 CommonJS 模組：在 vitest ESM 環境中，importActual 回傳的是整個 namespace，
// 不透過 .default，直接展開並覆寫 promises 即可
const {
  mockReadFile,
  mockRm,
  mockAccess,
  mockMkdtemp,
  mockMkdir,
  mockWriteFile,
  mockRename,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockRm: vi.fn(),
  mockAccess: vi.fn(),
  mockMkdtemp: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockRename: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: {
      ...(actual as { promises?: object }).promises,
      readFile: mockReadFile,
      rm: mockRm,
      access: mockAccess,
      mkdtemp: mockMkdtemp,
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      rename: mockRename,
    },
    default: {
      ...(actual as { default?: object }).default,
      promises: {
        ...((actual as { default?: { promises?: object } }).default?.promises ??
          {}),
        readFile: mockReadFile,
        rm: mockRm,
        access: mockAccess,
        mkdtemp: mockMkdtemp,
        mkdir: mockMkdir,
        writeFile: mockWriteFile,
        rename: mockRename,
      },
    },
  };
});

// ─── Imports（必須在所有 mock 之後）─────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import { zipSync } from "fflate";
import { ok, err } from "../../src/types/result.js";
import {
  installPlugin,
  importBundleArchive,
  MAX_BUNDLE_ARCHIVE_BYTES,
  removePlugin,
  updatePlugin,
  refreshAllPlugins,
} from "../../src/services/plugin/pluginInstallService.js";
import { managedPluginStore } from "../../src/services/plugin/managedPluginRegistry.js";
import {
  gitOperation,
  gitOperationWithPath,
  fsOperation,
} from "../../src/utils/operationHelpers.js";
import type { ManagedPluginRecord } from "../../src/services/plugin/managedPluginRegistry.js";

// ─── 輔助：建立 ManagedPluginRecord ─────────────────────────────────────────
function makeRecord(
  overrides: Partial<ManagedPluginRecord> = {},
): ManagedPluginRecord {
  return {
    id: "owner/repo",
    source: { type: "github", ref: "owner/repo" },
    githubRepo: "owner/repo",
    displayName: "repo",
    description: null,
    installPath: "/plugins/owner__repo",
    installedAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEnoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

// ─── 輔助：模擬 plugin.json 讀取成功 ─────────────────────────────────────────
function mockValidPluginJson(name: string, description?: string): void {
  mockReadFile.mockResolvedValueOnce(
    JSON.stringify({ name, description: description ?? null }),
  );
}

function createBundleZip(entries: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([filePath, content]) => [
        filePath,
        new TextEncoder().encode(content),
      ]),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P5.B.t1：installPlugin / removePlugin / updatePlugin 商業邏輯測試
// ─────────────────────────────────────────────────────────────────────────────

describe("installPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 預設：clone 成功（mockClone 不 throw）
    mockClone.mockResolvedValue(undefined);

    // 預設：gitOperation 使用 wrapper（已在 vi.mock 工廠實作），不需額外設定

    // 預設：無重複安裝
    vi.mocked(managedPluginStore.getBySource).mockReturnValue(null);
    vi.mocked(managedPluginStore.getByGithubRepo).mockReturnValue(null);

    // 預設：insert 回傳 record
    vi.mocked(managedPluginStore.insert).mockImplementation((r) => r);

    // 預設：readFile 丟出 ENOENT（讓 extractPluginMetadata fallback）
    mockReadFile.mockRejectedValue(makeEnoentError());
    mockAccess.mockRejectedValue(makeEnoentError());
    mockMkdtemp.mockResolvedValue("/tmp/agent-canvas-test-install");
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("F2：install 成功時呼叫順序為 clone → extractMetadata（readFile）→ store.insert", async () => {
    // 讓 readFile 回傳合法的 plugin.json
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ name: "My Plugin", description: "A plugin" }),
    );

    const result = await installPlugin("owner/repo");

    expect(result.success).toBe(true);

    // 驗證 clone 被呼叫
    expect(mockClone).toHaveBeenCalledTimes(1);
    const [cloneUrl] = mockClone.mock.calls[0] as [string, string];
    expect(cloneUrl).toContain("owner/repo");

    // 驗證 readFile 被呼叫（extractPluginMetadata）
    expect(mockReadFile).toHaveBeenCalledTimes(1);

    // 驗證 store.insert 被呼叫
    expect(managedPluginStore.insert).toHaveBeenCalledTimes(1);
    const insertArg = vi.mocked(managedPluginStore.insert).mock.calls[0]![0];
    expect(insertArg.githubRepo).toBe("owner/repo");
    expect(insertArg.displayName).toBe("My Plugin");
    expect(insertArg.description).toBe("A plugin");
  });

  it("F2：manifest 不存在時靜默 fallback 為第一個 skill 名稱", async () => {
    // readFile 已在 beforeEach 設為 reject
    const result = await installPlugin("owner/repo");

    expect(result.success).toBe(true);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    const insertArg = vi.mocked(managedPluginStore.insert).mock.calls[0]![0];
    expect(insertArg.displayName).toBe("test");
    expect(insertArg.description).toBe("測試 skill");
  });

  it("F2：metadata 支援 legacy .claude-plugin/plugin.json fallback", async () => {
    mockReadFile
      .mockRejectedValueOnce(makeEnoentError())
      .mockResolvedValueOnce(
        JSON.stringify({ name: "Legacy Plugin", description: "legacy" }),
      );

    const result = await installPlugin("owner/repo");

    expect(result.success).toBe(true);
    expect(mockReadFile).toHaveBeenCalledTimes(2);
    expect(mockReadFile.mock.calls[0]![0]).toContain(
      ".codex-plugin/plugin.json",
    );
    expect(mockReadFile.mock.calls[1]![0]).toContain(
      ".claude-plugin/plugin.json",
    );
    const insertArg = vi.mocked(managedPluginStore.insert).mock.calls[0]![0];
    expect(insertArg.displayName).toBe("Legacy Plugin");
    expect(insertArg.description).toBe("legacy");
  });

  it("F4：已存在相同 repo 時直接回 PLUGIN_ALREADY_INSTALLED，不呼叫 clone", async () => {
    vi.mocked(managedPluginStore.getBySource).mockReturnValue(makeRecord());
    vi.mocked(managedPluginStore.getByGithubRepo).mockReturnValue(makeRecord());

    const result = await installPlugin("owner/repo");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("PLUGIN_ALREADY_INSTALLED");
    }
    // clone 不應被呼叫
    expect(mockClone).not.toHaveBeenCalled();
    // store.insert 不應被呼叫
    expect(managedPluginStore.insert).not.toHaveBeenCalled();
  });

  it("F3：clone 失敗時不呼叫 store.insert", async () => {
    // clone throw → gitOperation 的 wrapper 回傳 { success: false }
    mockClone.mockRejectedValueOnce(new Error("network error"));

    const result = await installPlugin("owner/repo");

    expect(result.success).toBe(false);
    expect(managedPluginStore.insert).not.toHaveBeenCalled();
  });

  it("無效的 repo 格式時回 INVALID_GITHUB_REPO_FORMAT", async () => {
    const result = await installPlugin("not-a-valid-repo");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("INVALID_GITHUB_REPO_FORMAT");
    }
    expect(mockClone).not.toHaveBeenCalled();
  });
});

describe("importBundleArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(managedPluginStore.getBySource).mockReturnValue(null);
    vi.mocked(managedPluginStore.insert).mockImplementation((record) => ({
      sortIndex: 0,
      ...record,
    }));
    mockReadFile.mockRejectedValue(makeEnoentError());
    mockAccess.mockRejectedValue(makeEnoentError());
    mockMkdtemp.mockResolvedValue("/tmp/agent-canvas-test-bundle");
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("使用 archive 內容 hash 當作 upload source ref，而不是 displayName slug", async () => {
    const archiveBytes = createBundleZip({
      "skills/plan/SKILL.md": "---\ndescription: 測試\n---\n# Plan\n",
      ".codex-plugin/plugin.json": JSON.stringify({
        name: "Plan Bundle",
        description: "bundle",
      }),
    });
    const expectedSourceRef = createHash("sha256")
      .update(archiveBytes)
      .digest("hex")
      .slice(0, 32);
    mockValidPluginJson("Plan Bundle", "bundle");

    const result = await importBundleArchive(
      new File([archiveBytes], "plan-bundle.zip", {
        type: "application/zip",
      }),
    );

    expect(result.success).toBe(true);
    expect(managedPluginStore.insert).toHaveBeenCalledTimes(1);
    const insertArg = vi.mocked(managedPluginStore.insert).mock.calls[0]![0];
    expect(insertArg.id).toBe(`upload:${expectedSourceRef}`);
    expect(insertArg.source).toEqual({
      type: "upload",
      ref: expectedSourceRef,
    });
    expect(insertArg.displayName).toBe("Plan Bundle");
    expect(insertArg.installPath).toContain(`upload__${expectedSourceRef}`);
  });

  it("超過 archive 大小上限時直接回 BUNDLE_FILE_TOO_LARGE", async () => {
    const oversizedBytes = new Uint8Array(MAX_BUNDLE_ARCHIVE_BYTES + 1);

    const result = await importBundleArchive(
      new File([oversizedBytes], "oversized.zip", {
        type: "application/zip",
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("BUNDLE_FILE_TOO_LARGE");
    }
    expect(managedPluginStore.insert).not.toHaveBeenCalled();
  });
});

describe("removePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 預設：fsOperation 成功
    vi.mocked(fsOperation).mockResolvedValue(ok(undefined));

    // 預設：getById 找到 record
    vi.mocked(managedPluginStore.getById).mockReturnValue(makeRecord());

    // 預設：delete 回傳 true
    vi.mocked(managedPluginStore.delete).mockReturnValue(true);
  });

  it("F5：remove 成功時 fsOperation rm 與 store.delete 都被呼叫", async () => {
    const result = await removePlugin("owner/repo");

    expect(result.success).toBe(true);
    expect(fsOperation).toHaveBeenCalledTimes(1);
    expect(managedPluginStore.delete).toHaveBeenCalledWith("owner/repo");
  });

  it("plugin 不存在時回 PLUGIN_NOT_FOUND，不呼叫 fsOperation 與 store.delete", async () => {
    vi.mocked(managedPluginStore.getById).mockReturnValue(null);

    const result = await removePlugin("owner/repo");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("PLUGIN_NOT_FOUND");
    }
    expect(fsOperation).not.toHaveBeenCalled();
    expect(managedPluginStore.delete).not.toHaveBeenCalled();
  });

  it("F5：fsOperation 失敗時不呼叫 store.delete", async () => {
    vi.mocked(fsOperation).mockResolvedValue(err("FS_ERROR"));

    const result = await removePlugin("owner/repo");

    expect(result.success).toBe(false);
    expect(managedPluginStore.delete).not.toHaveBeenCalled();
  });
});

describe("updatePlugin", () => {
  const originalRecord = makeRecord({
    id: "owner/repo",
    displayName: "Old Plugin Name",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // 預設：clone 成功
    mockClone.mockResolvedValue(undefined);

    // 預設：fsOperation 成功
    vi.mocked(fsOperation).mockResolvedValue(ok(undefined));

    // 預設：getById 找到 record
    vi.mocked(managedPluginStore.getById).mockReturnValue(originalRecord);

    // 預設：update 回傳更新後的 record
    vi.mocked(managedPluginStore.update).mockImplementation((id, partial) => ({
      ...originalRecord,
      ...partial,
    }));

    // 預設：readFile fallback（ENOENT）
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockAccess.mockRejectedValue(makeEnoentError());
    mockMkdtemp.mockResolvedValue("/tmp/agent-canvas-test-update");
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it("F6：update 成功時先 clone 到 staging，再啟用新版本並更新 store", async () => {
    // 模擬讀到新的 plugin.json（更新後的 metadata）
    mockValidPluginJson("New Plugin Name");

    const result = await updatePlugin("owner/repo");

    expect(result.success).toBe(true);

    // 驗證 clone 被呼叫
    expect(mockClone).toHaveBeenCalledTimes(1);
    const [, clonePath] = mockClone.mock.calls[0] as [string, string];
    expect(clonePath).not.toBe(originalRecord.installPath);
    expect(clonePath).toBe("/tmp/agent-canvas-test-update");

    // 驗證 activate 階段透過 fsOperation 執行
    expect(fsOperation).toHaveBeenCalledTimes(1);

    // 驗證 store.update（而非 insert）被呼叫，且 id 保留
    expect(managedPluginStore.insert).not.toHaveBeenCalled();
    expect(managedPluginStore.update).toHaveBeenCalledTimes(1);
    const [updateId, updatePartial] = vi.mocked(managedPluginStore.update).mock
      .calls[0]!;
    expect(updateId).toBe("owner/repo");
    expect(updatePartial).toMatchObject({ displayName: "New Plugin Name" });
  });

  it("F6：update 時 store.update 的 id 與原始 id 一致（保留 id）", async () => {
    const result = await updatePlugin("owner/repo");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("owner/repo");
    }
  });

  it("plugin 不存在時回 PLUGIN_NOT_FOUND", async () => {
    vi.mocked(managedPluginStore.getById).mockReturnValue(null);

    const result = await updatePlugin("owner/repo");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("PLUGIN_NOT_FOUND");
    }
    expect(fsOperation).not.toHaveBeenCalled();
    expect(mockClone).not.toHaveBeenCalled();
  });

  it("啟用新版本失敗時不更新 store", async () => {
    vi.mocked(fsOperation).mockResolvedValue(err("FS_ERROR"));

    const result = await updatePlugin("owner/repo");

    expect(result.success).toBe(false);
    expect(mockClone).toHaveBeenCalledTimes(1);
    expect(managedPluginStore.update).not.toHaveBeenCalled();
  });

  it("舊安裝目錄存在且 backup 失敗時不覆蓋既有 plugin", async () => {
    mockAccess.mockResolvedValue(undefined);
    vi.mocked(fsOperation).mockResolvedValueOnce(err("FS_ERROR"));

    const result = await updatePlugin("owner/repo");

    expect(result.success).toBe(false);
    expect(mockClone).toHaveBeenCalledTimes(1);
    expect(managedPluginStore.update).not.toHaveBeenCalled();
    expect(fsOperation).toHaveBeenCalledTimes(1);
  });

  it("clone 失敗時不更新 store", async () => {
    mockClone.mockRejectedValueOnce(new Error("clone failed"));

    const result = await updatePlugin("owner/repo");

    expect(result.success).toBe(false);
    expect(managedPluginStore.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P5.B.t2：refreshAllPlugins 商業邏輯測試
// ─────────────────────────────────────────────────────────────────────────────

describe("refreshAllPlugins", () => {
  const pluginA = makeRecord({
    id: "owner/plugin-a",
    source: { type: "github", ref: "owner/plugin-a" },
    githubRepo: "owner/plugin-a",
    installPath: "/plugins/owner__plugin-a",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  const pluginB = makeRecord({
    id: "owner/plugin-b",
    source: { type: "github", ref: "owner/plugin-b" },
    githubRepo: "owner/plugin-b",
    installPath: "/plugins/owner__plugin-b",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // store.list 回傳 2 個 record
    vi.mocked(managedPluginStore.list).mockReturnValue([pluginA, pluginB]);

    // store.update 回傳更新後的 record
    vi.mocked(managedPluginStore.update).mockImplementation((id, partial) =>
      makeRecord({
        id,
        source: { type: "github", ref: id },
        githubRepo: id,
        ...partial,
      }),
    );
  });

  it("F1：head === remoteHead 的 plugin 不觸發 pull 也不呼叫 store.update", async () => {
    const SAME_HEAD = "abc123";

    // plugin A：head === remoteHead → 不 pull
    // plugin B：head !== remoteHead → pull
    vi.mocked(gitOperationWithPath).mockImplementation(
      async (installPath, operation) => {
        const fakeGit = {
          fetch: vi.fn().mockResolvedValue(undefined),
          revparse: vi.fn().mockImplementation((args: string[]) => {
            if (installPath === pluginA.installPath) {
              // plugin A：兩個 ref 都回傳相同 hash
              return Promise.resolve(SAME_HEAD);
            } else {
              // plugin B：HEAD 與 @{u} 不同
              const isRemote = args.includes("@{u}");
              return Promise.resolve(isRemote ? "remote999" : "local000");
            }
          }),
          pull: vi.fn().mockResolvedValue(undefined),
        };
        const data = await operation(
          fakeGit as ReturnType<typeof import("simple-git").simpleGit>,
        );
        return ok(data);
      },
    );

    const result = await refreshAllPlugins();

    expect(result.success).toBe(true);

    // 只有 plugin B 觸發 store.update（有 pull）
    expect(managedPluginStore.update).toHaveBeenCalledTimes(1);
    const [updateId] = vi.mocked(managedPluginStore.update).mock.calls[0]!;
    expect(updateId).toBe("owner/plugin-b");
  });

  it("F1：head !== remoteHead 的 plugin B 觸發 store.update 且 updatedAt 被更新", async () => {
    const beforeTime = new Date().toISOString();

    vi.mocked(gitOperationWithPath).mockImplementation(
      async (installPath, operation) => {
        const fakeGit = {
          fetch: vi.fn().mockResolvedValue(undefined),
          revparse: vi.fn().mockImplementation((args: string[]) => {
            if (installPath === pluginA.installPath) {
              return Promise.resolve("same-hash");
            } else {
              return Promise.resolve(
                args.includes("@{u}") ? "remote-hash" : "local-hash",
              );
            }
          }),
          pull: vi.fn().mockResolvedValue(undefined),
        };
        const data = await operation(
          fakeGit as ReturnType<typeof import("simple-git").simpleGit>,
        );
        return ok(data);
      },
    );

    await refreshAllPlugins();

    const updateCall = vi.mocked(managedPluginStore.update).mock.calls[0]!;
    const [, updatePartial] = updateCall;
    // updatedAt 應為 ISO 字串且晚於或等於測試開始時間
    expect(updatePartial.updatedAt).toBeDefined();
    expect(new Date(updatePartial.updatedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(beforeTime).getTime() - 1000,
    );
  });

  it("F1：plugin A（無差異）不觸發 store.update", async () => {
    vi.mocked(gitOperationWithPath).mockImplementation(
      async (_installPath, operation) => {
        // 所有 plugin 都回傳 head === remoteHead（無更新）
        const fakeGit = {
          fetch: vi.fn().mockResolvedValue(undefined),
          revparse: vi.fn().mockResolvedValue("same-hash-for-all"),
          pull: vi.fn().mockResolvedValue(undefined),
        };
        const data = await operation(
          fakeGit as ReturnType<typeof import("simple-git").simpleGit>,
        );
        return ok(data);
      },
    );

    await refreshAllPlugins();

    // 無任何 plugin 觸發 store.update
    expect(managedPluginStore.update).not.toHaveBeenCalled();
  });

  it("store.list 回傳空陣列時結果為空陣列", async () => {
    vi.mocked(managedPluginStore.list).mockReturnValue([]);

    const result = await refreshAllPlugins();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
    expect(gitOperationWithPath).not.toHaveBeenCalled();
  });

  it("gitOperationWithPath 失敗時不觸發 store.update，繼續處理其他 plugin", async () => {
    vi.mocked(gitOperationWithPath).mockImplementation(
      async (installPath, _operation) => {
        if (installPath === pluginA.installPath) {
          // plugin A：網路錯誤
          return err("GIT_FETCH_ERROR");
        }
        // plugin B：有更新
        return ok(true);
      },
    );

    const result = await refreshAllPlugins();

    expect(result.success).toBe(true);
    // 只有 plugin B（成功且有 pull）觸發 store.update
    expect(managedPluginStore.update).toHaveBeenCalledTimes(1);
    const [updateId] = vi.mocked(managedPluginStore.update).mock.calls[0]!;
    expect(updateId).toBe("owner/plugin-b");
  });
});
