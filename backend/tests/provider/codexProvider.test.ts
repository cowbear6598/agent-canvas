/**
 * CodexProvider 單元測試
 *
 * 測試 CodexProvider.chat() 的各種行為：
 * - 新對話 / resume 的 spawn 指令
 * - abortSignal 觸發後 kill subprocess
 * - spawn ENOENT 時推出 error event
 * - stdout JSON line 解析
 * - exit code 非 0 且無 turn_complete 時推出 error event
 * - ctx.options.model 被正確傳入 --model 旗標
 *
 * Mock 方法：vi.spyOn(Bun, "spawn") 替換 Bun.spawn（Bun 全域不可重新賦值，
 * 但 Bun.spawn 屬性是 writable，可透過 spyOn 攔截）
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import type { CodexOptions } from "../../src/services/provider/codexProvider.js";

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

// ── 建立通用 ChatRequestContext ──────────────────────────────────────────
function makeCtx(
  overrides: Partial<{
    podId: string;
    message: string;
    workspacePath: string;
    resumeSessionId: string | null;
    abortSignal: AbortSignal;
    options: CodexOptions;
  }> = {},
) {
  const defaultOptions: CodexOptions = {
    model: "gpt-5.4",
    resumeMode: "cli",
  };
  return {
    podId: "pod-test-001",
    message: "Hello, Codex!",
    workspacePath: "/workspace/test",
    resumeSessionId: null,
    abortSignal: new AbortController().signal,
    options: defaultOptions,
    ...overrides,
  };
}

// ── 匯入 CodexProvider（在 mock 設定後匯入，確保使用 mocked logger） ────
import { CodexProvider } from "../../src/services/provider/codexProvider.js";

describe("CodexProvider", () => {
  // spawnSpy 在每個 test 中設定
  let spawnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Case 1：首次對話 spawn 指令 ───────────────────────────────────
  it("首次對話時 spawn 指令應包含 --json --skip-git-repo-check --cd <workspacePath> --full-auto -c sandbox_workspace_write.network_access=true --model <model>", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({
      resumeSessionId: null,
      options: { model: "gpt-4o", resumeMode: "cli" },
    });

    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    expect(spawnArgs).toEqual([
      "codex",
      "exec",
      "-",
      "--json",
      "--skip-git-repo-check",
      "--cd",
      ctx.workspacePath,
      "--full-auto",
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--model",
      "gpt-4o",
    ]);
  });

  // ── Case 2：resume 時 spawn 指令包含 resume <id> ───────────────────
  it("resumeSessionId 存在時 spawn 指令應包含 exec resume <id> - --json --cd <workspacePath> --full-auto -c sandbox_workspace_write.network_access=true", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ resumeSessionId: "session-abc123" });

    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    expect(spawnArgs).toEqual([
      "codex",
      "exec",
      "resume",
      "session-abc123",
      "-",
      "--json",
      "--cd",
      ctx.workspacePath,
      "--full-auto",
      "-c",
      "sandbox_workspace_write.network_access=true",
    ]);
  });

  // ── Case 3：abortSignal 觸發後 subprocess.kill() 被呼叫 ───────────
  it("abortSignal 觸發後應呼叫 subprocess.kill()", async () => {
    const ac = new AbortController();
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ abortSignal: ac.signal });

    // 在 collectEvents 之前先 abort，確保 onAbort 邏輯會被觸發
    ac.abort();

    await collectEvents(provider.chat(ctx));

    // abortSignal 已在 spawn 前觸發，應呼叫 kill
    expect(mockProc.kill).toHaveBeenCalled();
  });

  // ── Case 4：spawn 失敗（ENOENT）→ error event，message 含「codex CLI 尚未安裝」，fatal=true ──
  it("Bun.spawn 拋出 ENOENT 錯誤時應推出 error event，訊息含「codex CLI 尚未安裝」，fatal=true", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: spawn codex"), {
      code: "ENOENT",
    });
    spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      throw enoentErr;
    });

    const provider = new CodexProvider();
    const events = await collectEvents(provider.chat(makeCtx()));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const e = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.message).toContain("codex CLI 尚未安裝");
    expect(e.fatal).toBe(true);
  });

  // ── Case 5：stdout JSON line 解析 ─────────────────────────────────
  it("stdout 的 JSON line 應被正確解析為對應的 NormalizedEvent", async () => {
    const stdoutLines = [
      JSON.stringify({ type: "thread.started", thread_id: "thr-001" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item-1", type: "agent_message", text: "Hi there" },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ];

    const mockProc = makeMockProc(stdoutLines);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const events = await collectEvents(provider.chat(makeCtx()));

    expect(events).toHaveLength(3);

    // session_started
    expect(events[0].type).toBe("session_started");
    expect(
      (events[0] as Extract<NormalizedEvent, { type: "session_started" }>)
        .sessionId,
    ).toBe("thr-001");

    // text
    expect(events[1].type).toBe("text");
    expect(
      (events[1] as Extract<NormalizedEvent, { type: "text" }>).content,
    ).toBe("Hi there");

    // turn_complete
    expect(events[2].type).toBe("turn_complete");
  });

  // ── Case 6：exit code 非 0 且未發 turn_complete → error event ──────
  it("exit code 非 0 且無 turn_complete 時應推出 error event", async () => {
    const mockProc = makeMockProc([], ["some stderr output"], 1);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const events = await collectEvents(provider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);

    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    // exit code 細節只寫 server log，前端顯示使用者友善訊息
    expect(e.message).toContain("執行發生錯誤");
    // 執行時錯誤 fatal=false（非 spawn 失敗）
    expect(e.fatal).toBe(false);
  });

  // ── 補充：exit code 非 0 但已發 turn_complete → 不推 error event ───
  it("exit code 非 0 但已發 turn_complete 時，不應額外推出 error event", async () => {
    const mockProc = makeMockProc(
      [JSON.stringify({ type: "turn.completed" })],
      [],
      1,
    );
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const events = await collectEvents(provider.chat(makeCtx()));

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(0);
    expect(events.some((e) => e.type === "turn_complete")).toBe(true);
  });

  // ── 補充：model 預設值 ────────────────────────────────────────────
  it("ctx.options.model 應被正確傳入 --model 旗標", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    // 帶入 options.model = "gpt-5.4-pro"
    const ctx = makeCtx({
      options: { model: "gpt-5.4-pro", resumeMode: "cli" },
    });
    await collectEvents(provider.chat(ctx));

    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    // --model 應存在且其後跟著指定的模型名稱
    const modelIdx = spawnArgs.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(spawnArgs[modelIdx + 1]).toBe("gpt-5.4-pro");
  });

  // ── 補充：resumeSessionId 格式不合法 → 改走新對話 ───────────────────
  it("resumeSessionId 含非法字元時應改走新對話模式，spawn 指令含 --skip-git-repo-check", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    // 含空格和特殊字元，格式不合法
    const ctx = makeCtx({ resumeSessionId: "invalid session id!" });
    await collectEvents(provider.chat(ctx));

    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    // 不應含 resume
    expect(spawnArgs).not.toContain("resume");
    // 應走新對話流程
    expect(spawnArgs).toContain("--skip-git-repo-check");
  });

  // ── 補充：spawn cwd 與 --cd 路徑必須一致 ─────────────────────────
  it("spawn 的 cwd 與 args 中 --cd 後一個元素必須相同", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ resumeSessionId: null });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs, spawnOptions] = spawnSpy.mock.calls[0] as [
      string[],
      { cwd?: string },
    ];

    const cdIdx = spawnArgs.indexOf("--cd");
    expect(cdIdx).toBeGreaterThan(-1);
    const cdPath = spawnArgs[cdIdx + 1];
    expect(cdPath).toBe(spawnOptions.cwd);
  });

  // ── 補充：args 不含 -c sandbox_workspace_write.writable_roots（負面斷言）
  it("Codex 在綁定 Repository 時，args 中不包含 -c sandbox_workspace_write.writable_roots", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({
      workspacePath: "/repos/my-repo",
      resumeSessionId: null,
    });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // args 不應包含 writable_roots 設定（Codex 使用 network_access=true 但不限制 writable_roots）
    const hasWritableRoots = spawnArgs.some((arg) =>
      arg.includes("writable_roots"),
    );
    expect(hasWritableRoots).toBe(false);
  });
});
