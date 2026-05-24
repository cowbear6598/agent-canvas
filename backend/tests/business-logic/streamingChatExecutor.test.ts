/**
 * streamingChatExecutor 單元測試（Phase 5B 後）
 *
 * 保留合理 boundary mock：
 *   - getProvider（SDK boundary：Claude/Codex provider）
 *   - logger（side-effect only）
 * 移除 store / service mock，改用 initTestDb + 真實 store + vi.spyOn 觀察呼叫。
 */

import path from "path";
import { randomUUID } from "crypto";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// SDK boundary mock（保留：getProvider 是外部 SDK 邊界；providerRegistry 保留真實值供 resolveProvider 使用）
// metadata 必須一起提供，否則 providerConfigResolver.warnIfModelOutOfRange / ensureModelField
// 在 buildPodFromRow 讀取路徑上也會呼叫 getProvider(provider).metadata 而丟出 TypeError
vi.mock("../../src/services/provider/index.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/provider/index.js")
  >("../../src/services/provider/index.js");
  return {
    ...actual,
    getProvider: vi.fn(() => ({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
      metadata: {
        availableModelValues: new Set(["opus", "sonnet", "haiku"]),
        defaultOptions: { model: "opus" },
        availableModels: [
          { label: "Opus", value: "opus" },
          { label: "Sonnet", value: "sonnet" },
          { label: "Haiku", value: "haiku" },
        ],
      },
    })),
  };
});

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  },
}));

import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { executeStreamingChat } from "../../src/services/claude/streamingChatExecutor.js";
import { socketService } from "../../src/services/socketService.js";
import { podStore } from "../../src/services/podStore.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { WebSocketResponseEvents } from "../../src/schemas";
import { AbortError } from "@anthropic-ai/claude-agent-sdk";
import { ChatExecutionStrategy } from "../../src/services/executionStrategy.js";
import type { RunContext } from "../../src/types/run.js";
import { getProvider } from "../../src/services/provider/index.js";
import type { NormalizedEvent } from "../../src/services/provider/types.js";
import { abortRegistry } from "../../src/services/provider/abortRegistry.js";
import { config } from "../../src/config/index.js";
import { logger } from "../../src/utils/logger.js";
import {
  ensureGoalRuntime,
  getGoalRuntimeStatePath,
  GOAL_MCP_SERVER_NAME,
  readGoalRuntimeSnapshot,
  removeGoalRuntimeRun,
} from "../../src/services/goalRuntime.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

async function* makeEventStream(events: Array<NormalizedEvent>) {
  for (const ev of events) {
    yield ev;
  }
}

function setupProviderMock(events: Array<NormalizedEvent>) {
  const chatMock = vi.fn(() => makeEventStream(events));
  // metadata 必須一起提供，否則 providerConfigResolver（buildPodFromRow 讀取路徑）
  // 呼叫 getProvider(provider).metadata 會拋出 TypeError
  asMock(getProvider).mockReturnValue({
    chat: chatMock,
    cancel: vi.fn(() => false),
    buildOptions: vi.fn().mockResolvedValue({}),
    metadata: {
      availableModelValues: new Set(["opus", "sonnet", "haiku"]),
      defaultOptions: { model: "opus" },
      availableModels: [
        { label: "Opus", value: "opus" },
        { label: "Sonnet", value: "sonnet" },
        { label: "Haiku", value: "haiku" },
      ],
    },
  });
  return { chatMock };
}

// --- DB helpers ---

const CANVAS_ID = "test-canvas";
const POD_ID = "test-pod";

/** 清除 podStore 內部動態 PreparedStatement LRU 快取，防止跨測試 DB 污染 */
function clearPodStoreCache(): void {
  podStore.__clearCacheForTesting();
}

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, `canvas-${CANVAS_ID}`, 0);
}

/**
 * 直接用 SQL 插入 pod，繞過 sanitizeProviderConfigStrict 對 getProvider.metadata 的依賴。
 * workspacePath 預設在 canvasRoot/CANVAS_ID 之下，確保 resolvePodCwd 路徑驗證通過。
 */
function insertPodViaSQL(opts: {
  provider: "claude" | "codex";
  providerConfigJson?: string;
  workspacePath?: string;
  repositoryId?: string | null;
  goalJson?: string | null;
}) {
  const id = randomUUID();
  const workspacePath =
    opts.workspacePath ?? path.join(config.canvasRoot, CANVAS_ID, `pod-${id}`);
  getDb()
    .prepare(
      `INSERT INTO pods (id, canvas_id, name, x, y, rotation, workspace_path,
       session_id, repository_id, goal_json,
       schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, 0, 0, 0, ?, NULL, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      CANVAS_ID,
      `${opts.provider}-pod-${id.slice(0, 8)}`,
      workspacePath,
      opts.repositoryId ?? null,
      opts.goalJson ?? null,
      opts.provider,
      opts.providerConfigJson ??
        (opts.provider === "claude" ? JSON.stringify({ model: "opus" }) : null),
    );
  // 回傳最精簡的 pod 結構（getByIdGlobal 需要的欄位）
  return podStore.getByIdGlobal(id)!.pod;
}

function insertClaudePod(
  overrides: {
    workspacePath?: string;
    repositoryId?: string;
    goal?: { todos: Array<{ id: string; text: string }> };
  } = {},
) {
  return insertPodViaSQL({
    provider: "claude",
    workspacePath: overrides.workspacePath,
    repositoryId: overrides.repositoryId,
    goalJson: overrides.goal ? JSON.stringify(overrides.goal) : null,
  });
}

function insertCodexPod() {
  return insertPodViaSQL({
    provider: "codex",
    providerConfigJson: null as unknown as undefined,
  });
}

describe("executeStreamingChat", () => {
  const canvasId = CANVAS_ID;
  const message = "test message";

  const defaultRunContext: RunContext = {
    runId: "default-run-id",
    canvasId,
    sourcePodId: "default-source-pod",
  };

  function makeStrategy() {
    return new ChatExecutionStrategy(canvasId, defaultRunContext);
  }

  beforeEach(() => {
    closeDb();
    clearPodStoreCache();
    resetStatements();
    initTestDb();
    insertCanvas();

    // spyOn store methods（保留真實邏輯，只觀察呼叫）
    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});
    vi.spyOn(runExecutionService, "registerActiveStream").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "unregisterActiveStream").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "errorPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
    // persistMessage / injectRunUserMessage 會先 getRun 檢查是否 cancelled；
    // 測試環境 mock 為 running run，避免 guard 直接 early return
    vi.spyOn(runStore, "getRun").mockReturnValue({
      status: "running",
    } as ReturnType<typeof runStore.getRun>);
    vi.spyOn(runStore, "upsertRunMessage").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceSessionId").mockImplementation(
      () => {},
    );
    // gate retry 會透過 strategy.addUserMessage → injectRunUserMessage 寫 run message；
    // 測試環境沒有對應的 run row，直接 spy 掉避免 FK 錯誤。
    vi.spyOn(runStore, "addRunMessage").mockImplementation(
      (_runId, _podId, role, content) => ({
        id: "mock-run-message-id",
        role,
        content,
        timestamp: new Date().toISOString(),
      }),
    );

    asMock(getProvider).mockClear();
    // metadata 必須一起提供，否則 providerConfigResolver（buildPodFromRow 讀取路徑）
    // 呼叫 getProvider(provider).metadata 會拋出 TypeError
    asMock(getProvider).mockReturnValue({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
      metadata: {
        availableModelValues: new Set(["opus", "sonnet", "haiku"]),
        defaultOptions: { model: "opus" },
        availableModels: [
          { label: "Opus", value: "opus" },
          { label: "Sonnet", value: "sonnet" },
          { label: "Haiku", value: "haiku" },
        ],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    clearPodStoreCache();
    removeGoalRuntimeRun(defaultRunContext.runId);
  });

  describe("streaming event 處理（Claude 路徑）", () => {
    it("text event 正確累積內容並廣播 POD_CLAUDE_CHAT_MESSAGE", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // 2 text + 1 complete = 3 次廣播
      expect(socketService.emitToCanvas).toHaveBeenCalledTimes(3);
      expect(socketService.emitToCanvas).toHaveBeenNthCalledWith(
        1,
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          canvasId,
          podId: pod.id,
          content: "Hello",
          isPartial: true,
          role: "assistant",
        }),
      );
      expect(socketService.emitToCanvas).toHaveBeenNthCalledWith(
        2,
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          content: "Hello World",
          isPartial: true,
        }),
      );
      expect(result.content).toBe("Hello World");
      expect(result.hasContent).toBe(true);
      expect(result.aborted).toBe(false);
    });

    it.each([
      {
        label: "tool_call_start 廣播 POD_CHAT_TOOL_USE",
        events: [
          {
            type: "tool_call_start" as const,
            toolUseId: "tu1",
            toolName: "Read",
            input: { path: "/test" },
          },
          { type: "turn_complete" as const },
        ],
        expectedEvent: WebSocketResponseEvents.RUN_CHAT_TOOL_USE,
        expectedPayload: {
          toolUseId: "tu1",
          toolName: "Read",
          input: { path: "/test" },
        },
      },
      {
        label: "tool_call_result 廣播 POD_CHAT_TOOL_RESULT",
        events: [
          {
            type: "tool_call_start" as const,
            toolUseId: "tu1",
            toolName: "Read",
            input: {},
          },
          {
            type: "tool_call_result" as const,
            toolUseId: "tu1",
            toolName: "Read",
            output: "file content",
          },
          { type: "turn_complete" as const },
        ],
        expectedEvent: WebSocketResponseEvents.RUN_CHAT_TOOL_RESULT,
        expectedPayload: { toolUseId: "tu1", output: "file content" },
      },
    ])("$label", async ({ events, expectedEvent, expectedPayload }) => {
      const pod = insertClaudePod();
      setupProviderMock(events);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        expectedEvent,
        expect.objectContaining({
          canvasId,
          podId: pod.id,
          ...expectedPayload,
        }),
      );
    });

    it("turn_complete 廣播 POD_CHAT_COMPLETE", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_CHAT_COMPLETE,
        expect.objectContaining({
          canvasId,
          podId: pod.id,
          fullContent: "Hello",
        }),
      );
    });

    it("error event（fatal=true）寫入 system message 並中止串流，但不 throw", async () => {
      const pod = insertClaudePod();
      const collectedPayloads: unknown[] = [];
      vi.spyOn(socketService, "emitToCanvas").mockImplementation(
        (_cId: string, _event: string, payload: unknown) => {
          collectedPayloads.push(payload);
        },
      );

      setupProviderMock([
        { type: "error", message: "某致命錯誤", fatal: true },
        // 後續事件不應被處理（fatal 中止後續 event 處理）
        { type: "text", content: "不應出現" },
        { type: "turn_complete" },
      ]);

      // 不再 throw：transcript 系統訊息寫入後走正常 finalize 收尾
      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);

      // system message 已寫入該 pod transcript（podId 正確）
      const systemPayloads = collectedPayloads.filter(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "role" in p &&
          (p as { role?: string }).role === "system" &&
          "podId" in p &&
          (p as { podId?: string }).podId === pod.id &&
          "content" in p &&
          typeof (p as { content: unknown }).content === "string" &&
          (p as { content: string }).content.includes("某致命錯誤"),
      );
      expect(systemPayloads.length).toBeGreaterThan(0);

      // 後續 text/turn_complete 不應被處理（沒有 "不應出現" 文字 broadcast）
      const hasUnexpectedText = collectedPayloads.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "content" in p &&
          typeof (p as { content: unknown }).content === "string" &&
          (p as { content: string }).content.includes("不應出現"),
      );
      expect(hasUnexpectedText).toBe(false);
    });

    it("error event（fatal=false）不拋出、繼續消費後續事件", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "error", message: "某警告", fatal: false },
        { type: "text", content: "後續文字" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(result.content).toContain("後續文字");
    });
  });

  describe("成功完成", () => {
    it("完成後正確呼叫 onComplete callback", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Hello" },
        { type: "turn_complete" },
      ]);

      const onComplete = vi.fn(() => {});
      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        { onComplete },
      );

      expect(onComplete).toHaveBeenCalledWith(canvasId, pod.id);
    });
  });

  describe("Goal Runtime event handling", () => {
    it("Goal MCP tool result 應更新 runtime snapshot 與 handoff summary", async () => {
      const goal = {
        todos: [
          { id: "todo-1", text: "Inspect current task state" },
          { id: "todo-2", text: "Complete remaining work" },
        ],
      };
      const pod = insertClaudePod({ goal });

      expect(ensureGoalRuntime(pod, defaultRunContext)).not.toBeNull();

      // 兩個 todo 都在同一輪內被回報完成，gate 直接 proceed，不會 retry
      setupProviderMock([
        {
          type: "tool_call_result",
          toolUseId: "goal-tool-1",
          toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
          output: JSON.stringify({
            status: "running",
            activeTodoId: "todo-2",
            activeTodoText: "Complete remaining work",
            nextTodoId: "todo-2",
            nextTodoText: "Complete remaining work",
            completedTodoIds: ["todo-1"],
            blockedReason: null,
            handoffSummary: "First task completed",
            completedCount: 1,
            totalCount: 2,
          }),
        },
        {
          type: "tool_call_result",
          toolUseId: "goal-tool-2",
          toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
          output: JSON.stringify({
            status: "completed",
            activeTodoId: null,
            activeTodoText: null,
            nextTodoId: null,
            nextTodoText: null,
            completedTodoIds: ["todo-1", "todo-2"],
            blockedReason: null,
            handoffSummary: "All tasks done",
            completedCount: 2,
            totalCount: 2,
          }),
        },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      const snapshot = readGoalRuntimeSnapshot(
        getGoalRuntimeStatePath(defaultRunContext, pod.id),
      );

      expect(snapshot?.state.status).toBe("completed");
      expect(snapshot?.state.activeTodoId).toBeNull();
      expect(snapshot?.state.completedTodoIds).toEqual(["todo-1", "todo-2"]);
      expect(snapshot?.state.handoffSummary).toBe("All tasks done");
    });

    it("Goal gate 放行後應產生並廣播 Goal round divider", async () => {
      const goal = {
        todos: [{ id: "todo-1", text: "完成本輪" }],
      };
      const pod = insertClaudePod({ goal });
      ensureGoalRuntime(pod, defaultRunContext);
      const dividerSpy = vi
        .spyOn(runStore, "addRunGoalRoundDivider")
        .mockImplementation((input) => ({
          type: "goal-round-divider",
          id: "divider-1",
          runId: input.runId,
          podId: input.podId,
          sourcePodIds: input.sourcePodIds,
          sourcePodNames: input.sourcePodNames,
          status: input.status,
          blockedReason: input.blockedReason ?? null,
          completedAt: "2026-05-24T10:00:00.000Z",
          connectionIds: input.connectionIds,
        }));

      setupProviderMock([
        {
          type: "tool_call_result",
          toolUseId: "goal-tool-1",
          toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
          output: JSON.stringify({
            status: "completed",
            activeTodoId: null,
            activeTodoText: null,
            nextTodoId: null,
            nextTodoText: null,
            completedTodoIds: ["todo-1"],
            blockedReason: null,
            handoffSummary: "完成本輪",
            completedCount: 1,
            totalCount: 1,
          }),
        },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
        goalRoundDivider: {
          sourcePodIds: ["source-1"],
          sourcePodNames: ["來源 Pod"],
          connectionIds: ["conn-1"],
        },
      });

      expect(dividerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: defaultRunContext.runId,
          podId: pod.id,
          sourcePodIds: ["source-1"],
          sourcePodNames: ["來源 Pod"],
          status: "completed",
          blockedReason: null,
          connectionIds: ["conn-1"],
        }),
      );
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_GOAL_ROUND_DIVIDER,
        expect.objectContaining({
          type: "goal-round-divider",
          runId: defaultRunContext.runId,
          canvasId,
          podId: pod.id,
          sourcePodNames: ["來源 Pod"],
          status: "completed",
          connectionIds: ["conn-1"],
        }),
      );
    });

    it("Goal round divider 持久化與廣播完成後才呼叫下游完成 callback", async () => {
      const order: string[] = [];
      const goal = {
        todos: [{ id: "todo-1", text: "完成本輪" }],
      };
      const pod = insertClaudePod({ goal });
      ensureGoalRuntime(pod, defaultRunContext);

      vi.spyOn(runStore, "addRunGoalRoundDivider").mockImplementation(
        (input) => {
          order.push("divider:persist");
          return {
            type: "goal-round-divider",
            id: "divider-1",
            runId: input.runId,
            podId: input.podId,
            sourcePodIds: input.sourcePodIds,
            sourcePodNames: input.sourcePodNames,
            status: input.status,
            blockedReason: input.blockedReason ?? null,
            completedAt: "2026-05-24T10:00:00.000Z",
            connectionIds: input.connectionIds,
          };
        },
      );
      vi.mocked(socketService.emitToCanvas).mockImplementation(
        (_canvasId, event) => {
          if (event === WebSocketResponseEvents.RUN_GOAL_ROUND_DIVIDER) {
            order.push("divider:broadcast");
          }
        },
      );

      setupProviderMock([
        {
          type: "tool_call_result",
          toolUseId: "goal-tool-1",
          toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
          output: JSON.stringify({
            status: "completed",
            activeTodoId: null,
            activeTodoText: null,
            nextTodoId: null,
            nextTodoText: null,
            completedTodoIds: ["todo-1"],
            blockedReason: null,
            handoffSummary: "完成本輪",
            completedCount: 1,
            totalCount: 1,
          }),
        },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
          goalRoundDivider: {
            sourcePodIds: ["source-1"],
            sourcePodNames: ["來源 Pod"],
            connectionIds: ["conn-1"],
          },
        },
        {
          onComplete: vi.fn(() => {
            order.push("downstream");
          }),
        },
      );

      expect(order).toEqual([
        "divider:persist",
        "divider:broadcast",
        "downstream",
      ]);
    });

    it.each([
      {
        status: "completed" as const,
        toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
        blockedReason: null,
        handoffSummary: "完成本輪",
      },
      {
        status: "blocked" as const,
        toolName: `mcp__${GOAL_MCP_SERVER_NAME}__block_goal_progress`,
        blockedReason: "等待人工確認",
        handoffSummary: "需要人工確認",
      },
    ])(
      "Goal $status 會產生 divider、觸發下游，再 dequeue 下一個 connection item",
      async ({ status, toolName, blockedReason, handoffSummary }) => {
        const order: string[] = [];
        const goal = {
          todos: [{ id: "todo-1", text: "完成本輪" }],
        };
        const pod = insertClaudePod({ goal });
        ensureGoalRuntime(pod, defaultRunContext);

        vi.spyOn(runStore, "addRunGoalRoundDivider").mockImplementation(
          (input) => {
            order.push(`divider:${input.status}:persist`);
            return {
              type: "goal-round-divider",
              id: `divider-${input.status}`,
              runId: input.runId,
              podId: input.podId,
              sourcePodIds: input.sourcePodIds,
              sourcePodNames: input.sourcePodNames,
              status: input.status,
              blockedReason: input.blockedReason ?? null,
              completedAt: "2026-05-24T10:00:00.000Z",
              connectionIds: input.connectionIds,
            };
          },
        );
        vi.mocked(socketService.emitToCanvas).mockImplementation(
          (_canvasId, event, payload) => {
            if (event !== WebSocketResponseEvents.RUN_GOAL_ROUND_DIVIDER) {
              return;
            }
            const divider = payload as { status: "completed" | "blocked" };
            order.push(`divider:${divider.status}:broadcast`);
          },
        );

        setupProviderMock([
          {
            type: "tool_call_result",
            toolUseId: "goal-tool-1",
            toolName,
            output: JSON.stringify({
              status,
              activeTodoId: null,
              activeTodoText: null,
              nextTodoId: null,
              nextTodoText: null,
              completedTodoIds: status === "completed" ? ["todo-1"] : [],
              blockedReason,
              handoffSummary,
              completedCount: status === "completed" ? 1 : 0,
              totalCount: 1,
            }),
          },
          { type: "turn_complete" },
        ]);

        await executeStreamingChat(
          {
            canvasId,
            podId: pod.id,
            message,
            abortable: false,
            strategy: makeStrategy(),
            goalRoundDivider: {
              sourcePodIds: ["source-1"],
              sourcePodNames: ["來源 Pod"],
              connectionIds: ["conn-1"],
            },
          },
          {
            onComplete: vi.fn(() => {
              order.push("downstream");
              order.push("dequeue");
            }),
          },
        );

        expect(runStore.addRunGoalRoundDivider).toHaveBeenCalledWith(
          expect.objectContaining({
            status,
            blockedReason,
            connectionIds: ["conn-1"],
          }),
        );
        expect(order).toEqual([
          `divider:${status}:persist`,
          `divider:${status}:broadcast`,
          "downstream",
          "dequeue",
        ]);
      },
    );

    it("無 Goal 的 Pod 收到 Goal MCP tool result 時仍應建立空的 runtime snapshot", async () => {
      const pod = insertClaudePod();
      const statePath = getGoalRuntimeStatePath(defaultRunContext, pod.id);

      setupProviderMock([
        {
          type: "tool_call_result",
          toolUseId: "goal-tool-2",
          toolName: `mcp__${GOAL_MCP_SERVER_NAME}__block_goal_progress`,
          output: JSON.stringify({
            status: "blocked",
            activeTodoId: null,
            activeTodoText: null,
            nextTodoId: null,
            nextTodoText: null,
            completedTodoIds: [],
            blockedReason: "Waiting on review",
            handoffSummary: "Need approval",
            completedCount: 0,
            totalCount: 0,
          }),
        },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(readGoalRuntimeSnapshot(statePath)).toMatchObject({
        goal: { todos: [] },
        state: {
          status: "blocked",
          activeTodoId: null,
          completedTodoIds: [],
          blockedReason: "Waiting on review",
          handoffSummary: "Need approval",
        },
      });
    });
  });

  describe("Goal 完成 gate", () => {
    it("Goal 未完成時應自動 nudge 重試直到完成", async () => {
      const goal = {
        todos: [
          { id: "todo-1", text: "第一步" },
          { id: "todo-2", text: "第二步" },
        ],
      };
      const pod = insertClaudePod({ goal });
      ensureGoalRuntime(pod, defaultRunContext);

      // 第一輪：LLM 只完成 todo-1 就停下；第二輪（gate nudge 後）：補完 todo-2
      const chatMock = vi
        .fn()
        .mockImplementationOnce(() =>
          makeEventStream([
            {
              type: "tool_call_result",
              toolUseId: "t1",
              toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
              output: JSON.stringify({
                status: "running",
                activeTodoId: "todo-2",
                activeTodoText: "第二步",
                nextTodoId: "todo-2",
                nextTodoText: "第二步",
                completedTodoIds: ["todo-1"],
                blockedReason: null,
                handoffSummary: null,
                completedCount: 1,
                totalCount: 2,
              }),
            },
            { type: "turn_complete" },
          ]),
        )
        .mockImplementationOnce(() =>
          makeEventStream([
            {
              type: "tool_call_result",
              toolUseId: "t2",
              toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
              output: JSON.stringify({
                status: "completed",
                activeTodoId: null,
                activeTodoText: null,
                nextTodoId: null,
                nextTodoText: null,
                completedTodoIds: ["todo-1", "todo-2"],
                blockedReason: null,
                handoffSummary: "全部完成",
                completedCount: 2,
                totalCount: 2,
              }),
            },
            { type: "turn_complete" },
          ]),
        );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
            { label: "Haiku", value: "haiku" },
          ],
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      // 應該跑了兩輪 chat，且有注入一次 nudge user message
      expect(chatMock).toHaveBeenCalledTimes(2);
      expect(runStore.addRunMessage).toHaveBeenCalledTimes(1);

      const snapshot = readGoalRuntimeSnapshot(
        getGoalRuntimeStatePath(defaultRunContext, pod.id),
      );
      expect(snapshot?.state.status).toBe("completed");
      expect(snapshot?.state.completedTodoIds).toEqual(["todo-1", "todo-2"]);
    });

    it("scheduleNextInQueue 對應的完成 callback 只會在 Goal completed 放行後執行", async () => {
      const order: string[] = [];
      const goal = {
        todos: [
          { id: "todo-1", text: "第一步" },
          { id: "todo-2", text: "第二步" },
        ],
      };
      const pod = insertClaudePod({ goal });
      ensureGoalRuntime(pod, defaultRunContext);

      const chatMock = vi
        .fn()
        .mockImplementationOnce(() =>
          makeEventStream([
            {
              type: "tool_call_result",
              toolUseId: "t1",
              toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
              output: JSON.stringify({
                status: "running",
                activeTodoId: "todo-2",
                activeTodoText: "第二步",
                nextTodoId: "todo-2",
                nextTodoText: "第二步",
                completedTodoIds: ["todo-1"],
                blockedReason: null,
                handoffSummary: null,
                completedCount: 1,
                totalCount: 2,
              }),
            },
            { type: "turn_complete" },
          ]),
        )
        .mockImplementationOnce(() =>
          makeEventStream([
            {
              type: "tool_call_result",
              toolUseId: "t2",
              toolName: `mcp__${GOAL_MCP_SERVER_NAME}__complete_goal_todo`,
              output: JSON.stringify({
                status: "completed",
                activeTodoId: null,
                activeTodoText: null,
                nextTodoId: null,
                nextTodoText: null,
                completedTodoIds: ["todo-1", "todo-2"],
                blockedReason: null,
                handoffSummary: "全部完成",
                completedCount: 2,
                totalCount: 2,
              }),
            },
            { type: "turn_complete" },
          ]),
        );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
            { label: "Haiku", value: "haiku" },
          ],
        },
      });

      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        {
          onComplete: vi.fn(() => {
            const snapshot = readGoalRuntimeSnapshot(
              getGoalRuntimeStatePath(defaultRunContext, pod.id),
            );
            order.push(`schedule:${snapshot?.state.status}`);
          }),
        },
      );

      expect(chatMock).toHaveBeenCalledTimes(2);
      expect(order).toEqual(["schedule:completed"]);
    });

    it("連續未推進達上限應自動 force_block 並放行下游", async () => {
      const goal = {
        todos: [
          { id: "todo-1", text: "永遠不會被完成" },
          { id: "todo-2", text: "永遠不會被完成 2" },
        ],
      };
      const pod = insertClaudePod({ goal });
      ensureGoalRuntime(pod, defaultRunContext);

      // 每一輪都只回 text，不呼叫 complete_goal_todo → completedTodoIds 永遠是空陣列
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "text", content: "我看看..." },
          { type: "turn_complete" },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
            { label: "Haiku", value: "haiku" },
          ],
        },
      });

      const onComplete = vi.fn();
      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        { onComplete },
      );

      // 第一輪 + 連續 noProgressLimit (2) 輪 retry = 共 3 輪 chat
      expect(chatMock).toHaveBeenCalledTimes(3);

      const snapshot = readGoalRuntimeSnapshot(
        getGoalRuntimeStatePath(defaultRunContext, pod.id),
      );
      expect(snapshot?.state.status).toBe("blocked");
      expect(snapshot?.state.blockedReason).toContain("未推進");
      // 即使 force_block，下游 workflow 仍會被觸發（blocked 視為完成的一種）
      expect(onComplete).toHaveBeenCalledWith(canvasId, pod.id);
    });

    it("第一輪收到 fatal provider error 時應直接 break，不再 retry", async () => {
      const goal = {
        todos: [
          { id: "todo-1", text: "永遠無法執行" },
          { id: "todo-2", text: "永遠無法執行 2" },
        ],
      };
      const pod = insertClaudePod({ goal });
      ensureGoalRuntime(pod, defaultRunContext);

      // 第一輪：provider 立刻吐 fatal error（如 usage limit）
      const chatMock = vi.fn(() =>
        makeEventStream([
          {
            type: "error",
            message: "usage limit",
            fatal: true,
            code: "STREAM_ERROR",
          },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
          availableModels: [
            { label: "Opus", value: "opus" },
            { label: "Sonnet", value: "sonnet" },
            { label: "Haiku", value: "haiku" },
          ],
        },
      });

      const onComplete = vi.fn();
      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        { onComplete },
      );

      // fatal error 後 gate 應該直接 break，不應 retry
      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(runStore.addRunMessage).not.toHaveBeenCalled();
      // onComplete 仍會被呼叫（transcript 已寫入錯誤訊息，下游 workflow 可自行判定）
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("沒有 Goal 的 Pod 應跳過 gate，第一輪結束直接 onComplete", async () => {
      const pod = insertClaudePod(); // 無 goal
      setupProviderMock([
        { type: "text", content: "ok" },
        { type: "turn_complete" },
      ]);

      const onComplete = vi.fn();
      await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeStrategy(),
        },
        { onComplete },
      );

      // 沒有 nudge 注入，addRunMessage 不應被呼叫
      expect(runStore.addRunMessage).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("AbortError 處理", () => {
    it("AbortError + abortable=true 時正確處理，onAborted 被呼叫", async () => {
      const pod = insertClaudePod();
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "Hello" };
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      const result = await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: true,
          strategy: makeStrategy(),
        },
        { onAborted },
      );

      expect(result.aborted).toBe(true);
      expect(result.content).toBe("Hello");
      expect(onAborted).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.any(String),
      );
    });

    it("AbortError + abortable=false 時 re-throw，onAborted 不被呼叫", async () => {
      const pod = insertClaudePod();
      const chatMock = vi.fn(async function* () {
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      await expect(
        executeStreamingChat(
          {
            canvasId,
            podId: pod.id,
            message,
            abortable: false,
            strategy: makeStrategy(),
          },
          { onAborted },
        ),
      ).rejects.toThrow("查詢已被中斷");

      expect(onAborted).not.toHaveBeenCalled();
    });

    it("break-style abort（signal.aborted 但不拋 AbortError）走 handleStreamAbort 路徑", async () => {
      const pod = insertClaudePod();
      const setSessionIdSpy = vi.spyOn(podStore, "setSessionId");

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "部分回應" };
        abortRegistry.abortByPodId(pod.id);
        return;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      const onComplete = vi.fn(() => {});
      const strategy = makeStrategy();
      const onStreamCompleteSpy = vi.spyOn(strategy, "onStreamComplete");

      const result = await executeStreamingChat(
        { canvasId, podId: pod.id, message, abortable: true, strategy },
        { onAborted, onComplete },
      );

      expect(result.aborted).toBe(true);
      expect(result.content).toBe("部分回應");
      expect(onAborted).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.any(String),
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(onStreamCompleteSpy).not.toHaveBeenCalled();
      expect(setSessionIdSpy).not.toHaveBeenCalled();
    });

    it("SDK AbortError 實例也正確處理", async () => {
      const pod = insertClaudePod();
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "Hello" };
        throw new AbortError("SDK abort");
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onAborted = vi.fn(() => {});
      const result = await executeStreamingChat(
        {
          canvasId,
          podId: pod.id,
          message,
          abortable: true,
          strategy: makeStrategy(),
        },
        { onAborted },
      );

      expect(result.aborted).toBe(true);
      expect(onAborted).toHaveBeenCalled();
    });
  });

  describe("Pod 不存在錯誤處理", () => {
    it.each([
      { label: "回傳 null", value: null },
      { label: "回傳 undefined", value: undefined },
    ])(
      "getByIdGlobal $label → 透過 emitToCanvas 發送 POD_ERROR（code: POD_NOT_FOUND），provider.chat 未被呼叫",
      async ({ value }) => {
        const chatMock = vi.fn(async function* () {
          yield { type: "text" as const, content: "不應看到" };
        });
        asMock(getProvider).mockReturnValue({
          chat: chatMock,
          cancel: vi.fn(() => false),
          buildOptions: vi.fn().mockResolvedValue({}),
          metadata: {
            availableModelValues: new Set(["opus", "sonnet", "haiku"]),
            defaultOptions: { model: "opus" },
          },
        });

        // 不插入 pod，讓 getByIdGlobal 真實返回 undefined；或 mock 返回 null
        const spy = vi
          .spyOn(podStore, "getByIdGlobal")
          .mockReturnValue(value as any);

        // 新行為：executeStreamingChat 攔截錯誤，透過 emitToCanvas 回報給前端，不再向上拋錯
        const result = await executeStreamingChat({
          canvasId,
          podId: POD_ID,
          message,
          abortable: false,
          strategy: makeStrategy(),
        });

        expect(result.aborted).toBe(false);
        expect(socketService.emitToCanvas).toHaveBeenCalledWith(
          canvasId,
          WebSocketResponseEvents.POD_ERROR,
          expect.objectContaining({
            podId: POD_ID,
            success: false,
            code: "POD_NOT_FOUND",
          }),
        );
        expect(chatMock).not.toHaveBeenCalled();
        spy.mockRestore();
      },
    );
  });

  describe("resolvePodCwd 路徑驗證", () => {
    it("綁定 Repository 時，provider.chat 收到的 workspacePath 為 repositoriesRoot/repositoryId", async () => {
      const pod = insertPodViaSQL({
        provider: "claude",
        repositoryId: "test-repo",
      });

      let capturedCtx: unknown;
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtx = ctx;
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
      const expectedCwd = path.resolve(
        path.join(config.repositoriesRoot, "test-repo"),
      );
      expect(capturedCtx).toMatchObject({ workspacePath: expectedCwd });
    });

    it("未綁定 Repository 時，provider.chat 收到的 workspacePath 為 pod.workspacePath（canvasRoot 內）", async () => {
      const pod = insertClaudePod();

      let capturedCtx: unknown;
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtx = ctx;
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(capturedCtx).toMatchObject({
        workspacePath: path.resolve(pod.workspacePath),
      });
    });

    it("ChatExecutionStrategy 下，provider.chat 不應收到舊 sandbox home 欄位", async () => {
      const pod = insertClaudePod();

      let capturedCtx: unknown;
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtx = ctx;
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
      const removedSandboxHomeKey = ["sandbox", "Home", "Path"].join("");
      expect(capturedCtx).not.toHaveProperty(removedSandboxHomeKey);
    });

    it("workspacePath 不在 canvasRoot 內時，應改寫為 transcript system message 且 provider.chat 未被呼叫", async () => {
      // 直接插入帶非法 workspacePath 的 pod（繞過 canvasRoot 驗證，測試 resolvePodCwd 攔截）
      const pod = insertPodViaSQL({
        provider: "claude",
        workspacePath: "/tmp/evil-path",
      });

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      // 新行為：路徑穿越/非法路徑錯誤被 handleStreamError 攔截，改走 transcript system message
      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          podId: pod.id,
          role: "system",
          // 已知業務錯誤的 content 改為固定中文訊息，不再透傳 error.message
          content: "工作目錄路徑無效或存取遭拒，請確認 Pod 設定後重試。",
          metadata: expect.objectContaining({
            code: "INVALID_PATH",
            severity: "fatal",
          }),
        }),
      );
      expect(chatMock).not.toHaveBeenCalled();
    });
  });

  describe("一般錯誤處理", () => {
    it("一般錯誤時呼叫 onError callback 並 re-throw", async () => {
      const pod = insertClaudePod();

      const testError = new Error("Claude API 錯誤");
      const chatMock = vi.fn(async function* () {
        throw testError;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const onError = vi.fn(() => {});
      await expect(
        executeStreamingChat(
          {
            canvasId,
            podId: pod.id,
            message,
            abortable: false,
            strategy: makeStrategy(),
          },
          { onError },
        ),
      ).rejects.toThrow("Claude API 錯誤");

      expect(onError).toHaveBeenCalledWith(
        canvasId,
        pod.id,
        expect.objectContaining({ message: "Claude API 錯誤" }),
      );
    });
  });

  describe("Codex 路徑（統一 provider.chat）", () => {
    it("provider=codex 時走 provider.chat，不呼叫 sendMessage", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([{ type: "turn_complete" }]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi
          .fn()
          .mockResolvedValue({ model: "gpt-5.4", resumeMode: "cli" }),
        metadata: {
          availableModelValues: new Set(["gpt-5.4", "gpt-5.5", "gpt-5.4-mini"]),
          defaultOptions: { model: "gpt-5.4" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(chatMock).toHaveBeenCalledTimes(1);
    });

    it("session_started 事件暫存 sessionId 並傳入 onStreamComplete", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "session_started", sessionId: "thread_abc" },
          { type: "turn_complete" },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const strategy = makeStrategy();
      const completeSpy = vi.spyOn(strategy, "onStreamComplete");

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy,
      });

      expect(completeSpy).toHaveBeenCalledWith(pod.id, "thread_abc");
    });

    it("thinking 事件映射為 POD_CLAUDE_CHAT_MESSAGE 廣播", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "thinking", content: "思考中..." },
          { type: "turn_complete" },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          content: expect.stringContaining("思考中..."),
        }),
      );
    });

    it("error fatal=true 會寫入 system message 並中止串流，但不 throw", async () => {
      const pod = insertCodexPod();
      const chatMock = vi.fn(() =>
        makeEventStream([
          { type: "error", message: "某致命錯誤", fatal: true },
        ]),
      );
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const collectedPayloads: unknown[] = [];
      vi.spyOn(socketService, "emitToCanvas").mockImplementation(
        (_cId: string, _event: string, payload: unknown) => {
          collectedPayloads.push(payload);
        },
      );

      // 不再 throw 出去，走正常 finalize 收尾路徑
      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(result.aborted).toBe(false);

      const systemPayloads = collectedPayloads.filter(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "role" in p &&
          (p as { role?: string }).role === "system" &&
          "content" in p &&
          typeof (p as { content: unknown }).content === "string" &&
          (p as { content: string }).content.includes("某致命錯誤"),
      );
      expect(systemPayloads.length).toBeGreaterThan(0);
    });
  });

  describe("Run mode (ChatExecutionStrategy)", () => {
    const runId = "test-run-id";
    const runContext: RunContext = {
      runId,
      canvasId,
      sourcePodId: "source-pod",
    };

    function makeRunStrategy() {
      return new ChatExecutionStrategy(canvasId, runContext);
    }

    it("正常串流完成：registerActiveStream → chat → unregisterActiveStream", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Run 回應" },
        { type: "turn_complete" },
      ]);

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(runExecutionService.registerActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(result.content).toBe("Run 回應");
      expect(result.aborted).toBe(false);
    });

    it("AbortError → unregisterActiveStream + errorPodInstance", async () => {
      const pod = insertClaudePod();
      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "部分內容" };
        const error = new Error("查詢已被中斷");
        error.name = "AbortError";
        throw error;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: true,
        strategy: makeRunStrategy(),
      });

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
        runContext,
        pod.id,
        "使用者中斷執行",
      );
      expect(result.aborted).toBe(true);
    });

    it("一般 Error → unregisterActiveStream，不呼叫 errorPodInstance", async () => {
      const pod = insertClaudePod();
      const testError = new Error("Run mode 執行錯誤");
      const chatMock = vi.fn(async function* () {
        throw testError;
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await expect(
        executeStreamingChat({
          canvasId,
          podId: pod.id,
          message,
          abortable: false,
          strategy: makeRunStrategy(),
        }),
      ).rejects.toThrow("Run mode 執行錯誤");

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        pod.id,
      );
      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
    });

    it("text event 廣播 RUN_MESSAGE", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Run 文字" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          runId,
          canvasId,
          podId: pod.id,
          content: "Run 文字",
        }),
      );
    });

    it("persistMessage 呼叫 runStore.upsertRunMessage", async () => {
      const pod = insertClaudePod();
      setupProviderMock([
        { type: "text", content: "Run 內容" },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(runStore.upsertRunMessage).toHaveBeenCalledWith(
        runId,
        pod.id,
        expect.objectContaining({ role: "assistant" }),
      );
    });

    it("instance.runRepoPath 合法時，provider.chat 收到的 workspacePath 為 run repo 且不含舊 sandbox home 欄位", async () => {
      const pod = insertClaudePod();
      const validWorktreePath = path.join(
        config.runRepositoriesRoot,
        "some-repo-agnet-canvas-abc",
      );

      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        runRepoPath: validWorktreePath,
      } as any);

      const capturedCtxList: unknown[] = [];
      const chatMock = vi.fn(async function* (ctx: unknown) {
        capturedCtxList.push(ctx);
        yield { type: "text" as const, content: "worktree 回應" };
        yield { type: "turn_complete" as const };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(chatMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: validWorktreePath,
        }),
      );
      const removedSandboxHomeKey = ["sandbox", "Home", "Path"].join("");
      expect(capturedCtxList[0]).not.toHaveProperty(removedSandboxHomeKey);
    });

    it("runRepoPath 不在 runRepositoriesRoot 內時，應改寫為 run transcript system message 且 provider.chat 未被呼叫", async () => {
      const pod = insertClaudePod();
      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        runRepoPath: "/tmp/evil-path",
      } as any);

      const chatMock = vi.fn(async function* () {
        yield { type: "text" as const, content: "不應看到" };
      });
      asMock(getProvider).mockReturnValue({
        chat: chatMock,
        cancel: vi.fn(() => false),
        buildOptions: vi.fn().mockResolvedValue({}),
        metadata: {
          availableModelValues: new Set(["opus", "sonnet", "haiku"]),
          defaultOptions: { model: "opus" },
        },
      });

      // 新行為：runRepoPath 非法錯誤被 handleStreamError 攔截，改走 run transcript system message
      const result = await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeRunStrategy(),
      });

      expect(result.aborted).toBe(false);
      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          podId: pod.id,
          role: "system",
          // 已知業務錯誤的 content 改為固定中文訊息，不再透傳 error.message
          content: "工作目錄路徑無效或存取遭拒，請確認 Pod 設定後重試。",
          metadata: expect.objectContaining({
            code: "INVALID_PATH",
            severity: "fatal",
          }),
        }),
      );
      expect(chatMock).not.toHaveBeenCalled();
    });
  });

  describe("provider error transcript 路由", () => {
    it("無 code + fatal=false → 直接保留原文 system message", async () => {
      const pod = insertClaudePod();

      const collectedContents: string[] = [];
      vi.spyOn(socketService, "emitToCanvas").mockImplementation(
        (_cId: string, event: string, payload: unknown) => {
          if (
            event === WebSocketResponseEvents.RUN_MESSAGE &&
            typeof payload === "object" &&
            payload !== null &&
            "content" in payload &&
            typeof (payload as { content: unknown }).content === "string"
          ) {
            collectedContents.push((payload as { content: string }).content);
          }
        },
      );

      setupProviderMock([
        { type: "error", message: "xxx", fatal: false },
        { type: "turn_complete" },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: new ChatExecutionStrategy(canvasId, defaultRunContext),
      });

      expect(collectedContents).toContain("xxx");
    });

    it("Gemini quota fatal error 會寫入明確的 transcript system message，且不額外發 POD_ERROR", async () => {
      const pod = insertClaudePod();
      asMock(logger.error).mockClear();

      setupProviderMock([
        {
          type: "error",
          message:
            "Gemini 目前回報模型容量不足，這次請求未完成，請稍後再試或切換模型。",
          fatal: true,
          code: "GEMINI_CAPACITY_EXHAUSTED",
          systemMessage: {
            role: "system",
            content:
              "Gemini 目前回報模型容量不足，這次請求未完成，請稍後再試或切換模型。",
            metadata: {
              provider: "gemini",
              code: "GEMINI_CAPACITY_EXHAUSTED",
              severity: "fatal",
              rawContent: "",
              reasonDetail: "這次失敗是模型當下容量不足，與帳號配額不足不同。",
            },
          },
        },
      ]);

      await executeStreamingChat({
        canvasId,
        podId: pod.id,
        message,
        abortable: false,
        strategy: makeStrategy(),
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        canvasId,
        WebSocketResponseEvents.RUN_MESSAGE,
        expect.objectContaining({
          podId: pod.id,
          role: "system",
          content:
            "Gemini 目前回報模型容量不足，這次請求未完成，請稍後再試或切換模型。",
          metadata: expect.objectContaining({
            provider: "gemini",
            code: "GEMINI_CAPACITY_EXHAUSTED",
            severity: "fatal",
            reasonDetail: "這次失敗是模型當下容量不足，與帳號配額不足不同。",
          }),
        }),
      );

      const emittedPodError = vi
        .mocked(socketService.emitToCanvas)
        .mock.calls.filter(
          ([, event]) => event === WebSocketResponseEvents.POD_ERROR,
        );
      expect(emittedPodError).toHaveLength(0);
      expect(
        asMock(logger.error).mock.calls.some((args) =>
          args.some(
            (arg) =>
              typeof arg === "string" &&
              arg.includes(
                "RetryableQuotaError: You have exhausted your capacity on this model.",
              ),
          ),
        ),
      ).toBe(false);
    });
  });
});
