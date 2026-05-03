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
 * - MCP server auto-approve 旗標注入（新對話 & resume）
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

// ── codexMcpReader mock（預設回傳空陣列，各測試可覆寫） ────────────────
vi.mock("../../src/services/mcp/codexMcpReader.js", () => ({
  readCodexMcpServers: vi.fn().mockReturnValue([]),
}));

import { readCodexMcpServers } from "../../src/services/mcp/codexMcpReader.js";

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
  it("首次對話時 spawn 指令應包含必要的 CLI 參數（--json、--cd、--full-auto、--model 等）", async () => {
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

  // ── Case 2：resume 時 spawn 指令包含 resume <id>，不含 --cd ─────────
  // `codex exec resume` 不接受 --cd flag（會導致 "unexpected argument" 錯誤），
  // 工作目錄改由 Bun.spawn cwd 定錨。
  it("resumeSessionId 存在時 spawn 指令應包含 exec resume <id> 及必要的 CLI 參數，且不含 --cd", async () => {
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
      "--full-auto",
      "-c",
      "sandbox_workspace_write.network_access=true",
    ]);
    // resume 模式不應含 --cd（codex exec resume 不接受此 flag）
    expect(spawnArgs).not.toContain("--cd");
    // resume 模式由 session 決定 model，不應含 --model 旗標
    expect(spawnArgs).not.toContain("--model");
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

  // ── 回歸：normalizer fatal=true 後主迴圈 break，generator 不再 yield EXIT_CODE 多餘訊息 ─
  it("type=error stream event + exit code 1，主迴圈 break 後應只有一個 STREAM_ERROR error event，不再 yield EXIT_CODE", async () => {
    // 先吐 stream-level error（normalizer 標 fatal=true），子程序再以 exit code 1 退出
    const stdoutLines = [
      JSON.stringify({ type: "error", message: "usage limit exceeded" }),
    ];
    const mockProc = makeMockProc(stdoutLines, [], 1);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();

    // 模擬 streamingChatExecutor 主迴圈：收到 fatal=true 後 break，generator 被 return
    const collected: NormalizedEvent[] = [];
    for await (const ev of provider.chat(makeCtx())) {
      collected.push(ev);
      if (ev.type === "error" && ev.fatal) {
        break;
      }
    }

    const errorEvents = collected.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    const e = errorEvents[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.fatal).toBe(true);
    expect(e.systemMessage?.metadata.code).toBe("STREAM_ERROR");
    expect(e.message).toBe("usage limit exceeded");
    // 確保沒有 EXIT_CODE 訊息（不會 fall through 到 handleExitCode）
    const hasExitCode = errorEvents.some(
      (ev) =>
        (ev as Extract<NormalizedEvent, { type: "error" }>).systemMessage
          ?.metadata.code === "EXIT_CODE",
    );
    expect(hasExitCode).toBe(false);
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

  // ── 補充：新對話 spawn cwd 與 --cd 路徑必須一致 ──────────────────
  it("新對話時 spawn 的 cwd 與 args 中 --cd 後一個元素必須相同", async () => {
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

  // ── 補充：resume 模式 spawn cwd 由 Bun.spawn cwd 定錨，args 不含 --cd ──
  // `codex exec resume` 不接受 --cd flag，工作目錄僅靠 Bun.spawn cwd 定錨。
  it("resume 模式時 spawn cwd 應設為 workspacePath，且 args 不含 --cd", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ resumeSessionId: "session-xyz" });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs, spawnOptions] = spawnSpy.mock.calls[0] as [
      string[],
      { cwd?: string },
    ];

    // cwd 必須是 workspacePath
    expect(spawnOptions.cwd).toBe(ctx.workspacePath);
    // resume args 不含 --cd
    expect(spawnArgs).not.toContain("--cd");
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

  // ── MCP auto-approve：新對話 args 包含每個 MCP server 的 default_tools_approval_mode=approve ──
  it("新對話時 args 應包含每個 MCP server 的 default_tools_approval_mode=approve 旗標", async () => {
    // mock readCodexMcpServers 回傳兩個 server
    vi.mocked(readCodexMcpServers).mockReturnValue([
      { name: "figma", type: "http" },
      { name: "context7", type: "stdio" },
    ]);

    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ resumeSessionId: null });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // 應包含 figma 的 auto-approve 旗標
    const figmaIdx = spawnArgs.indexOf(
      "mcp_servers.figma.default_tools_approval_mode=approve",
    );
    expect(figmaIdx).toBeGreaterThan(-1);
    expect(spawnArgs[figmaIdx - 1]).toBe("-c");

    // 應包含 context7 的 auto-approve 旗標
    const context7Idx = spawnArgs.indexOf(
      "mcp_servers.context7.default_tools_approval_mode=approve",
    );
    expect(context7Idx).toBeGreaterThan(-1);
    expect(spawnArgs[context7Idx - 1]).toBe("-c");
  });

  // ── MCP auto-approve：resume args 同樣包含每個 MCP server 的 auto-approve 旗標 ──
  it("resume 時 args 應包含每個 MCP server 的 default_tools_approval_mode=approve 旗標", async () => {
    // mock readCodexMcpServers 回傳一個 server
    vi.mocked(readCodexMcpServers).mockReturnValue([
      { name: "my-mcp", type: "stdio" },
    ]);

    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ resumeSessionId: "session-abc123" });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // 應包含 my-mcp 的 auto-approve 旗標
    const mcpIdx = spawnArgs.indexOf(
      "mcp_servers.my-mcp.default_tools_approval_mode=approve",
    );
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(spawnArgs[mcpIdx - 1]).toBe("-c");

    // resume 模式不含 --cd
    expect(spawnArgs).not.toContain("--cd");
  });

  // ── 補充：model 不合法時 prepareExecution 直接 yield error，不走 spawn / readCodexMcpServers ──
  it("不合法 model 傳入時 readCodexMcpServers 不應被呼叫（prepareExecution 提早回傳 null）", async () => {
    // 重置 readCodexMcpServers spy，確保呼叫次數從 0 開始
    vi.mocked(readCodexMcpServers).mockClear();
    // 不設定 spawnSpy：若走到 spawn 會使用真實 Bun.spawn（但 prepareExecution 失敗應在此之前 return）

    const provider = new CodexProvider();
    // 含空格的 model 名稱不合法（不通過 MODEL_RE）
    const ctx = makeCtx({
      options: { model: "invalid model name!", resumeMode: "cli" },
    });

    const events = await collectEvents(provider.chat(ctx));

    // 應 yield 一個 error event
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    const e = events[0] as Extract<NormalizedEvent, { type: "error" }>;
    expect(e.fatal).toBe(true);

    // prepareExecution 失敗後應提早 return，不走 readCodexMcpServers
    expect(readCodexMcpServers).not.toHaveBeenCalled();
  });

  // ── [B15] 新對話 + thinkingLevel：args 應含 -c model_reasoning_effort=<level> ──
  it("[B15] 新對話 + options.thinkingLevel=high 時，args 應含 -c model_reasoning_effort=high", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({
      resumeSessionId: null,
      options: { model: "gpt-5.5", resumeMode: "cli", thinkingLevel: "high" },
    });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    const idx = spawnArgs.indexOf("model_reasoning_effort=high");
    expect(idx).toBeGreaterThan(-1);
    expect(spawnArgs[idx - 1]).toBe("-c");
  });

  // ── [B16] resume 模式 + thinkingLevel：args 應含 -c model_reasoning_effort=<level> ──
  it("[B16] resume 模式 + options.thinkingLevel=xhigh 時，args 應含 -c model_reasoning_effort=xhigh", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({
      resumeSessionId: "session-thinking-xyz",
      options: { model: "gpt-5.5", resumeMode: "cli", thinkingLevel: "xhigh" },
    });
    await collectEvents(provider.chat(ctx));

    expect(spawnSpy).toHaveBeenCalledOnce();
    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];

    // resume args 應含 model_reasoning_effort=xhigh，且不含 --cd
    const idx = spawnArgs.indexOf("model_reasoning_effort=xhigh");
    expect(idx).toBeGreaterThan(-1);
    expect(spawnArgs[idx - 1]).toBe("-c");
    expect(spawnArgs).not.toContain("--cd");
  });

  // ── [B17] 無 thinkingLevel 時：args 不應含 model_reasoning_effort ──
  it("[B17] options.thinkingLevel 未提供時，args 不應含 model_reasoning_effort 旗標", async () => {
    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    // 預設 options 不含 thinkingLevel
    const ctx = makeCtx({
      resumeSessionId: null,
      options: { model: "gpt-5.5", resumeMode: "cli" },
    });
    await collectEvents(provider.chat(ctx));

    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    const hasReasoningFlag = spawnArgs.some((arg) =>
      arg.startsWith("model_reasoning_effort"),
    );
    expect(hasReasoningFlag).toBe(false);
  });

  // ── MCP auto-approve：無 MCP server 時 args 不含 default_tools_approval_mode ──
  it("無 MCP server 時 args 不應含任何 default_tools_approval_mode 旗標", async () => {
    // readCodexMcpServers 預設 mock 回傳空陣列
    vi.mocked(readCodexMcpServers).mockReturnValue([]);

    const mockProc = makeMockProc([JSON.stringify({ type: "turn.completed" })]);
    spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue(mockProc as any);

    const provider = new CodexProvider();
    const ctx = makeCtx({ resumeSessionId: null });
    await collectEvents(provider.chat(ctx));

    const [spawnArgs] = spawnSpy.mock.calls[0] as [string[], unknown];
    const hasApproveFlag = spawnArgs.some((arg) =>
      arg.includes("default_tools_approval_mode"),
    );
    expect(hasApproveFlag).toBe(false);
  });
});
