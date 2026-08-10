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
import { strToU8, zipSync } from "fflate";
import { MAX_SINGLE_BYTES } from "../../src/services/uploadConstants.js";

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

/** 合法的 uploadSessionId UUID v4 */
const VALID_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

/** 模擬部分 macOS ZIP：檔名 bytes 是 UTF-8，但 general-purpose flag 未標示 UTF-8。 */
function clearZipUtf8Flags(archive: Uint8Array): void {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  let offset = 0;

  while (offset <= archive.byteLength - 4) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) {
      view.setUint16(
        offset + 6,
        view.getUint16(offset + 6, true) & ~0x0800,
        true,
      );
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);
      offset += 30 + fileNameLength + extraFieldLength + compressedSize;
      continue;
    }
    if (signature === 0x02014b50) {
      view.setUint16(
        offset + 8,
        view.getUint16(offset + 8, true) & ~0x0800,
        true,
      );
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraFieldLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      offset += 46 + fileNameLength + extraFieldLength + commentLength;
      continue;
    }
    break;
  }
}
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
// writeAttachmentToStaging — ZIP 自動解壓縮
// ================================================================
describe("writeAttachmentToStaging — ZIP 自動解壓縮", () => {
  it("ZIP 應解壓到同名資料夾並保留內部目錄結構", async () => {
    const archive = zipSync({
      "README.md": strToU8("hello"),
      "src/index.ts": strToU8("export const value = 1;"),
    });
    const file = new File([archive], "project.zip", {
      type: "application/zip",
    });

    const result = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file,
      file.name,
    );

    expect(result.filename).toBe("project");
    const extractionRoot = path.join(
      stagingDir,
      VALID_SESSION_ID,
      "project",
    );
    expect(await fs.readFile(path.join(extractionRoot, "README.md"), "utf8")).toBe(
      "hello",
    );
    expect(
      await fs.readFile(path.join(extractionRoot, "src/index.ts"), "utf8"),
    ).toBe("export const value = 1;");
    await expect(
      fs.access(path.join(stagingDir, VALID_SESSION_ID, "project.zip")),
    ).rejects.toThrow();
  });

  it("同名 ZIP 應解壓到不重複的資料夾", async () => {
    const archive = zipSync({ "file.txt": strToU8("content") });
    const first = new File([archive], "bundle.zip");
    const second = new File([archive], "bundle.zip");

    const firstResult = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      first,
      first.name,
    );
    const secondResult = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      second,
      second.name,
    );

    expect(firstResult.filename).toBe("bundle");
    expect(secondResult.filename).toBe("bundle-1");
  });

  it("副檔名大小寫不影響 ZIP 辨識", async () => {
    const archive = zipSync({ "file.txt": strToU8("content") });
    const file = new File([archive], "DATA.ZIP");

    const result = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file,
      file.name,
    );

    expect(result.filename).toBe("DATA");
  });

  it("未設定 UTF-8 flag 的 macOS ZIP 仍應保留中文檔名", async () => {
    const archive = zipSync({ "背水一戰/腳本.md": strToU8("內容") });
    clearZipUtf8Flags(archive);

    const file = new File([archive], "macos.zip");
    const result = await writeAttachmentToStaging(
      VALID_SESSION_ID,
      file,
      file.name,
    );

    expect(result.filename).toBe("macos");
    expect(
      await fs.readFile(
        path.join(
          stagingDir,
          VALID_SESSION_ID,
          "macos/背水一戰/腳本.md",
        ),
        "utf8",
      ),
    ).toBe("內容");
  });

  it("損毀的 ZIP 應拒絕並清除解壓目錄", async () => {
    const { AttachmentInvalidArchiveError } =
      await import("../../src/services/attachmentErrors.js");
    const file = new File(["not a zip"], "broken.zip");

    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, file.name),
    ).rejects.toBeInstanceOf(AttachmentInvalidArchiveError);
    await expect(
      fs.access(path.join(stagingDir, VALID_SESSION_ID, "broken")),
    ).rejects.toThrow();
  });

  it("ZIP 內含路徑穿越時應拒絕且不可寫出 staging", async () => {
    const { AttachmentInvalidArchiveError } =
      await import("../../src/services/attachmentErrors.js");
    const archive = zipSync({ "../outside.txt": strToU8("unsafe") });
    const file = new File([archive], "unsafe.zip");

    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, file.name),
    ).rejects.toBeInstanceOf(AttachmentInvalidArchiveError);
    await expect(fs.access(path.join(stagingDir, "outside.txt"))).rejects.toThrow();
  });

  it("ZIP 宣告的解壓後總大小超過 100 MB 時應拒絕", async () => {
    const { AttachmentArchiveTooLargeError } =
      await import("../../src/services/attachmentErrors.js");
    const archive = zipSync({ "large.bin": strToU8("small") });
    const view = new DataView(
      archive.buffer,
      archive.byteOffset,
      archive.byteLength,
    );
    for (let offset = 0; offset <= archive.byteLength - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, MAX_SINGLE_BYTES + 1, true);
        break;
      }
    }
    const file = new File([archive], "large.zip");

    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, file.name),
    ).rejects.toBeInstanceOf(AttachmentArchiveTooLargeError);
  });
});

// ================================================================
// writeAttachmentToStaging — 大小限制
// ================================================================
describe("writeAttachmentToStaging — 大小限制", () => {
  it("單檔超過 100 MB 應拋 AttachmentTooLargeError", async () => {
    const { AttachmentTooLargeError } =
      await import("../../src/services/attachmentErrors.js");

    const file = new File([], "big.bin");
    Object.defineProperty(file, "size", { value: MAX_SINGLE_BYTES + 1 });

    await expect(
      writeAttachmentToStaging(VALID_SESSION_ID, file, "big.bin"),
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });

  it("上傳限制常數應為 100 MB", async () => {
    expect(MAX_SINGLE_BYTES).toBe(100 * 1024 * 1024);
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
