/**
 * aiDecideService 單元測試（Phase 3E 重寫）
 *
 * 保留合理 boundary mock：
 *   - @anthropic-ai/claude-agent-sdk（createSdkMcpServer：SDK 邊���）
 *   - claudeService.executeMcpChat（Claude Agent SDK 邊界）
 *   - executeDisposableChat（disposableChatService：Claude/Codex API 邊界）
 *   - commandService.getContent（filesystem 邊界：讀取 markdown 檔）
 *   - logger（side-effect only）
 *   - getProvider（providerConfigResolver 讀取路徑依賴 metadata，必須補上）
 * 移除自家 store mock，改用 initTestDb + ��實 store。
 */

// SDK boundary mock：讀取 DB pod 時 resolveProviderConfig 會呼叫 getProvider(provider).metadata
// 必須補上 metadata，否則 buildPodFromRow 路徑丟出 TypeError
vi.mock("../../src/services/provider/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/provider/index.js")
    >();
  return {
    ...actual,
    getProvider: vi.fn(() => ({
      chat: vi.fn(async function* () {}),
      cancel: vi.fn(() => false),
      buildOptions: vi.fn().mockResolvedValue({}),
      metadata: {
        availableModelValues: new Set([
          "opus",
          "sonnet",
          "haiku",
          "claude-sonnet-4-5-20250929",
        ]),
        defaultOptions: { model: "sonnet" },
        availableModels: [
          { label: "Opus", value: "opus" },
          { label: "Sonnet", value: "sonnet" },
          { label: "Haiku", value: "haiku" },
        ],
      },
    })),
  };
});

// SDK boundary mock：createSdkMcpServer 保留 tools ��測��訪問
vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const actual = (await vi.importActual(
    "@anthropic-ai/claude-agent-sdk",
  )) as any;
  return {
    ...actual,
    createSdkMcpServer: vi.fn((options: { name: string; tools?: any[] }) => ({
      type: "sdk",
      name: options.name,
      tools: options.tools ?? [],
    })),
  };
});

// SDK boundary mock：disposableChatService 是 Claude API ���真實呼叫
vi.mock("../../src/services/disposableChatService.js", () => ({
  executeDisposableChat: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import path from "path";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { aiDecideService } from "../../src/services/workflow";
import { claudeService } from "../../src/services/claude/claudeService.js";
import { commandService } from "../../src/services/commandService.js";
import { messageStore } from "../../src/services/messageStore.js";
import { runStore } from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import * as disposableChatService from "../../src/services/disposableChatService.js";
import { config } from "../../src/config/index.js";
import type { Connection } from "../../src/types";
import type { RunContext } from "../../src/types/run.js";
import {
  getRunSandboxHomePath,
  getRunWorkspacePath,
} from "../../src/services/runtime/executionPaths.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

const CANVAS_ID = "test-canvas-ai-decide";

function clearPodStoreCache(): void {
  type PodStoreTestHooks = { stmtCache: Map<string, unknown> };
  (podStore as unknown as PodStoreTestHooks).stmtCache.clear();
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
 * workspacePath 預���在 canvasRoot 之下確保路徑合法。
 */
function insertPodViaSQL(
  podId: string,
  name: string,
  opts: { commandId?: string } = {},
): void {
  const workspacePath = path.join(config.canvasRoot, CANVAS_ID, `pod-${podId}`);
  getDb()
    .prepare(
      `INSERT INTO pods
       (id, canvas_id, name, status, x, y, rotation, workspace_path,
        session_id, repository_id, command_id, multi_instance,
        schedule_json, provider, provider_config_json)
       VALUES (?, ?, ?, 'idle', 0, 0, 0, ?, NULL, NULL, ?, 0, NULL, 'claude',
       '{"model":"claude-sonnet-4-5-20250929"}')`,
    )
    .run(podId, CANVAS_ID, name, workspacePath, opts.commandId ?? null);
}

/** 建立標準 Connection 物件供測試使用 */
function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    sourcePodId: "source-pod",
    sourceAnchor: "right",
    targetPodId: "target-pod",
    targetAnchor: "left",
    triggerMode: "ai-decide",
    decideStatus: "none",
    decideReason: null,
    connectionStatus: "idle",
    summaryModel: "sonnet",
    aiDecideModel: "sonnet",
    ...overrides,
  };
}

describe("AiDecideService", () => {
  const SOURCE_POD_ID = "source-pod";
  const TARGET_POD_ID = "target-pod";

  beforeEach(() => {
    closeDb();
    clearPodStoreCache();
    resetStatements();
    initTestDb();
    insertCanvas();

    // 設定 disposableChat 預���成功（生成 source 摘要）
    asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
      success: true,
      content: "Summary: Analysis found 3 issues",
    });
    // filesystem 邊界：commandService.getContent 讀取磁碟，保留 mock
    vi.spyOn(commandService, "getContent").mockResolvedValue(null);
    // SDK 邊界：executeMcpChat 預設���傳空串流（不呼叫 tool）
    vi.spyOn(claudeService, "executeMcpChat").mockReturnValue(
      (async function* () {
        yield { type: "result", subtype: "success" };
      })() as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    clearPodStoreCache();
  });

  function insertMessages(podId: string): void {
    messageStore.upsertMessage(CANVAS_ID, podId, {
      id: "msg-u",
      role: "user",
      content: "Analyze this data",
      timestamp: new Date().toISOString(),
    });
    messageStore.upsertMessage(CANVAS_ID, podId, {
      id: "msg-a",
      role: "assistant",
      content: "Analysis complete: found 3 issues",
      timestamp: new Date().toISOString(),
    });
  }

  function insertRunMessages(
    runId: string,
    podId: string,
    hasAssistant = true,
  ): void {
    runStore.upsertRunMessage(runId, podId, {
      id: "rm-u",
      role: "user",
      content: "請分析",
      timestamp: new Date().toISOString(),
    });
    if (hasAssistant) {
      runStore.upsertRunMessage(runId, podId, {
        id: "rm-a",
        role: "assistant",
        content: "run 模式分析結果",
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** 建��會呼叫 tool handler 的 executeMcpChat mock */
  function mockMcpChatWithDecisions(
    decisions: Array<{
      connectionId: string;
      shouldTrigger: boolean;
      reason: string;
    }>,
  ): void {
    vi.spyOn(claudeService, "executeMcpChat").mockImplementation(
      (options: any) =>
        (async function* () {
          const decideTool = options.mcpServers["ai-decide"].tools[0];
          await decideTool.handler({ decisions });
          yield { type: "result", subtype: "success" };
        })() as any,
    );
  }

  it("空的 connections 陣列：不呼叫 Claude API，直接回傳空結果", async () => {
    const result = await aiDecideService.decideConnections(
      CANVAS_ID,
      SOURCE_POD_ID,
      [],
    );
    expect(result.results).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
  });

  describe("單一 connection 判斷", () => {
    it("判斷為觸發（shouldTrigger: true）", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);
      mockMcpChatWithDecisions([
        {
          connectionId: "conn-1",
          shouldTrigger: true,
          reason: "上游分析結果與下游需求相關",
        },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].connectionId).toBe("conn-1");
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(result.results[0].reason).toBe("上游分析結果與下游需求相關");
      expect(result.errors).toHaveLength(0);
    });

    it("判斷為不觸發（shouldTrigger: false）", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);
      mockMcpChatWithDecisions([
        {
          connectionId: "conn-1",
          shouldTrigger: false,
          reason: "上游產出與下游任務無關",
        },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
      );

      expect(result.results[0].shouldTrigger).toBe(false);
      expect(result.results[0].reason).toBe("上游產出與下游任務無關");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("批次多條 connections 判斷", () => {
    it("全部觸發，同一 model 批次只呼叫一次 executeMcpChat", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      ["target-pod", "target-pod-2", "target-pod-3"].forEach((id, i) =>
        insertPodViaSQL(id, `Target Pod ${i + 1}`),
      );
      insertMessages(SOURCE_POD_ID);
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關 1" },
        { connectionId: "conn-2", shouldTrigger: true, reason: "相關 2" },
        { connectionId: "conn-3", shouldTrigger: true, reason: "相關 3" },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [
          makeConnection({ id: "conn-1", targetPodId: "target-pod" }),
          makeConnection({ id: "conn-2", targetPodId: "target-pod-2" }),
          makeConnection({ id: "conn-3", targetPodId: "target-pod-3" }),
        ],
      );

      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(claudeService.executeMcpChat).toHaveBeenCalledTimes(1);
    });

    it("部分觸發部分不觸發，回傳混合結果", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertPodViaSQL("target-pod-2", "Target Pod 2");
      insertMessages(SOURCE_POD_ID);
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
        { connectionId: "conn-2", shouldTrigger: false, reason: "不相關" },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [
          makeConnection({ id: "conn-1", targetPodId: TARGET_POD_ID }),
          makeConnection({ id: "conn-2", targetPodId: "target-pod-2" }),
        ],
      );

      expect(result.results).toHaveLength(2);
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(result.results[1].shouldTrigger).toBe(false);
      expect(result.errors).toHaveLength(0);
    });

    it("AI 僅���傳部分結果時，缺少的 connection 進入 errors", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      ["target-pod", "target-pod-2", "target-pod-3"].forEach((id, i) =>
        insertPodViaSQL(id, `Target Pod ${i + 1}`),
      );
      insertMessages(SOURCE_POD_ID);
      // conn-3 缺失
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關 1" },
        { connectionId: "conn-2", shouldTrigger: false, reason: "不相關 2" },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [
          makeConnection({ id: "conn-1", targetPodId: "target-pod" }),
          makeConnection({ id: "conn-2", targetPodId: "target-pod-2" }),
          makeConnection({ id: "conn-3", targetPodId: "target-pod-3" }),
        ],
      );

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-3");
      expect(result.errors[0].error).toBe("此連線未獲得 AI 決策結果");
    });
  });

  describe("model 參數傳遞", () => {
    it("executeMcpChat 帶入 connection.aiDecideModel", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
      ]);

      await aiDecideService.decideConnections(CANVAS_ID, SOURCE_POD_ID, [
        makeConnection({ aiDecideModel: "haiku" }),
      ]);

      expect(claudeService.executeMcpChat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "haiku" }),
      );
    });

    it("executeDisposableChat 帶入 connection.summaryModel", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
      ]);

      await aiDecideService.decideConnections(CANVAS_ID, SOURCE_POD_ID, [
        makeConnection({ summaryModel: "opus" }),
      ]);

      expect(disposableChatService.executeDisposableChat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "opus" }),
      );
    });
  });

  describe("prompt 正確組裝", () => {
    it("傳給 executeMcpChat 的 prompt 包含 target Pod 資訊與 system prompt", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod", { commandId: "command-1" });
      insertMessages(SOURCE_POD_ID);
      vi.spyOn(commandService, "getContent").mockResolvedValue(
        "Review the code for bugs.",
      );
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
      ]);

      await aiDecideService.decideConnections(CANVAS_ID, SOURCE_POD_ID, [
        makeConnection(),
      ]);

      const callOptions = asMock(claudeService.executeMcpChat).mock.calls[0][0];
      expect(callOptions.prompt).toContain("Target Pod");
      expect(callOptions.systemPrompt).toContain("Workflow 觸發判斷者");
      expect(commandService.getContent).toHaveBeenCalledWith("command-1");
    });
  });

  describe("錯誤處理", () => {
    it("Claude API 請求失敗時，所有 connections 進入 errors", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);
      vi.spyOn(claudeService, "executeMcpChat").mockImplementation(() => {
        throw new Error("Claude API Error");
      });

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
      );

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(result.errors[0].error).toContain("Claude API Error");
    });

    it("tool handler 未被呼叫時，connections 進入 errors", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);
      // beforeEach 已設���不呼叫 tool handler 的預設 mock

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
      );

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe("AI 決策工具未被執行");
    });
  });

  describe("run 模式：從 runStore 讀取訊息", () => {
    it("有 runContext 時成功從 runStore 讀取訊息並完成判斷", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      const runWorkspacePath = getRunWorkspacePath(run.id, SOURCE_POD_ID);
      const runSandboxHomePath = getRunSandboxHomePath(run.id, SOURCE_POD_ID);
      runStore.createPodInstance(run.id, SOURCE_POD_ID, "pending", "pending", {
        workspacePath: runWorkspacePath,
        sandboxHomePath: runSandboxHomePath,
      });
      insertRunMessages(run.id, SOURCE_POD_ID);
      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "相關" },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
        runContext,
      );

      expect(result.errors).toHaveLength(0);
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(claudeService.executeMcpChat).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: runWorkspacePath,
          sandboxHomePath: runSandboxHomePath,
        }),
      );
    });

    it("run 模式下 runStore 無訊息時回傳錯誤", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
        runContext,
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
    });

    it("run 模式摘要失敗時，fallback 使用最後一則 assistant 訊息", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      insertRunMessages(run.id, SOURCE_POD_ID, true);
      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };
      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        error: "摘要失敗",
      });
      mockMcpChatWithDecisions([
        { connectionId: "conn-1", shouldTrigger: true, reason: "備用摘要判斷" },
      ]);

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
        runContext,
      );

      expect(result.errors).toHaveLength(0);
      expect(result.results[0].shouldTrigger).toBe(true);
      const callOptions = asMock(claudeService.executeMcpChat).mock.calls[0][0];
      expect(callOptions.prompt).toContain("run 模式分析結果");
    });

    it("run 模式摘要失敗且無 assistant 訊息時回傳錯誤", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      insertRunMessages(run.id, SOURCE_POD_ID, false); // 只有 user 訊息
      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };
      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        error: "摘要失敗",
      });

      const result = await aiDecideService.decideConnections(
        CANVAS_ID,
        SOURCE_POD_ID,
        [makeConnection()],
        runContext,
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe("conn-1");
      expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
    });
  });
});
