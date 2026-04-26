import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { podManifestService } from "../../src/services/podManifestService.js";
import { isPathWithinDirectory } from "../../src/utils/pathValidator.js";
import { initTestDb, resetDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";

describe("PodManifestService", () => {
  let tmpDir: string;
  const podId = "test-pod-id";
  const repositoryId = "test-repo-id";

  beforeAll(() => {
    initTestDb();
  });

  beforeEach(async () => {
    resetDb();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pod-manifest-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    resetStatements();
  });

  describe("readManifest", () => {
    it("資料不存在時回傳空陣列", () => {
      const result = podManifestService.readManifest(repositoryId, podId);
      expect(result).toEqual([]);
    });

    it("資料存在時回傳正確的 managedFiles", () => {
      const managedFiles = [
        ".claude/commands/test.md",
        ".claude/agents/agent.md",
      ];
      podManifestService.writeManifest(repositoryId, podId, managedFiles);

      const result = podManifestService.readManifest(repositoryId, podId);
      expect(result).toEqual(managedFiles);
    });
  });

  describe("writeManifest", () => {
    it("正確寫入 managedFiles 到 DB", () => {
      const managedFiles = [".claude/commands/test.md"];
      podManifestService.writeManifest(repositoryId, podId, managedFiles);

      const result = podManifestService.readManifest(repositoryId, podId);
      expect(result).toEqual(managedFiles);
    });

    it("重複寫入時覆蓋舊資料", () => {
      podManifestService.writeManifest(repositoryId, podId, [
        ".claude/commands/old.md",
      ]);
      podManifestService.writeManifest(repositoryId, podId, [
        ".claude/commands/new.md",
      ]);

      const result = podManifestService.readManifest(repositoryId, podId);
      expect(result).toEqual([".claude/commands/new.md"]);
    });
  });

  describe("deleteManifestRecord", () => {
    it("從 DB 刪除 manifest 記錄", () => {
      podManifestService.writeManifest(repositoryId, podId, [
        ".claude/commands/test.md",
      ]);
      podManifestService.deleteManifestRecord(repositoryId, podId);

      const result = podManifestService.readManifest(repositoryId, podId);
      expect(result).toEqual([]);
    });

    it("記錄不存在時不報錯", () => {
      expect(() =>
        podManifestService.deleteManifestRecord(repositoryId, podId),
      ).not.toThrow();
    });
  });

  describe("collectCommandFiles", () => {
    it("回傳正確的 command 檔案路徑格式", () => {
      const result = podManifestService.collectCommandFiles("my-command");
      expect(result).toEqual([".claude/commands/my-command.md"]);
    });
  });
});

describe("isPathWithinDirectory — 邊界案例", () => {
  it("absPath 恰好等於 repositoryPath 時回傳 true", () => {
    const dir = "/tmp/repo";
    expect(isPathWithinDirectory(dir, dir)).toBe(true);
  });

  it("absPath 在 repositoryPath 子目錄下回傳 true", () => {
    expect(isPathWithinDirectory("/tmp/repo/sub/file.md", "/tmp/repo")).toBe(
      true,
    );
  });

  it("absPath 包含 .. 但解析後仍在範圍內時回傳 true", () => {
    // /tmp/repo/sub/../file.md 解析後為 /tmp/repo/file.md
    expect(isPathWithinDirectory("/tmp/repo/sub/../file.md", "/tmp/repo")).toBe(
      true,
    );
  });

  it("absPath 包含 .. 且解析後逸出範圍時回傳 false", () => {
    // /tmp/repo/../other/file.md 解析後為 /tmp/other/file.md
    expect(
      isPathWithinDirectory("/tmp/repo/../other/file.md", "/tmp/repo"),
    ).toBe(false);
  });

  it("目錄名稱為另一目錄前綴時不誤判（prefix attack）", () => {
    // /tmp/repo-evil 不在 /tmp/repo 內，但字串前綴相符
    expect(isPathWithinDirectory("/tmp/repo-evil/file.md", "/tmp/repo")).toBe(
      false,
    );
  });
});
