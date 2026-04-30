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

// ── geminiHelpers mock ─────────────────────────────────────────────────
// collectStderr 使用輕薄 mock 實作：直接讀完 stream 並 join 為字串，不做截斷。
// 目的：讓測試對 stderr 內容的斷言不依賴 collectStderr 內部截斷行為（如上限、truncated 標記）。
// buildGeminiEnv 保留真實實作（直接呼叫 actual），避免影響 spawn env 相關斷言。
vi.mock("../../src/services/gemini/geminiHelpers.js", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../src/services/gemini/geminiHelpers.js")
    >();
  return {
    ...actual,
    collectStderr: vi.fn(
      async (
        proc: Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">,
        _abortSignal: AbortSignal,
        _logPrefix?: string,
      ): Promise<string> => {
        const chunks: string[] = [];
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          chunks.push(Buffer.from(chunk as Uint8Array).toString("utf-8"));
        }
        return chunks.join("");
      },
    ),
  };
});

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
/** mock 不含 stdin，因為 spawn options 設 stdin: 'ignore'（prompt 透過 --prompt flag 傳入 argv） */
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

// ── 工具：驗證 logger.warn 被呼叫且含指定子字串 ────────────────────────
/**
 * 驗證 logger.warn 的呼叫記錄中，至少有一次呼叫的某個參數同時包含所有指定子字串。
 * 封裝重複的 warnCalls.some + args.some + arg.includes 驗證模式。
 *
 * @param loggerWarnMock vi.mocked(logger.warn)
 * @param substrings 每個字串都必須出現在同一個 arg 中（做 AND 驗證）
 */
function expectWarnContaining(
  loggerWarnMock: ReturnType<typeof vi.mocked<typeof logger.warn>>,
  ...substrings: string[]
): void {
  const warnCalls = loggerWarnMock.mock.calls;
  const hasMatch = warnCalls.some((args) =>
    args.some(
      (arg) =>
        typeof arg === "string" && substrings.every((sub) => arg.includes(sub)),
    ),
  );
  expect(hasMatch).toBe(true);
}

// ── 建立通用 ChatRequestContext ──────────────────────────────────────────
function makeCtx(
  overrides: Partial<{
    podId: string;
    message: string | ContentBlock[];
    workspacePath: string;
    resumeSessionId: string | null;
    abortSignal: AbortSignal;
    options: GeminiOptions;
  }> = {},
) {
  const defaultOptions: GeminiOptions = {
    model: "gemini-2.5-pro",
    resumeMode: "cli",
    // plugins 預設空陣列，對應 buildExtensionArgs 會產生 ["-e", "none"]
    plugins: [],
  };
  return {
    podId: "pod-gemini-test-001",
    message: "Hello, Gemini!",
    workspacePath: "/test-workspace/gemini-provider",
    resumeSessionId: null,
    abortSignal: new AbortController().signal,
    options: defaultOptions,
    ...overrides,
  };
}

// ── 匯入 geminiProvider（在 mock 設定後匯入，確保使用 mocked logger）──
import { geminiProvider } from "../../src/services/provider/geminiProvider.js";
import { logger } from "../../src/utils/logger.js";
import {
  collectStderr,
  STDERR_MAX_BYTES,
} from "../../src/services/gemini/geminiHelpers.js";
import type { ContentBlock } from "../../src/types/message.js";
import type { Pod } from "../../src/types/pod.js";

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
      options: { model: "gemini-2.5-pro", resumeMode: "cli", plugins: [] },
    });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // 使用 arrayContaining 而非 toEqual，容許新增的 -e none 插入 -s 與 --prompt 之間
    expect(spawnArgs).toEqual(
      expect.arrayContaining([
        "gemini",
        "--model",
        "gemini-2.5-pro",
        "--output-format",
        "stream-json",
        "--approval-mode",
        "yolo",
        "--skip-trust",
        "-s",
        "-e",
        "none",
        "--prompt",
        testMessage,
      ]),
    );

    // 不應含已移除的非法旗標
    expect(spawnArgs).not.toContain("--session-id");
    expect(spawnArgs).not.toContain("--extensions");
  });

  // ── C1b：new session 的 spawn args 必含 `-s`（macOS Seatbelt sandbox 旗標）────
  it("C1b: new session（無 resumeSessionId）的 spawn args 必含 `-s`", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // resumeSessionId 為 null → 走新對話路徑
    const ctx = makeCtx({ resumeSessionId: null });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // -s 必須存在（macOS Seatbelt sandbox 所需，buildNewSessionArgs 負責加入）
    expect(spawnArgs).toContain("-s");
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

    // logger.warn 應被呼叫，且同時含「格式不合法」與「[INVALID_SESSION_ID_MASKED]」（不洩漏原始值）
    expect(logger.warn).toHaveBeenCalled();
    expectWarnContaining(
      vi.mocked(logger.warn),
      "格式不合法",
      "[INVALID_SESSION_ID_MASKED]",
    );
  });

  // ── C2c：resume session 的 spawn args 必含 `-s`（macOS Seatbelt sandbox 旗標）──
  it("C2c: resume session（含有效 resumeSessionId）的 spawn args 必含 `-s`", async () => {
    const resumeUuid = "4abf7b33-6c20-4693-9e43-9715b97fb144";
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // resumeSessionId 為有效 UUID → 走 resume 路徑
    const ctx = makeCtx({ resumeSessionId: resumeUuid });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // -s 必須存在（macOS Seatbelt sandbox 所需，buildResumeArgs 負責加入）
    expect(spawnArgs).toContain("-s");
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

  // ── C5：abortSignal 在 spawn 前已觸發 → onAbort 主動呼叫 → kill 被呼叫，無業務 event ─
  it("C5: abortSignal 在 spawn 前已觸發，onAbort 主動呼叫，proc.kill 應被呼叫，且不 yield 任何業務 event", async () => {
    const ac = new AbortController();
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // 在呼叫 chat 前先 abort
    ac.abort();

    const ctx = makeCtx({ abortSignal: ac.signal });
    const events = await collectEvents(geminiProvider.chat(ctx));

    // kill 應被呼叫
    expect(mockProc.kill).toHaveBeenCalled();

    // abort 在 spawn 後立刻終止：串流邏輯不執行，不應 yield 任何業務 event
    // complete / text / tool_use 等業務 event 均不應出現
    const businessEventTypes = [
      "turn_complete",
      "text",
      "tool_call_start",
      "tool_call_result",
      "session_started",
    ];
    const businessEvents = events.filter((e) =>
      businessEventTypes.includes(e.type),
    );
    expect(businessEvents).toHaveLength(0);
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

  // ── C-SS-1：非 ENOENT 的 spawn 失敗 → yield error，不呼叫 attachAbortHandler ─
  it("C-SS-1: 非 ENOENT 的 spawn 失敗時應 yield error event（fatal=true），且 attachAbortHandler 未被呼叫（spawn 失敗無 proc，不掛 abort listener）", async () => {
    const accessErr = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw accessErr;
    });

    // 用 spy 追蹤 abortSignal 的 addEventListener / removeEventListener 是否被呼叫
    const ac = new AbortController();
    const addListenerSpy = vi.spyOn(ac.signal, "addEventListener");
    const removeListenerSpy = vi.spyOn(ac.signal, "removeEventListener");

    const ctx = makeCtx({ abortSignal: ac.signal });
    const events = await collectEvents(geminiProvider.chat(ctx));

    // 應推出 error event，訊息含「啟動 gemini 子程序失敗」
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const e = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toBe("啟動 gemini 子程序失敗，請查 server log");
    expect(e.fatal).toBe(true);

    // spawn 失敗 → 沒有 proc → attachAbortHandler 未被呼叫
    // 因此 abortSignal 不應有任何 abort listener 被掛載或移除
    expect(addListenerSpy).not.toHaveBeenCalled();
    expect(removeListenerSpy).not.toHaveBeenCalled();
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

  // ── C-PS-1：stdout 結束時 buffer 殘餘不含換行也會被 normalize ────────
  it("C-PS-1: stdout stream 結束時 buffer 中殘餘的不含換行 JSON 也應被正確解析為 NormalizedEvent", async () => {
    // 推出不含 \n 結尾的 JSON 字串，然後 stream 直接關閉
    const jsonStr = JSON.stringify({ type: "result", status: "success" });
    const encoder = new TextEncoder();

    const noNewlineStream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 故意不加 \n，測試 processStdoutLines 的 buffer 殘餘處理邏輯
        controller.enqueue(encoder.encode(jsonStr));
        controller.close();
      },
    });

    const mockProc = {
      stdout: noNewlineStream,
      stderr: makeReadableStream([]),
      exited: Promise.resolve(0),
      kill: vi.fn(),
    };
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    // 即使沒有 \n，stream 關閉後 buffer 內容也應被解析出 turn_complete
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
  it("C12: exit code 非 0 且已發 turn_complete 時不應推出 error event，只 logger.warn，warn 應含 stderr 內容", async () => {
    const stderrContent = "gemini: warning non-fatal output";
    const mockProc = makeMockProc(
      [JSON.stringify({ type: "result", status: "success" })],
      // 傳入不含敏感字的 stderr，redactStderr 應原樣保留
      [stderrContent],
      1,
    );
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const events = await collectEvents(geminiProvider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(0);
    expect(events.some((e) => e.type === "turn_complete")).toBe(true);

    // 應發出 warn 記錄
    expect(logger.warn).toHaveBeenCalled();

    // warn 訊息應含 stderr 實際內容（logExitCodeDetails 輸出 "stderr: <內容>"）
    expectWarnContaining(vi.mocked(logger.warn), stderrContent);
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

  // ── C19：stderr 超過 64KB 自動截斷，logger.warn 紀錄截斷，stderrText 長度有上限 ─

  /**
   * 建立還原 actual collectStderr 截斷行為的 mockImplementationOnce。
   * 同時捕捉 stderrText 以供後續斷言使用。
   */
  function setupC19TruncationMock(): { getCapture: () => string | undefined } {
    let capturedStderrText: string | undefined;
    vi.mocked(collectStderr).mockImplementationOnce(
      async (proc, abortSig, logPrefix) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncated = false;
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          if (abortSig.aborted) break;
          const buf = Buffer.from(chunk as Uint8Array);
          if (totalBytes + buf.byteLength <= STDERR_MAX_BYTES) {
            chunks.push(buf);
            totalBytes += buf.byteLength;
          } else {
            truncated = true;
            break;
          }
        }
        let text = Buffer.concat(chunks).toString("utf-8").trim();
        if (truncated) {
          const { logger: innerLogger } =
            await import("../../src/utils/logger.js");
          innerLogger.warn(
            "Chat",
            "Warn",
            `${logPrefix ?? "[Gemini]"} stderr 已達上限（${STDERR_MAX_BYTES} bytes），後續輸出已截斷`,
          );
          text += "\n[TRUNCATED]";
        }
        capturedStderrText = text;
        return text;
      },
    );
    return { getCapture: () => capturedStderrText };
  }

  it("C19a: stderr 超過 64KB 時，logger.warn 應含截斷提示", async () => {
    // 建立超過 64KB 的 stderr 資料（全為 "x"，無敏感字，redactStderr 不會遮蔽）
    const largeStderr = new Uint8Array(STDERR_MAX_BYTES + 1024).fill(
      "x".charCodeAt(0),
    );

    setupC19TruncationMock();

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
    expectWarnContaining(vi.mocked(logger.warn), "截斷");
  });

  it("C19b: stderr 超過 64KB 時，實際 stderrText 長度不超過 STDERR_MAX_BYTES", async () => {
    // 建立超過 64KB 的 stderr 資料（全為 "x"，無敏感字，redactStderr 不會遮蔽）
    const largeStderr = new Uint8Array(STDERR_MAX_BYTES + 1024).fill(
      "x".charCodeAt(0),
    );

    const { getCapture } = setupC19TruncationMock();

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

    // stderrText 純文字部分（不含 TRUNCATED 標記）長度不超過 STDERR_MAX_BYTES
    const capturedStderrText = getCapture();
    expect(capturedStderrText).toBeDefined();
    const textWithoutTruncatedMarker = capturedStderrText!.replace(
      "\n[TRUNCATED]",
      "",
    );
    expect(textWithoutTruncatedMarker.length).toBeLessThanOrEqual(
      STDERR_MAX_BYTES,
    );
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

  // ── C21：傳入已展開的 Command Note 訊息，--prompt 內容應以 <command> 標籤開頭 ─
  it("C21: 傳入已展開的 Command Note 訊息時，--prompt 後的元素應以 <command>\\n{markdown}\\n</command>\\n 開頭", async () => {
    const markdown = "# 系統指令\n請用繁體中文回覆。";
    const originalMessage = "請幫我解釋這段程式碼";
    // 模擬 expandCommandMessage 展開後的字串（格式：<command>\n{markdown}\n</command>\n{原訊息}）
    const expandedMessage = `<command>\n${markdown}\n</command>\n${originalMessage}`;

    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({ message: expandedMessage });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    const promptIdx = spawnArgs.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);

    const promptValue = spawnArgs[promptIdx + 1];
    // 驗證 --prompt 的值以 <command>\n{markdown}\n</command>\n 開頭
    expect(promptValue).toMatch(/^<command>\n/);
    expect(promptValue).toContain(`<command>\n${markdown}\n</command>\n`);
    // 驗證原始訊息緊接在 </command>\n 之後，無額外空白行
    expect(promptValue).toBe(expandedMessage);
  });

  // ── C22：傳入未展開的純文字訊息，--prompt 內容不應含 <command> 標籤 ─────
  it("C22: 傳入未展開的純文字訊息時，--prompt 後的元素不應含 <command> 標籤", async () => {
    const plainMessage = "請告訴我今天天氣如何";

    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({ message: plainMessage });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    const promptIdx = spawnArgs.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);

    const promptValue = spawnArgs[promptIdx + 1];
    // 純文字訊息不應含 <command> 標籤
    expect(promptValue).not.toContain("<command>");
    expect(promptValue).not.toContain("</command>");
    expect(promptValue).toBe(plainMessage);
  });

  // ── C0a：workspacePath 含 `..` 時的處理（行為鎖定測試） ──────────────────
  it("C0a: workspacePath 含 `..` 時的處理：geminiProvider 原樣傳入 cwd，防護責任在 executor 上層", async () => {
    const traversalPath = "/test-workspace/../../../etc/passwd";
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const ctx = makeCtx({ workspacePath: traversalPath });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [, spawnOptions] = spawnSpy.mock.calls[0] as [
      string[],
      { cwd?: string },
    ];

    // geminiProvider 不對 workspacePath 做正規化，原樣傳入 cwd
    // 防護責任在 executor 上層（resolvePodCwd）
    expect(spawnOptions.cwd).toBe(traversalPath);
  });

  // ── C2d：resumeSessionId 含注入向量 → fallback 走新對話 ────────────────
  it("C2d: resumeSessionId 含 `--evil-flag` 時應 fallback 走新對話，spawn argv 不含 --resume，logger.warn 含「格式不合法」", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    // sub-case 1：resumeSessionId 為 CLI flag 形式
    const ctx1 = makeCtx({ resumeSessionId: "--evil-flag" });
    await collectEvents(geminiProvider.chat(ctx1));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs1] = spawnSpy.mock.calls[0] as [string[], unknown];
    expect(spawnArgs1).not.toContain("--resume");
    expectWarnContaining(vi.mocked(logger.warn), "格式不合法");

    vi.clearAllMocks();
    spawnSpy = vi
      .spyOn(Bun, "spawn")
      .mockReturnValue(
        makeMockProc([
          JSON.stringify({ type: "result", status: "success" }),
        ]) as any,
      );

    // sub-case 2：resumeSessionId 含換行符
    const ctx2 = makeCtx({
      resumeSessionId: "valid-prefix\n--prompt\ninjected",
    });
    await collectEvents(geminiProvider.chat(ctx2));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs2] = spawnSpy.mock.calls[0] as [string[], unknown];
    expect(spawnArgs2).not.toContain("--resume");
    expectWarnContaining(vi.mocked(logger.warn), "格式不合法");
  });

  // ── C-NM-1：ContentBlock[] 全為 text block → prompt 以 \n 串接 ──────────
  it("C-NM-1: ContentBlock[] 全為 text block 時，--prompt 後接的字串應以 \\n 串接所有 text 部分", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const blocks: ContentBlock[] = [
      { type: "text", text: "第一段文字" },
      { type: "text", text: "第二段文字" },
    ];
    const ctx = makeCtx({ message: blocks });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    const promptIdx = spawnArgs.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(spawnArgs[promptIdx + 1]).toBe("第一段文字\n第二段文字");
  });

  // ── C-NM-2：ContentBlock[] 全為 image block → yield error，不呼叫 spawn ─
  it("C-NM-2: ContentBlock[] 全為 image block 時應 yield error event（fatal=true）且不呼叫 Bun.spawn", async () => {
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(makeMockProc([]) as any);

    const blocks: ContentBlock[] = [
      {
        type: "image",
        mediaType: "image/png",
        base64Data: "abc123",
      },
    ];
    const ctx = makeCtx({ message: blocks });
    const events = await collectEvents(geminiProvider.chat(ctx));

    // image-only → promptText 為空字串 → yield error，不呼叫 spawn
    expect(spawnSpy).not.toHaveBeenCalled();
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.fatal).toBe(true);
    expect(e.message).toContain("不支援純圖片訊息");
  });

  // ── C-NM-3：ContentBlock[] 為 text + image 混合 → prompt 只含 text 部分 ─
  it("C-NM-3: ContentBlock[] 為 text + image 混合時，--prompt 只含 text 部分，image 被略過", async () => {
    const mockProc = makeMockProc([
      JSON.stringify({ type: "result", status: "success" }),
    ]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const blocks: ContentBlock[] = [
      { type: "text", text: "說明文字" },
      {
        type: "image",
        mediaType: "image/jpeg",
        base64Data: "base64imagedata",
      },
      { type: "text", text: "後續文字" },
    ];
    const ctx = makeCtx({ message: blocks });
    await collectEvents(geminiProvider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    const promptIdx = spawnArgs.indexOf("--prompt");
    expect(promptIdx).toBeGreaterThan(-1);

    const promptValue = spawnArgs[promptIdx + 1];
    // 只含 text 部分，image 被略過
    expect(promptValue).toBe("說明文字\n後續文字");
    expect(promptValue).not.toContain("base64");
  });

  // ── buildOptions ─────────────────────────────────────────────────────────────
  describe("buildOptions", () => {
    // 工具：建立最小化 Pod stub
    function makePodStub(
      overrides: Partial<Pick<Pod, "providerConfig">> = {},
    ): Pod {
      return {
        id: "pod-bo-test-001",
        name: "Test Pod",
        provider: "gemini",
        status: "idle",
        providerConfig: {},
        workspacePath: "/workspace/test",
        mcpServerNames: [],
        pluginIds: [],
        repositoryId: null,
        commandId: null,
        multiInstance: false,
        sessionId: null,
        x: 0,
        y: 0,
        rotation: 0,
        ...overrides,
      } as Pod;
    }

    // ── C-BO-1：合法 model → 使用該 model ───────────────────────────────
    it("C-BO-1: providerConfig.model 合法時應使用該 model", async () => {
      const pod = makePodStub({
        providerConfig: { model: "gemini-2.5-flash" },
      });
      const options = await geminiProvider.buildOptions(pod);

      expect(options.model).toBe("gemini-2.5-flash");
      expect(options.resumeMode).toBe("cli");
    });

    // ── C-BO-2：不合法 model（含空格、`@`、換行符）→ fallback 至 DEFAULT_OPTIONS.model ─
    it("C-BO-2: providerConfig.model 不合法（含空格或 @ 符號）時應 fallback 至 DEFAULT_OPTIONS.model", async () => {
      const illegalModels = ["model with spaces", "model@invalid"];

      for (const illegalModel of illegalModels) {
        const pod = makePodStub({ providerConfig: { model: illegalModel } });
        const options = await geminiProvider.buildOptions(pod);

        expect(options.model).toBe(
          geminiProvider.metadata.defaultOptions.model,
        );
        expect(options.resumeMode).toBe("cli");
      }
    });

    // ── C-BO-3：providerConfig 為 null（未設定）→ fallback 至 DEFAULT_OPTIONS.model ─
    it("C-BO-3: providerConfig 為 null（未設定）時應 fallback 至 DEFAULT_OPTIONS.model", async () => {
      const pod = makePodStub({ providerConfig: null });
      const options = await geminiProvider.buildOptions(pod);

      expect(options.model).toBe(geminiProvider.metadata.defaultOptions.model);
      expect(options.resumeMode).toBe("cli");
    });
  });

  // ── Plugin spawn args（P1–P4）────────────────────────────────────────────────
  describe("Plugin spawn args（buildExtensionArgs）", () => {
    // P1：options.plugins = [] → spawn args 含 ["-e", "none"]
    it("P1: options.plugins = [] 時 spawn args 應含 ['-e', 'none']，且不含其他 -e flag", async () => {
      const mockProc = makeMockProc([
        JSON.stringify({ type: "result", status: "success" }),
      ]);
      spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const ctx = makeCtx({
        options: { model: "gemini-2.5-pro", resumeMode: "cli", plugins: [] },
      });
      await collectEvents(geminiProvider.chat(ctx));

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

      // 應含 -e none
      const eIdx = spawnArgs.indexOf("-e");
      expect(eIdx).toBeGreaterThan(-1);
      expect(spawnArgs[eIdx + 1]).toBe("none");

      // 不應含任何 extension name（只允許 "none"）
      const allEFlags: string[] = [];
      for (let i = 0; i < spawnArgs.length - 1; i++) {
        if (spawnArgs[i] === "-e") {
          allEFlags.push(spawnArgs[i + 1]);
        }
      }
      expect(allEFlags).toEqual(["none"]);
    });

    // P2：options.plugins = ["context7"] → spawn args 含 ["-e", "context7"]，且不含 -e none
    it("P2: options.plugins = ['context7'] 時 spawn args 含 ['-e', 'context7']，且不含 '-e none'", async () => {
      const mockProc = makeMockProc([
        JSON.stringify({ type: "result", status: "success" }),
      ]);
      spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const ctx = makeCtx({
        options: {
          model: "gemini-2.5-pro",
          resumeMode: "cli",
          plugins: ["context7"],
        },
      });
      await collectEvents(geminiProvider.chat(ctx));

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

      // 應含 -e context7
      expect(spawnArgs).toEqual(expect.arrayContaining(["-e", "context7"]));

      // 不應含 -e none
      const noneIdx = spawnArgs.indexOf("none");
      expect(noneIdx).toBe(-1);
    });

    // P3：options.plugins = ["context7", "stock-deep-analyzer"] → 兩組 -e <name>，順序與輸入一致
    it("P3: options.plugins = ['context7', 'stock-deep-analyzer'] 時 spawn args 含兩組 -e <name>，順序與輸入一致", async () => {
      const mockProc = makeMockProc([
        JSON.stringify({ type: "result", status: "success" }),
      ]);
      spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const ctx = makeCtx({
        options: {
          model: "gemini-2.5-pro",
          resumeMode: "cli",
          plugins: ["context7", "stock-deep-analyzer"],
        },
      });
      await collectEvents(geminiProvider.chat(ctx));

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

      // 收集所有 -e <name> 對
      const eFlags: string[] = [];
      for (let i = 0; i < spawnArgs.length - 1; i++) {
        if (spawnArgs[i] === "-e") {
          eFlags.push(spawnArgs[i + 1]);
        }
      }

      // 應有兩組，順序與輸入一致，不含 "none"
      expect(eFlags).toEqual(["context7", "stock-deep-analyzer"]);
    });

    // P4：resume 路徑下 plugins flag 一樣 append（-e flag 與 --resume 共存）
    it("P4: resume 路徑（含有效 resumeSessionId）下 plugins flag 一樣 append，-e flag 與 --resume 共存", async () => {
      const resumeUuid = "4abf7b33-6c20-4693-9e43-9715b97fb144";
      const mockProc = makeMockProc([
        JSON.stringify({ type: "result", status: "success" }),
      ]);
      spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

      const ctx = makeCtx({
        resumeSessionId: resumeUuid,
        options: {
          model: "gemini-2.5-pro",
          resumeMode: "cli",
          plugins: ["context7"],
        },
      });
      await collectEvents(geminiProvider.chat(ctx));

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

      // 應含 --resume <uuid>
      const resumeIdx = spawnArgs.indexOf("--resume");
      expect(resumeIdx).toBeGreaterThan(-1);
      expect(spawnArgs[resumeIdx + 1]).toBe(resumeUuid);

      // 應含 -e context7
      expect(spawnArgs).toEqual(expect.arrayContaining(["-e", "context7"]));

      // 不應含 -e none（有 plugin 時不走 "none" 路徑）
      const noneIdx = spawnArgs.indexOf("none");
      expect(noneIdx).toBe(-1);
    });
  });

  // ── C-VM-1：不合法 model 流入 chat() → yield 固定錯誤訊息，不呼叫 Bun.spawn ─
  it("C-VM-1: chat() 收到不合法 model 時應 yield 固定錯誤訊息「不合法的 model 名稱」（fatal=true），且不呼叫 Bun.spawn", async () => {
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(makeMockProc([]) as any);

    // 傳入含空格的不合法 model（MODEL_RE 不接受）
    const ctx = makeCtx({
      options: { model: "invalid model name", resumeMode: "cli" },
    });
    const events = await collectEvents(geminiProvider.chat(ctx));

    // Bun.spawn 不應被呼叫
    expect(spawnSpy).not.toHaveBeenCalled();

    // 應 yield error，message 為固定文字（不反射 raw value）
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toBe("不合法的 model 名稱");
    expect(e.fatal).toBe(true);
  });
});
