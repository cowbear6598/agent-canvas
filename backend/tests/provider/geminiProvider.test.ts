/**
 * GeminiProvider 單元測試
 *
 * 測試 geminiProvider.chat() 的各種行為：
 * - 新對話 / resume 的 spawn 指令
 * - abortSignal 觸發後 kill subprocess
 * - spawn ENOENT 時推出 error event
 * - stdout JSON line 解析
 * - exit code 非 0 的各種情境
 * - prompt 透過 --prompt flag 傳入 argv
 * - stderr 截斷處理
 *
 * Mock 方法：
 * - vi.spyOn(Bun, "spawn") 替換為 makeMockProc 結果
 * - vi.mock("../../src/utils/logger.js") mock logger
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import type { GeminiOptions } from "../../src/services/provider/geminiProvider.js";

// ── logger mock ────────────────────────────────────────────────────────
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── 工具：把字串陣列轉為 ReadableStream<Uint8Array>（模擬 stdout/stderr） ─
function makeReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.length > 0 ? lines.join("\n") + "\n" : "";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}

// ── 工具：從原始 bytes 建立 ReadableStream（供 stderr 截斷測試使用）──────
function makeRawReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (data.length > 0) {
        controller.enqueue(data);
      }
      controller.close();
    },
  });
}

// ── 工具：收集 AsyncIterable 成陣列 ────────────────────────────────────
async function collectEvents(
  iterable: AsyncIterable<NormalizedEvent>,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

// ── 工具：建立 mock subprocess ──────────────────────────────────────────
// stdin 為 "ignore"，不需要 write/end，只保留 kill/stdout/stderr/exited
function makeMockProc(
  stdoutLines: string[],
  stderrLines: string[] = [],
  exitCode = 0,
) {
  return {
    stdout: makeReadableStream(stdoutLines),
    stderr: makeReadableStream(stderrLines),
    exited: Promise.resolve(exitCode),
    kill: vi.fn(),
  };
}

// ── 建立通用 ChatRequestContext ──────────────────────────────────────────
function makeCtx(
  overrides: Partial<{
    podId: string;
    message: string;
    workspacePath: string;
    resumeSessionId: string | null;
    abortSignal: AbortSignal;
    options: GeminiOptions;
  }> = {},
) {
  const defaultOptions: GeminiOptions = {
    model: "gemini-2.5-pro",
    resumeMode: "cli",
  };
  return {
    podId: "pod-gemini-test-001",
    message: "Hello, Gemini!",
    workspacePath: "/workspace/test",
    resumeSessionId: null,
    abortSignal: new AbortController().signal,
    options: defaultOptions,
    ...overrides,
  };
}

// ── 匯入 geminiProvider（在 mock 設定後匯入，確保使用 mocked logger）──
import { geminiProvider } from "../../src/services/provider/geminiProvider.js";
import { logger } from "../../src/utils/logger.js";

describe("GeminiProvider", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── C1：首次對話 spawn 指令包含必要的 CLI 參數 ──────────────────────
  it("C1: 首次對話時 spawn argv 應含所有必要旗標（--model、--output-format、--approval-mode、--skip-trust、--prompt），不含 --session-id 與 --extensions", async () => {
    const testMessage = "Hello, Gemini!";
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({
      message: testMessage,
      resumeSessionId: null,
      options: { model: "gemini-2.5-pro", resumeMode: "cli" },
    });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    expect(spawnArgs).toEqual([
      "gemini",
      "--model",
      "gemini-2.5-pro",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "yolo",
      "--skip-trust",
      "--prompt",
      testMessage,
    ]);

    // 不應含已移除的非法旗標
    expect(spawnArgs).not.toContain("--session-id");
    expect(spawnArgs).not.toContain("--extensions");
  });

  // ── C2：resume 時 spawn 指令含 --resume <uuid>，不含 --session-id，含 --prompt ─
  it("C2: resume 時 spawn argv 應含 --resume <uuid> 與 --prompt，不含 --session-id", async () => {
    const testMessage = "繼續上次對話";
    const resumeUuid = "4abf7b33-6c20-4693-9e43-9715b97fb144";
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({
      message: testMessage,
      resumeSessionId: resumeUuid,
    });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // 應含 --resume <uuid>（不是 "latest"）
    const resumeIdx = spawnArgs.indexOf("--resume");
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(spawnArgs[resumeIdx + 1]).toBe(resumeUuid);

    // 應含 --prompt <message>
    const promptIdx = spawnArgs.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(spawnArgs[promptIdx + 1]).toBe(testMessage);

    // 不應含 --session-id
    expect(spawnArgs).not.toContain("--session-id");
  });

  // ── C2b：resumeSessionId 格式不合法 → logger.warn，fallback 走新對話（不含 --resume）─
  it("C2b: resumeSessionId 格式不合法時應 logger.warn 並 fallback 走新對話，spawn argv 不含 --resume", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // 含非法字元，格式不合法（非 UUID）
    const ctx = makeCtx({ resumeSessionId: "not-a-uuid" });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // 不應含 --resume（fallback 走新對話）
    expect(spawnArgs).not.toContain("--resume");

    // logger.warn 應被呼叫，且含格式不合法提示
    expect(logger.warn).toHaveBeenCalled();
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const hasInvalidWarn = warnCalls.some((args) =>
      args.some(
        (arg) =>
          typeof arg === "string" &&
          (arg.includes("格式不合法") || arg.includes("not-a-uuid")),
      ),
    );
    expect(hasInvalidWarn).toBe(true);
  });

  // ── C3：spawn cwd 等於 ctx.workspacePath ─────────────────────────────
  it("C3: spawn 的 cwd 應等於 ctx.workspacePath", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({ workspacePath: "/custom/workspace/path" });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [, spawnOptions] = spawnSpy.mock.calls[0] as [
      string[],
      { cwd?: string },
    ];
    expect(spawnOptions.cwd).toBe("/custom/workspace/path");
  });

  // ── C4：prompt 透過 --prompt flag 放入 argv，不走 stdin ─────────────
  it("C4: prompt 應透過 --prompt flag 放入 spawn argv，argv 倒數第二個應為 --prompt，最後一個應為 prompt 文字", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const promptText = "這是測試 prompt";
    const ctx = makeCtx({ message: promptText });
    await collectEvents(geminiProvider.chat(ctx));

    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // argv 倒數第二個應為 --prompt
    expect(spawnArgs[spawnArgs.length - 2]).toBe("--prompt");
    // argv 最後一個應為 prompt 文字
    expect(spawnArgs[spawnArgs.length - 1]).toBe(promptText);
  });

  // ── C5：abortSignal 在 spawn 前已觸發 → onAbort 主動呼叫 → kill 被呼叫 ─
  it("C5: abortSignal 在 spawn 前已觸發，onAbort 主動呼叫，proc.kill 應被呼叫", async () => {
    const ac = new AbortController();
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // 在呼叫 chat 前先 abort
    ac.abort();

    const ctx = makeCtx({ abortSignal: ac.signal });
    await collectEvents(geminiProvider.chat(ctx));

    // kill 應被呼叫
    expect(mockProc.kill).toHaveBeenCalled();
  });

  // ── C6：abortSignal 在串流中觸發 → proc.kill 被呼叫，無重複觸發 ──────
  it("C6: abortSignal 在串流進行中觸發，proc.kill 應被呼叫", async () => {
    const ac = new AbortController();

    // 建立一個會延遲的 stdout ReadableStream
    const encoder = new TextEncoder();
    const stdoutStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 讓 abort 在串流中途觸發
        ac.abort();
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "result", status: "success" }) + "\n",
          ),
        );
        controller.close();
      },
    });

    const mockProc = {
      stdout: stdoutStream,
      stderr: makeReadableStream([]),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    };

    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({ abortSignal: ac.signal });
    await collectEvents(geminiProvider.chat(ctx));

    // kill 應被呼叫（abort listener 觸發）
    expect(mockProc.kill).toHaveBeenCalled();
    // kill 不應重複觸發（once: true 確保只觸發一次）
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });

  // ── C7：Bun.spawn 拋出 ENOENT → error event，message 含安裝提示，fatal=true ─
  it("C7: Bun.spawn 拋出 ENOENT 錯誤時應推出 error event，訊息含「Gemini CLI 尚未安裝」，fatal=true", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: spawn gemini"), {
      code: "ENOENT",
    });
    spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw enoentErr;
    });

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const e = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toContain("Gemini CLI 尚未安裝");
    expect(e.message).toContain("npm install -g @google/gemini-cli");
    expect(e.fatal).toBe(true);
  });

  // ── C8：Bun.spawn 拋出非 ENOENT → error event，message 含「啟動 gemini 子程序失敗」，fatal=true，logger.error 被呼叫 ─
  it("C8: Bun.spawn 拋出非 ENOENT 錯誤時應推出 error event，訊息為「啟動 gemini 子程序失敗，請查 server log」，fatal=true，logger.error 被呼叫", async () => {
    const randomErr = new Error("permission denied");
    spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw randomErr;
    });

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const e = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toBe("啟動 gemini 子程序失敗，請查 server log");
    expect(e.fatal).toBe(true);

    // 原始 err 應寫入 logger.error
    expect(logger.error).toHaveBeenCalled();
  });

  // ── C9：stdout JSON line 正確 normalize ──────────────────────────────
  it("C9: stdout JSON line 應被正確解析為對應的 NormalizedEvent（init / message delta / tool_use / tool_result / result success）", async () => {
    const stdoutLines = [
      JSON.stringify({ type: "init", session_id: "sess-gemini-001" }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        delta: true,
        content: "Hello from Gemini",
      }),
      JSON.stringify({
        type: "tool_use",
        tool_id: "tool-001",
        tool_name: "read_file",
        parameters: { path: "/tmp/test.txt" },
      }),
      JSON.stringify({
        type: "tool_result",
        tool_id: "tool-001",
        tool_name: "read_file",
        output: "file content",
      }),
      JSON.stringify({ type: "result", status: "success" }),
    ];

    const mockProc = makeMockProc(stdoutLines);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    expect(events).toHaveLength(5);

    // session_started
    expect(events[0].type).toBe("session_started");
    expect(
      (events[0] as Extract<NormalizedEvent, { type: "session_started" }>)
        .sessionId,
    ).toBe("sess-gemini-001");

    // text
    expect(events[1].type).toBe("text");
    expect(
      (events[1] as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("Hello from Gemini");

    // tool_call_start
    expect(events[2].type).toBe("tool_call_start");
    const toolStart = events[2] as Extract<
      NormalizedEvent,
      { type: "tool_call_start" }
    >;
    expect(toolStart.toolUseId).toBe("tool-001");
    expect(toolStart.toolName).toBe("read_file");
    expect(toolStart.input).toEqual({ path: "/tmp/test.txt" });

    // tool_call_result
    expect(events[3].type).toBe("tool_call_result");
    const toolResult = events[3] as Extract<
      NormalizedEvent,
      { type: "tool_call_result" }
    >;
    expect(toolResult.toolUseId).toBe("tool-001");
    expect(toolResult.output).toBe("file content");

    // turn_complete
    expect(events[4].type).toBe("turn_complete");
  });

  // ── C10：stdout 跨 chunk 切割不破壞解析 ──────────────────────────────
  it("C10: stdout 跨 chunk 切割不應破壞 JSON 行解析", async () => {
    const jsonLine = JSON.stringify({ type: "result", status: "success" });
    // 把一行 JSON 切成兩個 chunk
    const half1 = jsonLine.slice(0, Math.floor(jsonLine.length / 2));
    const half2 = jsonLine.slice(Math.floor(jsonLine.length / 2)) + "\n";
    const encoder = new TextEncoder();

    const splitStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(half1));
        controller.enqueue(encoder.encode(half2));
        controller.close();
      },
    });

    const mockProc = {
      stdout: splitStream,
      stderr: makeReadableStream([]),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    };
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    // 應正確解析出 turn_complete
    expect(events.some((e) => e.type === "turn_complete")).toBe(true);
  });

  // ── C11：exit code 0 → 不 yield error ────────────────────────────────
  it("C11: exit code 0 時不應推出 error event", async () => {
    const mockProc = makeMockProc(
      [JSON.stringify({ type: "result", status: "success" })],
      [],
      0,
    );
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(0);
  });

  // ── C12：exit code 非 0 且 hasTurnComplete=true → 不 yield error，僅 logger.warn ─
  it("C12: exit code 非 0 且已發 turn_complete 時不應推出 error event，只 logger.warn", async () => {
    const mockProc = makeMockProc(
      [JSON.stringify({ type: "result", status: "success" })],
      [],
      1,
    );
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(0);
    expect(events.some((e) => e.type === "turn_complete")).toBe(true);

    // 應發出 warn 記錄
    expect(logger.warn).toHaveBeenCalled();
  });

  // ── C13：exit code 非 0 且 hasTurnComplete=false → yield error，message 含「執行發生錯誤」，fatal=false ─
  it("C13: exit code 非 0 且未發 turn_complete 時應推出 error event，訊息為「執行發生錯誤，請查閱伺服器日誌」，fatal=false", async () => {
    const mockProc = makeMockProc([], ["some stderr output"], 1);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);

    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toBe("執行發生錯誤，請查閱伺服器日誌");
    expect(e.fatal).toBe(false);
  });

  // ── C14：exit code 41 且 hasTurnComplete=false → 登入提示 error ───────
  it("C14: exit code 41 且未發 turn_complete 時應推出登入提示 error，message 含「Gemini 尚未登入」", async () => {
    const mockProc = makeMockProc([], [], 41);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);

    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toContain("Gemini 尚未登入");
    expect(e.message).toContain("Google OAuth 登入");
    expect(e.fatal).toBe(false);
  });

  // ── C15：exit code 52 且 hasTurnComplete=false → 同 C14 訊息 ──────────
  it("C15: exit code 52 且未發 turn_complete 時應推出登入提示 error，message 含「Gemini 尚未登入」", async () => {
    const mockProc = makeMockProc([], [], 52);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);

    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toContain("Gemini 尚未登入");
    expect(e.message).toContain("Google OAuth 登入");
    expect(e.fatal).toBe(false);
  });

  // ── C16：exit code 130 + abortSignal.aborted=true → 不 yield error ──
  it("C16: exit code 130 且 abortSignal 已觸發時不應推出 error event", async () => {
    const ac = new AbortController();

    const mockProc = makeMockProc([], [], 130);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // 先 abort
    ac.abort();

    const ctx = makeCtx({ abortSignal: ac.signal });
    const events = await collectEvents(geminiProvider.chat(ctx));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(0);
  });

  // ── C17：result status=error → yield error event，fatal=true，message 取 error.message ─
  it("C17: result status=error 應推出 error event，fatal=true，message 取 error.message", async () => {
    const stdoutLines = [
      JSON.stringify({
        type: "result",
        status: "error",
        error: { message: "Gemini API 回應發生錯誤" },
      }),
    ];
    const mockProc = makeMockProc(stdoutLines);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);

    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toBe("Gemini API 回應發生錯誤");
    expect(e.fatal).toBe(true);
  });

  // ── C18：init event session_id 透過 session_started NormalizedEvent yield 出 ─
  it("C18: 首次對話時 Gemini CLI 的 init event 應轉為 session_started NormalizedEvent yield 出", async () => {
    const stdoutLines = [
      // init event 帶有 Gemini 分配的 session_id
      JSON.stringify({ type: "init", session_id: "gemini-sess-xyz" }),
      JSON.stringify({ type: "result", status: "success" }),
    ];
    const mockProc = makeMockProc(stdoutLines);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const sessionStarted = events.find((e) => e.type === "session_started");
    expect(sessionStarted).toBeDefined();
    expect(
      (sessionStarted as Extract<NormalizedEvent, { type: "session_started" }>)
        .sessionId,
    ).toBe("gemini-sess-xyz");
  });

  // ── C19：stderr 超過 64KB 自動截斷，logger.warn 紀錄截斷 ──────────────
  it("C19: stderr 超過 64KB 時應自動截斷，logger.warn 記錄截斷訊息", async () => {
    // 建立超過 64KB 的 stderr 資料
    const STDERR_MAX_BYTES = 64 * 1024;
    const largeStderr = new Uint8Array(STDERR_MAX_BYTES + 1024).fill(
      "x".charCodeAt(0),
    );

    const mockProc = {
      stdout: makeReadableStream([
        JSON.stringify({ type: "result", status: "success" }),
      ]),
      stderr: makeRawReadableStream(largeStderr),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    };
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    await collectEvents(geminiProvider.chat(makeCtx()));

    // logger.warn 應被呼叫，且訊息含截斷提示
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const truncateWarn = warnCalls.some((args) =>
      args.some(
        (arg) =>
          typeof arg === "string" &&
          (arg.includes("截斷") || arg.includes("TRUNCATED")),
      ),
    );
    expect(truncateWarn).toBe(true);
  });

  // ── C20：role=user 的 message event 應被忽略，不 yield 任何 NormalizedEvent ─
  it("C20: role=user 的 message event 應被忽略，不 yield 任何 NormalizedEvent", async () => {
    const stdoutLines = [
      // role=user 的 message 應被 normalizer 忽略
      JSON.stringify({
        type: "message",
        role: "user",
        delta: true,
        content: "使用者訊息應被忽略",
      }),
      JSON.stringify({ type: "result", status: "success" }),
    ];
    const mockProc = makeMockProc(stdoutLines);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    // 不應有 text event（user message 被忽略）
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(0);

    // 應有 turn_complete
    expect(events.some((e) => e.type === "turn_complete")).toBe(true);
  });
});
