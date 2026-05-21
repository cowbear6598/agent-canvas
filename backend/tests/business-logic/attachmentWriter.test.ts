/**
 * attachmentWriter 單元測試
 *
 * 覆蓋以下測試案例：
 * - writeAttachmentToStaging：filename sanitize、collision rename、大小限制、寫入失敗清除
 * - promoteStagingToFinal：staging 不存在拋錯、atomic rename、正式目錄正確落地
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

vi.mock("../../src/config/index.js", () => ({
  config: {
    // tmpRoot / stagingRoot 由 beforeEach 動態替換
    tmpRoot: "/mock-tmp-root",
    stagingRoot: "/mock-staging-root",
  },
}));

// 動態 import（在 mock 設定後才 import 確保 mock 生效）
const { writeAttachmentToStaging, promoteStagingToFinal } =
  await import("../../src/services/attachmentWriter.js");
const { config } = await import("../../src/config/index.js");

/** 單檔最大允許 bytes（10 MB） */
const MAX_SINGLE_BYTES = 10 * 1024 * 1024;

/** 合法的 uploadSessionId UUID v4 */
const VALID_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
/** 合法的 chatMessageId UUID */
const VALID_CHAT_MSG_ID = "660e8400-e29b-41d4-a716-446655440001";

/** 建立一個 sandbox tmp 目錄，並在測試後清除 */
let sandboxDir: string;
let stagingDir: string;

beforeEach(async () => {
  vi.clearAllMocks();

  // 建立 sandbox 暫存目錄
  sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "attach-writer-test-"));
  stagingDir = path.join(sandboxDir, "staging");
  await fs.mkdir(stagingDir, { recursive: true });

  // 讓 config 指向 sandbox
  (config as { tmpRoot: string; stagingRoot: string }).tmpRoot = sandboxDir;
  (config as { tmpRoot: string; stagingRoot: string }).stagingRoot = stagingDir;
});

afterEach(async () => {
  await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => void 0);
  vi.restoreAllMocks();
});

// ================================================================
// writeAttachmentToStaging — filename sanitize
// ================================================================
describe("writeAttachmentToStaging — filename sanitize", () => {
  it("合法 filename 應正確落地到 staging 目錄", async () => {
    const file = new File(["hello"], "document.pdf", {
      type: "application/pdf",
    });
    const result = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file,
      "document.pdf",
    );

    expect(result.filename).toBe("document.pdf");
    const stat = await fs.stat(
      path.join(stagingDir, VALID_SESSION_ID, "document.pdf"),
    );
    expect(stat.isFile()).toBe(true);
  });

  it("filename 含路徑分隔符（../etc/passwd）應透過 basename 轉為 passwd", async () => {
    const file = new File(["content"], "../etc/passwd");
    const result = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file,
      "../etc/passwd",
    );

    expect(result.filename).toBe("passwd");
  });

  it("filename 為純空白應拋 AttachmentInvalidNameError", async () => {
    const { AttachmentInvalidNameError } =
      await import("../../src/services/attachmentErrors.js");

    const file = new File(["x"], "   ");
    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, "   "),
    ).rejects.toBeInstanceOf(AttachmentInvalidNameError);
  });

  it("filename 為 '..' 應拋 AttachmentInvalidNameError", async () => {
    const { AttachmentInvalidNameError } =
      await import("../../src/services/attachmentErrors.js");

    const file = new File(["x"], "..");
    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, ".."),
    ).rejects.toBeInstanceOf(AttachmentInvalidNameError);
  });
});

// ================================================================
// writeAttachmentToStaging — collision rename
// ================================================================
describe("writeAttachmentToStaging — collision rename", () => {
  it("同 session 連續上傳兩個同名檔案，第二個應被 rename 為 base-1.ext", async () => {
    const file1 = new File(["first"], "report.md");
    const file2 = new File(["second"], "report.md");

    const r1 = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file1,
      "report.md",
    );
    const r2 = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file2,
      "report.md",
    );

    expect(r1.filename).toBe("report.md");
    expect(r2.filename).toBe("report-1.md");
  });

  it("dot-file 同名時以 .gitignore-1 命名，不拆副檔名", async () => {
    const file1 = new File(["x"], ".gitignore");
    const file2 = new File(["y"], ".gitignore");

    const r1 = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file1,
      ".gitignore",
    );
    const r2 = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file2,
      ".gitignore",
    );

    expect(r1.filename).toBe(".gitignore");
    expect(r2.filename).toBe(".gitignore-1");
  });
});

// ================================================================
// writeAttachmentToStaging — 大小限制
// ================================================================
describe("writeAttachmentToStaging — 大小限制", () => {
  it("單檔超過 10 MB 應拋 AttachmentTooLargeError", async () => {
    const { AttachmentTooLargeError } =
      await import("../../src/services/attachmentErrors.js");

    const bigContent = new Uint8Array(MAX_SINGLE_BYTES + 1);
    const file = new File([bigContent], "big.bin");

    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, "big.bin"),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });

  it("剛好等於 10 MB 的單檔不應拋錯", async () => {
    const exactContent = new Uint8Array(MAX_SINGLE_BYTES);
    const file = new File([exactContent], "exact.bin");

    const result = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file,
      "exact.bin",
    );

    expect(result.filename).toBe("exact.bin");
    expect(result.size).toBe(MAX_SINGLE_BYTES);
  });
});

// ================================================================
// promoteStagingToFinal — staging 不存在拋 UploadSessionNotFoundError
// ================================================================
describe("promoteStagingToFinal — staging 不存在", () => {
  it("staging 目錄不存在時應拋 UploadSessionNotFoundError", async () => {
    const { UploadSessionNotFoundError } =
      await import("../../src/services/attachmentErrors.js");

    // 沒有事先建立 staging 子目錄
    await expect(
      promoteStagingToFinal(VALID_SESSION_ID, VALID_CHAT_MSG_ID),
    ).rejects.toBeInstanceOf(UploadSessionNotFoundError);
  });
});

// ================================================================
// promoteStagingToFinal — atomic rename staging → 正式目錄
// ================================================================
describe("promoteStagingToFinal — atomic rename", () => {
  it("staging 存在時應成功 rename 為正式目錄並回傳 dir + files", async () => {
    // 預先建立 staging session 目錄並放入檔案
    const sessionDir = path.join(stagingDir, VALID_SESSION_ID);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "report.pdf"), "pdf content");
    await fs.writeFile(path.join(sessionDir, "data.csv"), "csv content");

    const result = await promoteStagingToFinal(
      VALID_SESSION_ID,
      VALID_CHAT_MSG_ID,
    );

    // 正式目錄應存在
    const finalDir = path.join(sandboxDir, VALID_CHAT_MSG_ID);
    const stat = await fs.stat(finalDir);
    expect(stat.isDirectory()).toBe(true);

    // staging 目錄應消失
    await expect(fs.stat(sessionDir)).rejects.toThrow();

    // 回傳值正確
    expect(result.dir).toBe(finalDir);
    expect(result.files.sort()).toEqual(["data.csv", "report.pdf"]);
  });

  it("promote 後正式目錄中的檔案內容正確", async () => {
    const sessionDir = path.join(stagingDir, VALID_SESSION_ID);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "note.txt"), "hello world");

    const result = await promoteStagingToFinal(
      VALID_SESSION_ID,
      VALID_CHAT_MSG_ID,
    );

    const content = await fs.readFile(
      path.join(result.dir, "note.txt"),
      "utf-8",
    );
    expect(content).toBe("hello world");
  });
});
