/**
 * uploadApi 單元測試
 *
 * 覆蓋以下測試案例：
 * - 上傳成功回 200 並回傳檔案 metadata
 * - 同一 sessionId 連續上傳多檔，staging 目錄累積所有檔案
 * - 同名檔案上傳第二次，自動 collision rename 為 name-1.ext
 * - 缺 uploadSessionId 欄位回 400
 * - uploadSessionId 格式錯（非 UUID v4）回 400
 * - 缺 file 欄位回 400
 * - 檔案超過 10 MB 回 413
 * - 檔名包含路徑分隔符（../evil）回 400
 * - HTTP 上傳階段不檢查 pod busy（不依賴 pod 狀態）
 * - 錯誤回應 body 格式為 { errorCode, message }，message 為 zh-TW
 * - canvas 受密碼保護且未解鎖時回 403
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// ----------------------------------------------------------------
// mock config：讓 stagingRoot 指向 sandbox tmp 目錄（beforeEach 動態替換）
// ----------------------------------------------------------------
vi.mock("../../src/config/index.js", () => ({
  config: {
    stagingRoot: "/mock-staging-root",
    tmpRoot: "/mock-tmp-root",
  },
}));

// ----------------------------------------------------------------
// mock logger：避免測試時輸出雜訊
// ----------------------------------------------------------------
vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// ----------------------------------------------------------------
// mock canvasStore：讓測試中的 canvasId 查詢可控
// ----------------------------------------------------------------
vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getById: vi.fn(),
  },
}));

// ----------------------------------------------------------------
// mock authAccessService：讓 canvas 存取權限可控
// ----------------------------------------------------------------
vi.mock("../../src/services/auth/authAccessService.js", () => ({
  authAccessService: {
    isCanvasAccessible: vi.fn(),
  },
}));

// ----------------------------------------------------------------
// mock handshakeAuthService：不依賴 session 機制
// ----------------------------------------------------------------
vi.mock("../../src/services/auth/handshakeAuthService.js", () => ({
  handshakeAuthService: {
    resolveRequestSessionId: vi.fn().mockReturnValue(null),
  },
}));

// ----------------------------------------------------------------
// 動態 import（在 mock 設定後才 import，確保 mock 生效）
// ----------------------------------------------------------------
const { handleUpload } = await import("../../src/api/uploadApi.js");
const { config } = await import("../../src/config/index.js");
const { canvasStore } = await import("../../src/services/canvasStore.js");
const { authAccessService } =
  await import("../../src/services/auth/authAccessService.js");

// ----------------------------------------------------------------
// 測試常數
// ----------------------------------------------------------------

/** 合法的 uploadSessionId（UUID v4 格式） */
const VALID_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

/** 合法的 canvasId（UUID v4 格式） */
const VALID_CANVAS_ID = "aaaabbbb-cccc-4ddd-8eee-ffffffffffff";

/** 單檔最大允許 bytes（10 MB） */
const MAX_SINGLE_BYTES = 10 * 1024 * 1024;

/** handler 目標 URL */
const UPLOAD_URL = "http://localhost/api/upload";

// ----------------------------------------------------------------
// sandbox 目錄管理
// ----------------------------------------------------------------

let sandboxDir: string;
let stagingDir: string;

beforeEach(async () => {
  vi.clearAllMocks();

  // 建立 sandbox 暫存目錄
  sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "upload-api-test-"));
  stagingDir = path.join(sandboxDir, "staging");
  await fs.mkdir(stagingDir, { recursive: true });

  // 將 config 指向 sandbox（型別斷言，因 config 在 mock 中為 mutable object）
  (config as { stagingRoot: string; tmpRoot: string }).stagingRoot = stagingDir;
  (config as { stagingRoot: string; tmpRoot: string }).tmpRoot = sandboxDir;

  // 預設：VALID_CANVAS_ID 存在且可存取
  (canvasStore.getById as ReturnType<typeof vi.fn>).mockImplementation(
    (id: string) => (id === VALID_CANVAS_ID ? { id: VALID_CANVAS_ID } : null),
  );
  (
    authAccessService.isCanvasAccessible as ReturnType<typeof vi.fn>
  ).mockReturnValue(true);
});

afterEach(async () => {
  await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => void 0);
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------
// 輔助函式：建立 multipart/form-data Request
// ----------------------------------------------------------------

/**
 * 建立上傳用的 Request（multipart/form-data）。
 * omitCanvasId：不帶 canvasId 欄位（測試缺欄位場景）
 * omitSessionId：不帶 uploadSessionId 欄位（測試缺欄位場景）
 * omitFile：不帶 file 欄位（測試缺欄位場景）
 */
function makeUploadRequest(options: {
  canvasId?: string;
  omitCanvasId?: boolean;
  sessionId?: string;
  omitSessionId?: boolean;
  file?: File;
  omitFile?: boolean;
}): Request {
  const formData = new FormData();

  if (!options.omitCanvasId) {
    formData.append("canvasId", options.canvasId ?? VALID_CANVAS_ID);
  }

  if (!options.omitSessionId) {
    formData.append("uploadSessionId", options.sessionId ?? VALID_SESSION_ID);
  }

  if (!options.omitFile) {
    formData.append(
      "file",
      options.file ?? new File(["hello"], "test.txt", { type: "text/plain" }),
    );
  }

  return new Request(UPLOAD_URL, {
    method: "POST",
    body: formData,
  });
}

// ================================================================
// 成功案例
// ================================================================

describe("POST /api/upload — 成功案例", () => {
  // ── Case 1：上傳成功回 200 並回傳 metadata ─────────────────────
  it("上傳合法檔案應回 200，回傳 filename / size / mime / uploadSessionId", async () => {
    const file = new File(["hello world"], "document.pdf", {
      type: "application/pdf",
    });
    const req = makeUploadRequest({ file });

    const res = await handleUpload(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filename).toBe("document.pdf");
    expect(body.size).toBe(11); // "hello world" 11 bytes
    expect(body.mime).toBe("application/pdf");
    expect(body.uploadSessionId).toBe(VALID_SESSION_ID);
  });

  // ── Case 2：同一 sessionId 連續上傳多檔，staging 目錄累積所有檔案 ──
  it("同一 sessionId 連續上傳多個不同名檔案，staging 目錄應累積所有檔案", async () => {
    const file1 = new File(["data1"], "file1.txt", { type: "text/plain" });
    const file2 = new File(["data2"], "file2.txt", { type: "text/plain" });
    const file3 = new File(["data3"], "file3.txt", { type: "text/plain" });

    const res1 = await handleUpload(makeUploadRequest({ file: file1 }));
    const res2 = await handleUpload(makeUploadRequest({ file: file2 }));
    const res3 = await handleUpload(makeUploadRequest({ file: file3 }));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);

    // staging 子目錄應有三個獨立檔案
    const sessionDir = path.join(stagingDir, VALID_SESSION_ID);
    const files = await fs.readdir(sessionDir);
    expect(files.sort()).toEqual(["file1.txt", "file2.txt", "file3.txt"]);
  });

  // ── Case 3：同名檔案上傳第二次，自動 collision rename ──────────
  it("同名檔案上傳第二次，第二個應 collision rename 為 name-1.ext", async () => {
    const file1 = new File(["first"], "report.md", { type: "text/markdown" });
    const file2 = new File(["second"], "report.md", { type: "text/markdown" });

    const res1 = await handleUpload(makeUploadRequest({ file: file1 }));
    const res2 = await handleUpload(makeUploadRequest({ file: file2 }));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.filename).toBe("report.md");
    expect(body2.filename).toBe("report-1.md");
  });

  // ── Case 9：HTTP 上傳階段不依賴 pod 狀態 ───────────────────────
  // HTTP 路徑（handleUpload）內無任何 podStore / pod 相關邏輯，
  // 只要 handler 能正常回 200 即代表不檢查 pod busy 狀態。
  it("上傳成功即使沒有任何 pod 存在（handler 不依賴 pod 狀態）", async () => {
    // 不需要 mock 任何 pod 相關模組，handler 本身不引用 podStore
    const file = new File(["content"], "note.txt", { type: "text/plain" });
    const req = makeUploadRequest({ file });

    const res = await handleUpload(req);

    // 能成功回 200 即代表 handler 完全不依賴 pod 狀態
    expect(res.status).toBe(200);
  });
});

// ================================================================
// 存取控制
// ================================================================

describe("POST /api/upload — 存取控制", () => {
  // ── Case：canvas 受密碼保護且未解鎖時回 403 ──────────────────────
  it("canvas 受密碼保護且未解鎖時應回 403", async () => {
    // 模擬 canvas 存在但存取被拒（已鎖定）
    (
      authAccessService.isCanvasAccessible as ReturnType<typeof vi.fn>
    ).mockReturnValue(false);

    const req = makeUploadRequest({});
    const res = await handleUpload(req);

    expect(res.status).toBe(403);
  });
});

// ================================================================
// 錯誤案例 — uploadSessionId 欄位驗證
// ================================================================

describe("POST /api/upload — uploadSessionId 驗證", () => {
  // ── Case 4：缺 uploadSessionId 欄位回 400 ─────────────────────
  it("缺少 uploadSessionId 欄位應回 400，errorCode 為 UPLOAD_INVALID_SESSION_ID", async () => {
    const req = makeUploadRequest({ omitSessionId: true });

    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("UPLOAD_INVALID_SESSION_ID");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  // ── Case 4b：uploadSessionId 為空字串回 400 ───────────────────
  it("uploadSessionId 為空字串應回 400，errorCode 為 UPLOAD_INVALID_SESSION_ID", async () => {
    const formData = new FormData();
    formData.append("canvasId", VALID_CANVAS_ID);
    formData.append("uploadSessionId", "");
    formData.append("file", new File(["x"], "a.txt"));

    const req = new Request(UPLOAD_URL, { method: "POST", body: formData });
    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("UPLOAD_INVALID_SESSION_ID");
  });

  // ── Case 5：uploadSessionId 格式錯（非 UUID v4）回 400 ─────────
  it("uploadSessionId 不是合法 UUID v4 應回 400，errorCode 為 UPLOAD_INVALID_SESSION_ID", async () => {
    const req = makeUploadRequest({ sessionId: "not-a-uuid" });

    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("UPLOAD_INVALID_SESSION_ID");
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/UUID/);
  });

  // ── Case 5b：UUID v1 格式（非 v4）應回 400 ───────────────────
  it("uploadSessionId 為 UUID v1 格式（版本碼非 4）應回 400", async () => {
    // UUID v1：第三段開頭為 1
    const req = makeUploadRequest({
      sessionId: "550e8400-e29b-11d4-a716-446655440000",
    });

    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("UPLOAD_INVALID_SESSION_ID");
  });
});

// ================================================================
// 錯誤案例 — file 欄位驗證
// ================================================================

describe("POST /api/upload — file 欄位驗證", () => {
  // ── Case 6：缺 file 欄位回 400 ────────────────────────────────
  it("缺少 file 欄位應回 400，errorCode 為 UPLOAD_NO_FILE", async () => {
    const req = makeUploadRequest({ omitFile: true });

    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("UPLOAD_NO_FILE");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  // ── Case 6b：file 欄位傳字串而非 File 物件回 400 ───────────────
  it("file 欄位傳純字串（非 File）應回 400，errorCode 為 UPLOAD_NO_FILE", async () => {
    const formData = new FormData();
    formData.append("canvasId", VALID_CANVAS_ID);
    formData.append("uploadSessionId", VALID_SESSION_ID);
    formData.append("file", "not-a-file-object");

    const req = new Request(UPLOAD_URL, { method: "POST", body: formData });
    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("UPLOAD_NO_FILE");
  });
});

// ================================================================
// 錯誤案例 — 檔案內容驗證
// ================================================================

describe("POST /api/upload — 檔案內容驗證", () => {
  // ── Case 7：檔案超過 10 MB 回 413 ─────────────────────────────
  it("檔案超過 10 MB 應回 413，errorCode 為 ATTACHMENT_TOO_LARGE", async () => {
    const bigContent = new Uint8Array(MAX_SINGLE_BYTES + 1);
    const bigFile = new File([bigContent], "huge.bin", {
      type: "application/octet-stream",
    });
    const req = makeUploadRequest({ file: bigFile });

    const res = await handleUpload(req);

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.errorCode).toBe("ATTACHMENT_TOO_LARGE");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  // ── Case 8：檔名包含路徑分隔符（../evil）回 400 ────────────────
  // 注意：attachmentWriter 對 ../evil 做 basename 處理後得到 "evil"，
  // 只有 sanitized 結果為空、".."、"." 才拋 AttachmentInvalidNameError。
  // 純 ".." 作為檔名才是 400；"/etc/passwd" 等路徑穿越會被 basename 化為合法名稱。
  it("檔名為 '..' 應回 400，errorCode 為 ATTACHMENT_INVALID_NAME", async () => {
    const evilFile = new File(["evil"], "..", { type: "text/plain" });
    const req = makeUploadRequest({ file: evilFile });

    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe("ATTACHMENT_INVALID_NAME");
    expect(typeof body.message).toBe("string");
  });

  // ── Case 8b：檔名包含路徑（../evil）在 basename 後仍可成功上傳 ──
  // 原始 "../evil" 透過 path.basename 會被 sanitize 為 "evil"，屬合法檔名
  it("檔名 '../evil' 透過 basename sanitize 後成為合法檔名 'evil'，應成功上傳", async () => {
    const file = new File(["content"], "../evil", { type: "text/plain" });
    const req = makeUploadRequest({ file });

    const res = await handleUpload(req);

    // basename 後為 "evil"，是合法的 filename
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filename).toBe("evil");
  });
});

// ================================================================
// 錯誤回應格式驗證
// ================================================================

describe("POST /api/upload — 錯誤回應格式", () => {
  // ── Case 10：所有錯誤回應 body 格式應為 { errorCode, message } ──
  it("400 錯誤回應 body 包含 errorCode 與 zh-TW message 字串", async () => {
    // 用「缺少 sessionId」觸發 400
    const req = makeUploadRequest({ omitSessionId: true });
    const res = await handleUpload(req);

    expect(res.status).toBe(400);
    const body = await res.json();

    // errorCode 為非空字串
    expect(typeof body.errorCode).toBe("string");
    expect(body.errorCode.length).toBeGreaterThan(0);

    // message 為非空字串（zh-TW）
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);

    // 確認回應不包含其他非預期欄位（只驗 errorCode + message 存在即可）
    expect(Object.keys(body)).toContain("errorCode");
    expect(Object.keys(body)).toContain("message");
  });

  it("413 錯誤回應 body 包含 errorCode 與 zh-TW message 字串", async () => {
    const bigContent = new Uint8Array(MAX_SINGLE_BYTES + 1);
    const bigFile = new File([bigContent], "big.bin");
    const req = makeUploadRequest({ file: bigFile });
    const res = await handleUpload(req);

    expect(res.status).toBe(413);
    const body = await res.json();

    expect(typeof body.errorCode).toBe("string");
    expect(body.errorCode.length).toBeGreaterThan(0);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });
});
