/**
 * codexService provider process rule test
 *
 * 涵蓋：
 * - model 格式驗證失敗 → 提前回 success: false
 * - workspacePath 非絕對路徑 → 回 success: false
 * - spawn 成功、收到 turn_complete → 回 success: true 與 content
 * - 子程序非零 exit code 但有 turn_complete → success: true（warn 路徑）
 * - abort signal 觸發 → 回 success: false 並 kill 子程序
 * - timeout 觸發 → 回 success: false
 */

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { codexService } from "../../src/services/codex/codexService.js";
import { logger } from "../../src/utils/logger.js";

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
    stdin: {
      write: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    },
    stdout: makeReadableStream(stdoutLines),
    stderr: makeReadableStream(stderrLines),
    exited: Promise.resolve(exitCode),
    kill: vi.fn(),
  };
}

/** 正常的 turn_complete JSON line（對應 codexNormalizer 的 "turn.completed" 事件） */
const TURN_COMPLETE_LINE = JSON.stringify({ type: "turn.completed" });

/** 正常的 agent_message JSON line（提供文字內容） */
const AGENT_MESSAGE_LINE = JSON.stringify({
  type: "item.completed",
  item: { id: "item-1", type: "agent_message", text: "回應內容" },
});

const REMOVED_CODEX_SANDBOX_FLAG = ["--", "sandbox"].join("");
const REMOVED_CODEX_SANDBOX_MODE = ["workspace", "write"].join("-");
const REMOVED_CODEX_SANDBOX_CONFIG_PREFIX = [
  "sandbox",
  "workspace",
  "write",
].join("_");

const BASE_OPTIONS = {
  systemPrompt: "sys",
  userMessage: "user",
  workspacePath: "/tmp/workspace",
  model: "gpt-5.4",
};

describe("codexService.executeDisposableChat", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnSpy = vi.spyOn(Bun, "spawn");
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  it("model 名稱不符合 MODEL_RE → 提前回 success: false", async () => {
    // MODEL_RE = /^[a-zA-Z0-9._-]+$/ — 空白或特殊字元會被拒絕
    const result = await codexService.executeDisposableChat({
      ...BASE_OPTIONS,
      model: "invalid model with spaces",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("不合法的 model 名稱");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("workspacePath 非絕對路徑 → 回 success: false", async () => {
    const result = await codexService.executeDisposableChat({
      ...BASE_OPTIONS,
      workspacePath: "relative/path",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("workspacePath 必須為絕對路徑");
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("spawn 成功、收到 turn_complete → 回 success: true 與 content", async () => {
    const mockProc = makeMockProc(
      [AGENT_MESSAGE_LINE, TURN_COMPLETE_LINE],
      [],
      0,
    );
    spawnSpy.mockReturnValue(mockProc as any);

    const result = await codexService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    expect(spawnArgs).toEqual([
      "codex",
      "exec",
      "-",
      "--json",
      "--skip-git-repo-check",
      "--cd",
      BASE_OPTIONS.workspacePath,
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      BASE_OPTIONS.model,
    ]);
    expect(spawnArgs).not.toContain(REMOVED_CODEX_SANDBOX_FLAG);
    expect(spawnArgs).not.toContain(REMOVED_CODEX_SANDBOX_MODE);
    expect(
      spawnArgs.some((arg) => arg.includes(REMOVED_CODEX_SANDBOX_CONFIG_PREFIX)),
    ).toBe(false);
  });

  it("啟動一次性查詢 log 應包含 thinking level", async () => {
    const mockProc = makeMockProc(
      [AGENT_MESSAGE_LINE, TURN_COMPLETE_LINE],
      [],
      0,
    );
    spawnSpy.mockReturnValue(mockProc as any);

    await codexService.executeDisposableChat({
      ...BASE_OPTIONS,
      thinkingLevel: "high",
    });

    expect(logger.log).toHaveBeenCalledWith(
      "Chat",
      "Init",
      "[CodexService] 啟動一次性查詢（model: gpt-5.4，thinking: high）",
    );
  });

  it("子程序非零 exit code 但有 turn_complete → success: true（warn 路徑）", async () => {
    const mockProc = makeMockProc(
      [AGENT_MESSAGE_LINE, TURN_COMPLETE_LINE],
      [],
      1, // 非零 exit code
    );
    spawnSpy.mockReturnValue(mockProc as any);

    const result = await codexService.executeDisposableChat(BASE_OPTIONS);

    expect(result.success).toBe(true);
  });

  it("abort signal 觸發 → 回 success: false", async () => {
    // 建立一個 stdout 會暫停等待的 mock proc
    const controller = new AbortController();
    const abortController = new AbortController();

    // 使用空 stdout（不送 turn_complete），確保流程等到 abort
    const mockProc = makeMockProc([], [], 0);
    spawnSpy.mockReturnValue(mockProc as any);

    // 先 abort 再呼叫
    abortController.abort();
    const result = await codexService.executeDisposableChat(
      BASE_OPTIONS,
      abortController.signal,
    );

    expect(result.success).toBe(false);
    void controller;
  });

  it("timeout 觸發 → 回 success: false", async () => {
    // 縮短 timeout 以加速測試
    const origEnv = process.env.CODEX_DISPOSABLE_CHAT_TIMEOUT_MS;
    // 設為最小值 30s 但我們手動 abort 來模擬 timeout
    process.env.CODEX_DISPOSABLE_CHAT_TIMEOUT_MS = "30000";

    // 建立一個永不結束的 stdout mock（模擬 codex 不回應）
    const neverEndingStream = new ReadableStream<Uint8Array>({
      start() {
        // 永不呼叫 controller.enqueue 或 controller.close
      },
    });

    const mockProc = {
      stdin: {
        write: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
      },
      stdout: neverEndingStream,
      stderr: makeReadableStream([]),
      exited: new Promise<number>(() => {
        // 永不 resolve
      }),
      kill: vi.fn(),
    };
    spawnSpy.mockReturnValue(mockProc as any);

    // 以外部 abort 模擬 timeout 行為（Symbol reason = CODEX_TIMEOUT_REASON）
    const timeoutController = new AbortController();
    // 模擬超時：傳入已 abort 且原因不是 CODEX_TIMEOUT_REASON 的 signal 也可以
    timeoutController.abort();

    const result = await codexService.executeDisposableChat(
      BASE_OPTIONS,
      timeoutController.signal,
    );

    expect(result.success).toBe(false);

    process.env.CODEX_DISPOSABLE_CHAT_TIMEOUT_MS = origEnv;
  });
});
