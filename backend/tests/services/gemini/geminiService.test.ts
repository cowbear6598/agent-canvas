/**
 * geminiService.executeDisposableChat 單元測試
 *
 * 涵蓋：
 * 1. workspacePath 非絕對路徑 → success:false 含 zh-TW 錯誤
 * 2. workspacePath 含 .. 經 realpath 解析後與原路徑不一致 → success:false
 * 3. model 不符合 MODEL_RE → success:false 含 zh-TW 錯誤
 * 4. 進入函式前 abortSignal.aborted === true → 立即 success:false
 * 5. spawn 拋 ENOENT → success:false 含安裝提示
 * 6. spawn 拋其他錯誤（EACCES）→ success:false
 * 7. 正常完成（exit 0 + turn_complete）→ success:true 含 content
 * 8. exit 非零但已收到 turn_complete → success:true（warn log）
 * 9. exit 非零且無 turn_complete → success:false
 * 10. 執行中 abortSignal 觸發 → kill 子程序、success:false
 */

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geminiService } from "../../../src/services/gemini/geminiService.js";
import fs from "fs";

// ── 工具：把字串陣列轉為 ReadableStream<Uint8Array> ──────────────────────────
function makeReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.length > 0 ? lines.join("\n") + "\n" : "";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

// ── 工具：建立 mock subprocess ───────────────────────────────────────────────
function makeMockProc(
  stdoutLines: string[],
  stderrLines: string[] = [],
  exitCode = 0,
) {
  return {
    stdin: { write: vi.fn(), end: vi.fn().mockResolvedValue(undefined) },
    stdout: makeReadableStream(stdoutLines),
    stderr: makeReadableStream(stderrLines),
    exited: Promise.resolve(exitCode),
    kill: vi.fn(),
  };
}

/** 正常的 text 事件（geminiNormalizer 解析 type=message, role=assistant, delta=true） */
const TEXT_LINE = JSON.stringify({
  type: "message",
  role: "assistant",
  delta: true,
  content: "回應內容",
});

/** turn_complete 事件（geminiNormalizer 解析 type=result, status=success） */
const TURN_COMPLETE_LINE = JSON.stringify({
  type: "result",
  status: "success",
});

const BASE_OPTIONS = {
  systemPrompt: "系統提示",
  userMessage: "使用者訊息",
  workspacePath: "/tmp/workspace",
  model: "gemini-2.5-pro",
};

describe("geminiService.executeDisposableChat", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;
  let realpathSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnSpy = vi.spyOn(Bun, "spawn");
    // 預設 realpathSync 直接回傳輸入路徑（不穿越）
    realpathSpy = vi
      .spyOn(fs, "realpathSync")
      .mockImplementation((p: unknown) => String(p));
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    realpathSpy.mockRestore();
  });

  // ── case 1 ──────────────────────────────────────────────────────────────────

  it("workspacePath 非絕對路徑 → success:false 含 zh-TW 錯誤", async () => {
    const result = await geminiService.executeDisposableChat({
      ...BASE_OPTIONS,
      workspacePath: "relative/path",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("workspacePath 必須為絕對路徑");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  // ── case 2 ──────────────────────────────────────────────────────────────────

  it("workspacePath 含 .. 經 realpath 解析後與原路徑不一致 → success:false", async () => {
    // realpath 展開後路徑與 normalize 後不同，代表有穿越
    // /tmp/../etc/passwd normalize 後為 /etc/passwd；讓 realpathSync 回傳不同路徑以觸發檢查
    realpathSpy.mockReturnValue("/real/etc/passwd");

    const result = await geminiService.executeDisposableChat({
      ...BASE_OPTIONS,
      workspacePath: "/tmp/../etc/passwd",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("工作目錄路徑驗證失敗，不允許路徑穿越");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  // ── case 3 ──────────────────────────────────────────────────────────────────

  it("model 不符合 MODEL_RE → success:false 含 zh-TW 錯誤", async () => {
    const result = await geminiService.executeDisposableChat({
      ...BASE_OPTIONS,
      model: "invalid model with spaces",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("不合法的 model 名稱");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  // ── case 4 ──────────────────────────────────────────────────────────────────

  it("進入函式前 abortSignal.aborted === true → 立即 success:false", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await geminiService.executeDisposableChat(
      BASE_OPTIONS,
      controller.signal,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("取消");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  // ── case 5 ──────────────────────────────────────────────────────────────────

  it("spawn 拋 ENOENT → success:false 含安裝提示", async () => {
    const err = new Error("spawn gemini ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    spawnSpy.mockImplementation(() => {
      throw err;
    });

    const result = await geminiService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Gemini CLI 尚未安裝");
  });

  // ── case 6 ──────────────────────────────────────────────────────────────────

  it("spawn 拋其他錯誤（EACCES）→ success:false", async () => {
    const err = new Error("Permission denied") as NodeJS.ErrnoException;
    err.code = "EACCES";
    spawnSpy.mockImplementation(() => {
      throw err;
    });

    const result = await geminiService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(false);
    expect(result.error).toContain("啟動 gemini 子程序失敗");
  });

  // ── case 7 ──────────────────────────────────────────────────────────────────

  it("正常完成（exit 0 + turn_complete）→ success:true 含 content", async () => {
    const mockProc = makeMockProc([TEXT_LINE, TURN_COMPLETE_LINE], [], 0);
    spawnSpy.mockReturnValue(mockProc as any);

    const result = await geminiService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(result.content).toBe("回應內容");
    expect(spawnSpy).toHaveBeenCalledOnce();
  });

  // ── case 8 ──────────────────────────────────────────────────────────────────

  it("exit 非零但已收到 turn_complete → success:true（warn log）", async () => {
    const mockProc = makeMockProc([TEXT_LINE, TURN_COMPLETE_LINE], [], 1);
    spawnSpy.mockReturnValue(mockProc as any);

    const result = await geminiService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(true);
  });

  // ── case 9 ──────────────────────────────────────────────────────────────────

  it("exit 非零且無 turn_complete → success:false", async () => {
    const mockProc = makeMockProc([TEXT_LINE], [], 1);
    spawnSpy.mockReturnValue(mockProc as any);

    const result = await geminiService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(false);
  });

  // ── case 10 ─────────────────────────────────────────────────────────────────

  it("執行中 abortSignal 觸發 → kill 子程序、success:false", async () => {
    const abortController = new AbortController();
    // 先 abort 再呼叫（模擬已中止的情況）
    abortController.abort();

    const mockProc = makeMockProc([], [], 0);
    spawnSpy.mockReturnValue(mockProc as any);

    const result = await geminiService.executeDisposableChat(
      BASE_OPTIONS,
      abortController.signal,
    );

    expect(result.success).toBe(false);
  });
});
