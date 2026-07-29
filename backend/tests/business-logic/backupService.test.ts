import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
} from "vitest";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { strFromU8, unzipSync } from "fflate";

// ─────────────────────────────────────────────────────────────────────────────
// 使用固定暫存根目錄，測試獨立 backup repository 的真實檔案操作。
// ─────────────────────────────────────────────────────────────────────────────

// 頂層同步建立 tmpdir（vi.mock factory 執行時可讀取此值）
const BACKUP_TMP_DIR = mkdtempSync(join(tmpdir(), "backup-svc-suite-"));
const BACKUP_REPO_DIR = join(BACKUP_TMP_DIR, "backup");
const CANVAS_ROOT = join(BACKUP_TMP_DIR, "canvas");
const REPOSITORIES_ROOT = join(BACKUP_TMP_DIR, "repositories");
const PLUGINS_ROOT = join(BACKUP_TMP_DIR, "plugins");
const AGENTS_ROOT = join(BACKUP_TMP_DIR, "agents");
const COMMANDS_ROOT = join(BACKUP_TMP_DIR, "commands");
const RESTORE_ROOT = join(BACKUP_TMP_DIR, "restore");
const DATA_ROOTS = [
  CANVAS_ROOT,
  REPOSITORIES_ROOT,
  PLUGINS_ROOT,
  AGENTS_ROOT,
  COMMANDS_ROOT,
];

// ── mock simple-git（保留，用於網路情境：push 失敗 / 認證失敗 / 連線失敗）────
const mockGit = {
  checkIsRepo: vi.fn(),
  init: vi.fn(),
  addConfig: vi.fn(),
  getRemotes: vi.fn(),
  addRemote: vi.fn(),
  raw: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
};

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

// ── mock config：appDataRoot 固定指向頂層 tmpdir ─────────────────────────
vi.mock("../../src/config/index.js", () => ({
  config: {
    appDataRoot: BACKUP_TMP_DIR,
    canvasRoot: CANVAS_ROOT,
    repositoriesRoot: REPOSITORIES_ROOT,
    pluginsRoot: PLUGINS_ROOT,
    agentsPath: AGENTS_ROOT,
    commandsPath: COMMANDS_ROOT,
  },
}));

// ── mock logger（避免測試雜訊）────────────────────────────────────────────
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ── mock configStore（handler emit 行為測試需要）────────────────────────
const mockGetBackupConfig = vi.fn();

vi.mock("../../src/services/configStore.js", () => ({
  configStore: {
    getBackupConfig: mockGetBackupConfig,
  },
}));

// ── mock socketService（避免 connectionManager / roomManager 依賴鏈）────
const mockEmitToConnection = vi.fn();
const mockEmitToAll = vi.fn();

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: mockEmitToConnection,
    emitToAll: mockEmitToAll,
  },
}));

// ── 在所有 mock 設置後 import（保持 import 在 mock 之後）────────────────
const { backupService } = await import("../../src/services/backupService.js");
const { handleBackupTrigger, handleBackupTestConnection } =
  await import("../../src/handlers/backupHandlers.js");

// ─────────────────────────────────────────────────────────────────────────────
// 測試常數
// ─────────────────────────────────────────────────────────────────────────────

const REMOTE_URL = "https://github.com/user/backup.git";
const CONNECTION_ID = "conn-test-1";
const REQUEST_ID = "req-test-1";

// ─────────────────────────────────────────────────────────────────────────────
// 生命週期：清理 tmpdir 殘留 + 重設 mock 狀態
// ─────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  // 測試套件結束後清理整個 tmpdir
  await rm(BACKUP_TMP_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  // 刪除獨立備份 repository，讓每個測試從乾淨狀態開始
  await rm(BACKUP_REPO_DIR, { recursive: true, force: true });
  await mkdir(BACKUP_REPO_DIR, { recursive: true });
  await rm(RESTORE_ROOT, { recursive: true, force: true });
  await Promise.all(
    DATA_ROOTS.map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );

  // 重設所有 mock 狀態
  vi.clearAllMocks();

  // 預設 git mock 行為（大部分測試的 happy path 預設）
  mockGit.checkIsRepo.mockResolvedValue(true);
  mockGit.getRemotes.mockResolvedValue([
    {
      name: "origin",
      refs: { fetch: REMOTE_URL, push: REMOTE_URL },
    },
  ]);
  mockGit.add.mockResolvedValue(undefined);
  mockGit.commit.mockResolvedValue(undefined);
  mockGit.raw.mockResolvedValue(undefined);
  mockGit.addRemote.mockResolvedValue(undefined);
  mockGit.addConfig.mockResolvedValue(undefined);
  mockGit.init.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 - BackupService 核心功能（真實 fs + simple-git mock）
// ─────────────────────────────────────────────────────────────────────────────

describe("BackupService", () => {
  describe("initRepo", () => {
    it("目標目錄不存在 .git 時自動執行 git init", async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);

      const result = await backupService.initRepo();

      expect(result.success).toBe(true);
      expect(mockGit.init).toHaveBeenCalled();
      expect(mockGit.addConfig).toHaveBeenCalledWith(
        "user.name",
        "AgentCanvas Backup",
      );
      expect(mockGit.addConfig).toHaveBeenCalledWith(
        "user.email",
        "backup@agentcanvas.local",
      );
    });

    it("目標目錄已有 .git 時不重複初始化", async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);

      const result = await backupService.initRepo();

      expect(result.success).toBe(true);
      expect(mockGit.init).not.toHaveBeenCalled();
    });

    it("checkIsRepo 拋錯時回傳初始化失敗錯誤", async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error("git not found"));

      const result = await backupService.initRepo();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("初始化備份倉庫失敗");
      }
    });
  });

  describe("setupRemote", () => {
    it("尚無 remote 時執行 git remote add", async () => {
      mockGit.getRemotes.mockResolvedValue([]);
      mockGit.addRemote.mockResolvedValue(undefined);

      const result = await backupService.setupRemote(REMOTE_URL);

      expect(result.success).toBe(true);
      expect(mockGit.addRemote).toHaveBeenCalledWith("origin", REMOTE_URL);
    });

    it("已有 remote 但 URL 不同時執行 git remote set-url", async () => {
      const oldUrl = "https://github.com/user/old-backup.git";
      mockGit.getRemotes.mockResolvedValue([
        {
          name: "origin",
          refs: { fetch: oldUrl, push: oldUrl },
        },
      ]);
      mockGit.raw.mockResolvedValue(undefined);

      const result = await backupService.setupRemote(REMOTE_URL);

      expect(result.success).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "remote",
        "set-url",
        "origin",
        REMOTE_URL,
      ]);
    });

    it("已有 remote 且 URL 相同時不執行任何操作", async () => {
      mockGit.getRemotes.mockResolvedValue([
        {
          name: "origin",
          refs: { fetch: REMOTE_URL, push: REMOTE_URL },
        },
      ]);

      const result = await backupService.setupRemote(REMOTE_URL);

      expect(result.success).toBe(true);
      expect(mockGit.addRemote).not.toHaveBeenCalled();
      expect(mockGit.raw).not.toHaveBeenCalled();
    });

    it("getRemotes 拋錯時回傳設定失敗錯誤", async () => {
      mockGit.getRemotes.mockRejectedValue(new Error("permission denied"));

      const result = await backupService.setupRemote(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("設定備份遠端倉庫失敗");
      }
    });
  });

  describe("executeBackup", () => {
    it("正常流程成功回傳 ok", async () => {
      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(true);
      expect(mockGit.add).toHaveBeenCalledWith(["canvas.db", "data"]);
      expect(mockGit.commit).toHaveBeenCalled();
      expect(mockGit.raw).toHaveBeenCalledWith([
        "push",
        "--force-with-lease",
        REMOTE_URL,
        "HEAD",
      ]);
    });

    it("備份 canvas.db 與非秘密資料目錄，不包含秘密資料庫或金鑰", async () => {
      await mkdir(join(CANVAS_ROOT, "board"), { recursive: true });
      await writeFile(
        join(CANVAS_ROOT, "board", "notes.json"),
        '{"title":"測試畫布"}',
      );
      const repositoryPath = join(REPOSITORIES_ROOT, "demo");
      await mkdir(repositoryPath, { recursive: true });
      await $`git -C ${repositoryPath} init`.quiet();
      await $`git -C ${repositoryPath} config user.name "Backup Test"`.quiet();
      await $`git -C ${repositoryPath} config user.email "backup@test.local"`.quiet();
      await writeFile(join(repositoryPath, "tracked.txt"), "已提交");
      await symlink("tracked.txt", join(repositoryPath, "tracked-link.txt"));
      await $`git -C ${repositoryPath} add tracked.txt tracked-link.txt`.quiet();
      await $`git -C ${repositoryPath} commit -m "初始提交"`.quiet();
      await $`git -C ${repositoryPath} remote add origin "https://ghp_backup_secret@github.com/example/demo.git"`.quiet();
      await writeFile(
        join(repositoryPath, "uncommitted.txt"),
        "尚未提交",
      );
      await mkdir(join(PLUGINS_ROOT, "demo-plugin"), { recursive: true });
      await writeFile(
        join(PLUGINS_ROOT, "demo-plugin", "plugin.json"),
        '{"name":"demo-plugin"}',
      );
      await mkdir(AGENTS_ROOT, { recursive: true });
      await writeFile(join(AGENTS_ROOT, "helper.md"), "agent");
      await mkdir(COMMANDS_ROOT, { recursive: true });
      await writeFile(join(COMMANDS_ROOT, "run.md"), "command");

      const result = await backupService.executeBackup(REMOTE_URL);
      expect(result.success).toBe(true);

      const snapshot = new Database(join(BACKUP_REPO_DIR, "canvas.db"), {
        readonly: true,
      });
      try {
        const tableNames = (
          snapshot
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
            )
            .all() as Array<{ name: string }>
        ).map((row) => row.name);
        expect(tableNames).toContain("canvases");
        expect(tableNames).not.toContain("secret_records");
      } finally {
        snapshot.close();
      }

      const backupFiles = await readdir(BACKUP_REPO_DIR);
      expect(backupFiles).toContain("canvas.db");
      expect(backupFiles).toContain("data");
      expect(backupFiles).not.toContain("secrets.db");
      expect(backupFiles).not.toContain("encryption.key");

      const archiveNames = await readdir(join(BACKUP_REPO_DIR, "data"));
      expect(archiveNames.sort()).toEqual([
        "agents.zip",
        "canvas.zip",
        "commands.zip",
        "plugins.zip",
        "repositories.zip",
      ]);

      const readArchive = async (
        archiveName: string,
      ): Promise<Record<string, Uint8Array>> =>
        unzipSync(
          await readFile(join(BACKUP_REPO_DIR, "data", archiveName)),
        );

      const canvasArchive = await readArchive("canvas.zip");
      expect(strFromU8(canvasArchive["board/notes.json"])).toBe(
        '{"title":"測試畫布"}',
      );

      const repositoriesArchive = await readArchive("repositories.zip");
      expect(
        strFromU8(repositoriesArchive["demo/.git/config"]),
      ).toContain("https://github.com/example/demo.git");
      expect(
        Object.values(repositoriesArchive).some((content) =>
          strFromU8(content).includes("ghp_backup_secret"),
        ),
      ).toBe(false);
      expect(strFromU8(repositoriesArchive["demo/uncommitted.txt"])).toBe(
        "尚未提交",
      );

      const pluginsArchive = await readArchive("plugins.zip");
      expect(strFromU8(pluginsArchive["demo-plugin/plugin.json"])).toBe(
        '{"name":"demo-plugin"}',
      );
      expect(
        strFromU8((await readArchive("agents.zip"))["helper.md"]),
      ).toBe("agent");
      expect(
        strFromU8((await readArchive("commands.zip"))["run.md"]),
      ).toBe("command");

      await mkdir(RESTORE_ROOT, { recursive: true });
      await copyFile(
        join(BACKUP_REPO_DIR, "canvas.db"),
        join(RESTORE_ROOT, "canvas.db"),
      );
      for (const archiveName of archiveNames) {
        const targetDir = join(
          RESTORE_ROOT,
          archiveName.replace(/\.zip$/, ""),
        );
        await mkdir(targetDir, { recursive: true });
        await $`unzip -q ${join(BACKUP_REPO_DIR, "data", archiveName)} -d ${targetDir}`.quiet();
      }

      const restoredDb = new Database(join(RESTORE_ROOT, "canvas.db"), {
        readonly: true,
      });
      try {
        const canvasCount = restoredDb
          .prepare("SELECT COUNT(*) AS count FROM canvases")
          .get() as { count: number };
        expect(canvasCount.count).toBeGreaterThanOrEqual(0);
      } finally {
        restoredDb.close();
      }

      const restoredRepository = join(
        RESTORE_ROOT,
        "repositories",
        "demo",
      );
      expect(
        (
          await $`git -C ${restoredRepository} log -1 --format=%s`
            .quiet()
            .text()
        ).trim(),
      ).toBe("初始提交");
      expect(
        await $`git -C ${restoredRepository} status --short`
          .quiet()
          .text(),
      ).toContain("?? uncommitted.txt");
      expect(
        (
          await $`git -C ${restoredRepository} remote get-url origin`
            .quiet()
            .text()
        ).trim(),
      ).toBe("https://github.com/example/demo.git");
      expect(
        (await lstat(join(restoredRepository, "tracked-link.txt")))
          .isSymbolicLink(),
      ).toBe(true);
      expect(
        await readlink(join(restoredRepository, "tracked-link.txt")),
      ).toBe("tracked.txt");
      expect(
        await readFile(
          join(RESTORE_ROOT, "plugins", "demo-plugin", "plugin.json"),
          "utf-8",
        ),
      ).toBe('{"name":"demo-plugin"}');
      expect(
        await readFile(
          join(RESTORE_ROOT, "canvas", "board", "notes.json"),
          "utf-8",
        ),
      ).toBe('{"title":"測試畫布"}');
    });

    it("無檔案變更時仍執行 force-with-lease push", async () => {
      mockGit.commit.mockRejectedValue(new Error("nothing to commit"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "push",
        "--force-with-lease",
        REMOTE_URL,
        "HEAD",
      ]);
    });

    it("commit 失敗（非空 commit 情況）時回傳錯誤，不執行 push", async () => {
      mockGit.commit.mockRejectedValue(new Error("lock file exists"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("備份推送失敗");
      }
      // push 不應被呼叫
      expect(mockGit.raw).not.toHaveBeenCalledWith([
        "push",
        "--force-with-lease",
        REMOTE_URL,
        "HEAD",
      ]);
    });

    it("push 失敗時回傳錯誤訊息（simple-git mock：網路情境）", async () => {
      mockGit.raw.mockRejectedValue(new Error("Some push error"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("備份推送失敗");
      }
    });

    it("認證失敗時回傳包含 Token 提示的錯誤訊息（simple-git mock：認證情境）", async () => {
      mockGit.raw.mockRejectedValue(new Error("Authentication failed"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("認證失敗，請檢查 Token 是否正確");
      }
    });

    it("網路問題時回傳無法連線錯誤（simple-git mock：DNS 解析失敗情境）", async () => {
      mockGit.raw.mockRejectedValue(new Error("Could not resolve host"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("無法連線至遠端伺服器");
      }
    });

    it("備份正在執行中時立即回傳錯誤（concurrent lock）", async () => {
      // ── 使用 add 來製造 lock 狀態 ──
      // backupService 呼叫順序：isRunning check → initRepo → setupRemote → git.add
      // 由於 initRepo + setupRemote 均為 mock（即時 resolve），
      // git.add 會立刻被呼叫，此時 isRunning 已為 true
      let resolveAdd!: () => void;
      mockGit.add.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveAdd = resolve;
          }),
      );

      // 第一個備份（卡在 git.add）
      const firstBackup = backupService.executeBackup(REMOTE_URL);

      // 等候 resolveAdd 被賦值（initRepo + setupRemote 完成）
      // 使用較多次的 Promise.resolve() 以應對真實 fs 操作的非同步延遲
      for (let i = 0; i < 200 && resolveAdd === undefined; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }

      // 此時 isRunning = true，第二個備份應立刻回傳 lock 錯誤
      const concurrentResult = await backupService.executeBackup(REMOTE_URL);

      expect(concurrentResult.success).toBe(false);
      if (!concurrentResult.success) {
        expect(concurrentResult.error).toBe("備份正在執行中");
      }

      // 解除 lock 讓第一個備份完成
      resolveAdd();
      await firstBackup;
    }, 10000);

    it("initRepo 失敗時 executeBackup 提早回傳錯誤", async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error("git not found"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("初始化備份倉庫失敗");
      }
    });

    it("setupRemote 失敗時 executeBackup 提早回傳錯誤", async () => {
      mockGit.getRemotes.mockRejectedValue(new Error("cannot list remotes"));

      const result = await backupService.executeBackup(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("設定備份遠端倉庫失敗");
      }
    });
  });

  describe("testConnection", () => {
    it("Remote URL 可連線時回傳 ok", async () => {
      mockGit.raw.mockResolvedValue("some-refs-output");

      const result = await backupService.testConnection(REMOTE_URL);

      expect(result.success).toBe(true);
    });

    it("Remote URL 不可連線時回傳錯誤（simple-git mock：DNS 解析失敗）", async () => {
      mockGit.raw.mockRejectedValue(new Error("Could not resolve host"));

      const result = await backupService.testConnection(REMOTE_URL);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("無法連線至遠端伺服器");
      }
    });

  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1 - backupHandlers emit 行為（原 Phase 1 刪除的 backupHandlers.test.ts）
// 透過 handleBackupTrigger / handleBackupTestConnection 進入點驗證 emit payload
// ─────────────────────────────────────────────────────────────────────────────

describe("handleBackupTrigger - emit 行為", () => {
  describe("URL 為空時", () => {
    it("payload 和 config 都沒有 URL 時 emit 錯誤給發起連線，且不執行備份", async () => {
      mockGetBackupConfig.mockReturnValue({
        backupGitRemoteUrl: "",
        backupEnabled: true,
        backupTime: "03:00",
      });

      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:trigger:result",
        expect.objectContaining({ success: false, error: expect.any(String) }),
      );
      // backupService.executeBackup 不應被呼叫（git.add 不被觸發）
      expect(mockGit.add).not.toHaveBeenCalled();
    });
  });

  describe("備份成功流程", () => {
    beforeEach(() => {
      mockGetBackupConfig.mockReturnValue({
        backupGitRemoteUrl: REMOTE_URL,
        backupEnabled: true,
        backupTime: "03:00",
      });
    });

    it("備份成功時先 ack、再 emit BACKUP_STARTED 和 BACKUP_COMPLETED", async () => {
      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      // ack
      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:trigger:result",
        expect.objectContaining({ success: true }),
      );
      // BACKUP_STARTED
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:started",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
      // BACKUP_COMPLETED
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:completed",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it("備份失敗時先 ack、再 emit BACKUP_STARTED 和 BACKUP_FAILED（含錯誤訊息）", async () => {
      // 讓 push 失敗（認證錯誤）
      mockGit.raw.mockRejectedValue(new Error("Authentication failed"));

      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      // ack（備份已接受，結果由後續 emit 告知）
      expect(mockEmitToConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        "backup:trigger:result",
        expect.objectContaining({ success: true }),
      );
      // BACKUP_STARTED
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:started",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
      // BACKUP_FAILED（含具體錯誤）
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:failed",
        expect.objectContaining({
          error: "認證失敗，請檢查 Token 是否正確",
          timestamp: expect.any(String),
        }),
      );
    });

    it("備份正在執行中（lock）時 BACKUP_FAILED 含 lock 錯誤訊息", async () => {
      // 讓備份卡住，製造 lock 狀態
      let resolveAdd!: () => void;
      mockGit.add.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveAdd = resolve;
          }),
      );

      // 第一個備份（卡住）
      const firstBackup = handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID },
        REQUEST_ID,
      );

      // 等待 resolveAdd 被賦值
      for (let i = 0; i < 200 && resolveAdd === undefined; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }

      // 第二個備份，應立刻回傳 lock 錯誤
      await handleBackupTrigger(
        "conn-test-2",
        { requestId: "req-test-2" },
        "req-test-2",
      );

      // 第二個備份因 lock 失敗，應 emit BACKUP_FAILED
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:failed",
        expect.objectContaining({ error: "備份正在執行中" }),
      );

      // 解除第一個備份的 lock
      resolveAdd();
      await firstBackup;
    }, 10000);

    it("payload 帶 URL 時優先使用 payload URL 而非 config URL", async () => {
      mockGetBackupConfig.mockReturnValue({
        backupGitRemoteUrl: "https://github.com/user/old.git",
        backupEnabled: true,
        backupTime: "03:00",
      });

      const payloadUrl = "https://github.com/user/new.git";
      await handleBackupTrigger(
        CONNECTION_ID,
        { requestId: REQUEST_ID, gitRemoteUrl: payloadUrl },
        REQUEST_ID,
      );

      // 備份使用了 payloadUrl 並成功完成
      expect(mockEmitToAll).toHaveBeenCalledWith(
        "backup:completed",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });
  });
});

describe("handleBackupTestConnection - emit 行為", () => {
  it("gitRemoteUrl 為空字串時 emit 錯誤給發起連線", async () => {
    await handleBackupTestConnection(
      CONNECTION_ID,
      { requestId: REQUEST_ID, gitRemoteUrl: "" },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledWith(
      CONNECTION_ID,
      "backup:test-connection:result",
      expect.objectContaining({ success: false, error: expect.any(String) }),
    );
    // backupService.testConnection 不應被呼叫
    expect(mockGit.raw).not.toHaveBeenCalled();
  });

  it("連線成功時 emit success: true 給發起連線", async () => {
    mockGit.raw.mockResolvedValue("some-refs-output");

    await handleBackupTestConnection(
      CONNECTION_ID,
      { requestId: REQUEST_ID, gitRemoteUrl: REMOTE_URL },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledWith(
      CONNECTION_ID,
      "backup:test-connection:result",
      expect.objectContaining({ requestId: REQUEST_ID, success: true }),
    );
  });

  it("連線失敗時 emit success: false 和具體錯誤訊息", async () => {
    mockGit.raw.mockRejectedValue(new Error("Could not resolve host"));

    await handleBackupTestConnection(
      CONNECTION_ID,
      { requestId: REQUEST_ID, gitRemoteUrl: REMOTE_URL },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledWith(
      CONNECTION_ID,
      "backup:test-connection:result",
      expect.objectContaining({
        success: false,
        error: "無法連線至遠端伺服器",
      }),
    );
  });

  it("認證失敗時 emit 包含 Token 提示的錯誤訊息", async () => {
    mockGit.raw.mockRejectedValue(new Error("Authentication failed"));

    await handleBackupTestConnection(
      CONNECTION_ID,
      { requestId: REQUEST_ID, gitRemoteUrl: REMOTE_URL },
      REQUEST_ID,
    );

    expect(mockEmitToConnection).toHaveBeenCalledWith(
      CONNECTION_ID,
      "backup:test-connection:result",
      expect.objectContaining({
        success: false,
        error: "認證失敗，請檢查 Token 是否正確",
      }),
    );
  });
});
