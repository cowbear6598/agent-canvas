import { vi, describe, it, expect, beforeEach } from "vitest";

// mock simple-git 模組
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

// mock buildAuthenticatedUrl，讓 authUrl = remoteUrl（簡化測試）
vi.mock("../../src/services/workspace/gitService.js", () => ({
  buildAuthenticatedUrl: vi.fn((url: string) => url),
}));

// mock config
vi.mock("../../src/config/index.js", () => ({
  config: {
    appDataRoot: "/mock/data",
  },
}));

// mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

// mock fs 以避免真實檔案操作（ensureGitignore 所需）
vi.mock("fs", () => ({
  promises: {
    readFile: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      ),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// 在 mock 設置後才 import backupService
const { backupService } = await import("../../src/services/backupService.js");

describe("BackupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initRepo", () => {
    it("目標目錄不存在 .git 時自動執行 git init", async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);
      mockGit.init.mockResolvedValue(undefined);
      mockGit.addConfig.mockResolvedValue(undefined);

      const result = await backupService.initRepo();

      expect(result.success).toBe(true);
      expect(mockGit.init).toHaveBeenCalled();
      expect(mockGit.addConfig).toHaveBeenCalledWith(
        "user.name",
        "ClaudeCanvas Backup",
      );
      expect(mockGit.addConfig).toHaveBeenCalledWith(
        "user.email",
        "backup@claudecanvas.local",
      );
    });

    it("目標目錄已有 .git 時不重複初始化", async () => {
      mockGit.checkIsRepo.mockResolvedValue(true);

      const result = await backupService.initRepo();

      expect(result.success).toBe(true);
      expect(mockGit.init).not.toHaveBeenCalled();
    });
  });

  describe("setupRemote", () => {
    beforeEach(() => {
      mockGit.checkIsRepo.mockResolvedValue(true);
    });

    it("尚無 remote 時執行 git remote add", async () => {
      const remoteUrl = "https://github.com/user/backup.git";
      mockGit.getRemotes.mockResolvedValue([]);
      mockGit.addRemote.mockResolvedValue(undefined);

      const result = await backupService.setupRemote(remoteUrl);

      expect(result.success).toBe(true);
      expect(mockGit.addRemote).toHaveBeenCalledWith("origin", remoteUrl);
    });

    it("已有 remote 但 URL 不同時執行 git remote set-url", async () => {
      const remoteUrl = "https://github.com/user/backup.git";
      mockGit.getRemotes.mockResolvedValue([
        {
          name: "origin",
          refs: {
            fetch: "https://github.com/user/old-backup.git",
            push: "https://github.com/user/old-backup.git",
          },
        },
      ]);
      mockGit.raw.mockResolvedValue(undefined);

      const result = await backupService.setupRemote(remoteUrl);

      expect(result.success).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "remote",
        "set-url",
        "origin",
        remoteUrl,
      ]);
    });

    it("已有 remote 且 URL 相同時不執行任何操作", async () => {
      const remoteUrl = "https://github.com/user/backup.git";
      mockGit.getRemotes.mockResolvedValue([
        {
          name: "origin",
          refs: {
            fetch: remoteUrl,
            push: remoteUrl,
          },
        },
      ]);

      const result = await backupService.setupRemote(remoteUrl);

      expect(result.success).toBe(true);
      expect(mockGit.addRemote).not.toHaveBeenCalled();
      expect(mockGit.raw).not.toHaveBeenCalled();
    });
  });

  describe("executeBackup", () => {
    const remoteUrl = "https://github.com/user/backup.git";

    beforeEach(() => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: "origin",
          refs: { fetch: remoteUrl, push: remoteUrl },
        },
      ]);
    });

    it("正常流程成功回傳 ok", async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockResolvedValue(undefined);
      mockGit.raw.mockResolvedValue(undefined);

      const result = await backupService.executeBackup(remoteUrl);

      expect(result.success).toBe(true);
      expect(mockGit.add).toHaveBeenCalledWith("-A");
      expect(mockGit.commit).toHaveBeenCalled();
      expect(mockGit.raw).toHaveBeenCalledWith([
        "push",
        "--force",
        "origin",
        "HEAD",
      ]);
    });

    it("無檔案變更時仍執行 force push", async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockRejectedValue(new Error("nothing to commit"));
      mockGit.raw.mockResolvedValue(undefined);

      const result = await backupService.executeBackup(remoteUrl);

      expect(result.success).toBe(true);
      expect(mockGit.raw).toHaveBeenCalledWith([
        "push",
        "--force",
        "origin",
        "HEAD",
      ]);
    });

    it("push 失敗時回傳錯誤訊息", async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockResolvedValue(undefined);
      mockGit.raw.mockRejectedValue(new Error("Some push error"));

      const result = await backupService.executeBackup(remoteUrl);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("備份推送失敗");
      }
    });

    it("認證失敗時回傳包含 Token 提示的錯誤訊息", async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockResolvedValue(undefined);
      mockGit.raw.mockRejectedValue(new Error("Authentication failed"));

      const result = await backupService.executeBackup(remoteUrl);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("認證失敗，請檢查 Token 是否正確");
      }
    });

    it("網路問題時回傳無法連線錯誤", async () => {
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockResolvedValue(undefined);
      mockGit.raw.mockRejectedValue(new Error("Could not resolve host"));

      const result = await backupService.executeBackup(remoteUrl);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("無法連線至遠端伺服器");
      }
    });

    it("備份正在執行中時立即回傳錯誤", async () => {
      let resolveAdd: (() => void) | undefined;
      mockGit.add.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveAdd = resolve;
          }),
      );
      mockGit.commit.mockResolvedValue(undefined);
      mockGit.raw.mockResolvedValue(undefined);

      const firstBackup = backupService.executeBackup(remoteUrl);
      // 第一個備份尚未完成，同時發起第二個（isRunning 已被設為 true）
      const concurrentResult = await backupService.executeBackup(remoteUrl);

      expect(concurrentResult.success).toBe(false);
      if (!concurrentResult.success) {
        expect(concurrentResult.error).toBe("備份正在執行中");
      }

      // 等待 resolveAdd 被設定（initRepo + ensureGitignore 完成後 git.add 才被呼叫）
      const maxWait = 100;
      for (let i = 0; i < maxWait && resolveAdd === undefined; i++) {
        await Promise.resolve();
      }

      // 解除 lock 讓第一個備份完成，避免 mock 洩漏
      resolveAdd?.();
      await firstBackup;
    });
  });

  describe("testConnection", () => {
    const remoteUrl = "https://github.com/user/backup.git";

    beforeEach(() => {
      mockGit.checkIsRepo.mockResolvedValue(true);
      mockGit.getRemotes.mockResolvedValue([
        {
          name: "origin",
          refs: { fetch: remoteUrl, push: remoteUrl },
        },
      ]);
    });

    it("Remote URL 可連線時回傳 ok", async () => {
      mockGit.raw.mockResolvedValue("some-refs-output");

      const result = await backupService.testConnection(remoteUrl);

      expect(result.success).toBe(true);
    });

    it("Remote URL 不可連線時回傳錯誤", async () => {
      mockGit.raw.mockRejectedValue(new Error("Could not resolve host"));

      const result = await backupService.testConnection(remoteUrl);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("無法連線至遠端伺服器");
      }
    });
  });
});
