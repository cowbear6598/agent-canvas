/**
 * summaryService 單元測試（Phase 3E 重寫）
 *
 * 保留合理 boundary mock：
 *   - executeDisposableChat（SDK 邊界：Claude/Codex disposable chat��
 *   - commandService.getContent（filesystem 邊界：讀取 markdown 檔）
 *   - logger（side-effect only）
 *   - getProvider（providerConfigResolver 讀取路徑依賴 metadata，必須補上）
 * 移除自家 store mock，改用 initTestDb + 真實 store。
 */

// SDK boundary mock：讀取 DB pod 時 resolveProviderConfig 會呼叫 getProvider(provider).metadata
// 必須補上 metadata 否則 buildPodFromRow 路徑丟出 TypeError
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
          { label: "Claude Sonnet", value: "claude-sonnet-4-5-20250929" },
        ],
      },
    })),
  };
});

// SDK boundary mock：disposableChatService 是 Claude/Codex API 的真實呼叫
vi.mock("../../src/services/disposableChatService.js", () => ({
  executeDisposableChat: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import path from "path";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { summaryService } from "../../src/services/summaryService.js";
import { commandService } from "../../src/services/commandService.js";
import { messageStore } from "../../src/services/messageStore.js";
import { runStore } from "../../src/services/runStore.js";
import { podStore } from "../../src/services/podStore.js";
import * as disposableChatService from "../../src/services/disposableChatService.js";
import { config } from "../../src/config/index.js";
import type { RunContext } from "../../src/types/run.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

// --- DB helpers ---

const CANVAS_ID = "test-canvas-summary";

/** 清除 podStore 內部 LRU 快取，防止跨測試 DB 污染 */
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
 * workspacePath 預設在 canvasRoot 之下確保路徑合法。
 */
function insertPodViaSQL(
  podId: string,
  name: string,
  opts: { commandId?: string; workspacePath?: string } = {},
): void {
  const workspacePath =
    opts.workspacePath ??
    path.join(config.canvasRoot, CANVAS_ID, `pod-${podId}`);
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

describe("SummaryService", () => {
  const SOURCE_POD_ID = "source-pod";
  const TARGET_POD_ID = "target-pod";

  beforeEach(() => {
    closeDb();
    clearPodStoreCache();
    resetStatements();
    initTestDb();
    insertCanvas();

    // 設定 executeDisposableChat 預設成功回傳
    asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
      success: true,
      content: "Summary result",
      resolvedModel: "claude-sonnet-4-5-20250929",
    });

    // filesystem 邊界：commandService.getContent 讀取磁碟，保留 mock
    vi.spyOn(commandService, "getContent").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    clearPodStoreCache();
  });

  // --- 工具函式：插入測試訊息 ---

  function insertMessages(podId: string, hasAssistant = true): void {
    messageStore.upsertMessage(CANVAS_ID, podId, {
      id: "msg-u",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });
    if (hasAssistant) {
      messageStore.upsertMessage(CANVAS_ID, podId, {
        id: "msg-a",
        role: "assistant",
        content: "Hi there!",
        timestamp: new Date().toISOString(),
      });
    }
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

  // --- 基礎功能 ---

  describe("generateSummaryForTarget 成功路徑", () => {
    it("成功時回傳 success: true 與 summary 內容", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(true);
      expect(result.summary).toBe("Summary result");
    });

    it("成功時 resolvedModel 應包含實際使用的模型名稱", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(true);
      expect(result.resolvedModel).toBe("claude-sonnet-4-5-20250929");
    });

    it("呼叫 executeDisposableChat 時帶入傳入的 provider 與 summaryModel", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);

      await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "opus",
      );

      expect(disposableChatService.executeDisposableChat).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claude", model: "opus" }),
      );
    });
  });

  // --- Command 讀取邏輯 ---

  describe("generateSummaryForTarget Command 讀取邏輯", () => {
    it("Target Pod 有 commandId 時讀取 Command 內容並傳入 prompt", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod", {
        commandId: "review-command",
      });
      insertMessages(SOURCE_POD_ID);

      vi.spyOn(commandService, "getContent").mockResolvedValue(
        "Review the code carefully.",
      );

      await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(commandService.getContent).toHaveBeenCalledWith("review-command");
      // 驗證 prompt 帶有 command 內容（透過 executeDisposableChat 的 userMessage 參數）
      expect(disposableChatService.executeDisposableChat).toHaveBeenCalledWith(
        expect.objectContaining({
          userMessage: expect.stringContaining("Review the code carefully."),
        }),
      );
    });

    it("Target Pod commandId 為 null 時不呼叫 commandService.getContent", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod"); // no commandId
      insertMessages(SOURCE_POD_ID);

      await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(commandService.getContent).not.toHaveBeenCalled();
    });

    it("commandService.getContent 回傳 null 時，仍正常完成（null 降級）", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod", {
        commandId: "nonexistent-command",
      });
      insertMessages(SOURCE_POD_ID);

      vi.spyOn(commandService, "getContent").mockResolvedValue(null);

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(commandService.getContent).toHaveBeenCalledWith(
        "nonexistent-command",
      );
      expect(result.success).toBe(true);
    });
  });

  // --- runContext 訊息來源選擇 ---

  describe("generateSummaryForTarget runContext 訊息來源選擇", () => {
    it("有 runContext 時從 runStore 讀取訊息，成功回傳摘要", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      insertRunMessages(run.id, SOURCE_POD_ID);

      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        runContext,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toBe("Summary result");
    });

    it("有 runContext 但 run 內無訊息時回傳錯誤", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      // 不插入任何訊息

      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        runContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("來源 Pod 沒有可用訊息記錄");
      expect(result.error).not.toContain("source-pod");
    });

    it("��有 runContext 時從 messageStore 讀取訊息", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID);

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(true);
    });
  });

  // --- 錯誤處理 ---

  describe("generateSummaryForTarget 錯誤處理", () => {
    it("Source Pod 不存在時回傳錯誤", async () => {
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        "nonexistent-source",
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("來源 Pod 不存在");
      expect(result.error).not.toContain("nonexistent-source");
    });

    it("Target Pod 不存在時回傳錯誤", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertMessages(SOURCE_POD_ID);

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        "nonexistent-target",
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("目標 Pod 不存在");
      expect(result.error).not.toContain("nonexistent-target");
    });

    it("Source Pod 沒有訊息時回傳錯誤", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      // 不���入任何訊息

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("來源 Pod 沒有可用訊息記錄");
      expect(result.error).not.toContain("source-pod");
    });

    it("disposableChat 失敗但有 fallback 訊息時，回傳 success:true 並使用 fallback 內容", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID, true); // 含 assistant 訊息

      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        resolvedModel: undefined,
        error: "執行失敗",
      });

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(true);
      expect(result.summary).toBe("Hi there!");
    });

    it("disposableChat 失敗且無 fallback 訊息時，回傳 success:false", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      // 只插入 user 訊息（無 assistant fallback）
      messageStore.upsertMessage(CANVAS_ID, SOURCE_POD_ID, {
        id: "msg-u",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
      });

      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        resolvedModel: undefined,
        error: "some error",
      });

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("some error");
    });

    it("fallback 路徑時 resolvedModel 不存在", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");
      insertMessages(SOURCE_POD_ID, true);

      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        resolvedModel: undefined,
        error: "執行失敗",
      });

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
      );

      expect(result.success).toBe(true);
      expect(result.resolvedModel).toBeUndefined();
    });
  });

  // --- runContext fallback 路徑 ---

  describe("generateSummaryForTarget runContext fallback 路徑", () => {
    it("case A：disposableChat 失敗 + runContext 存在 + run 內有 assistant 訊息 → success:true，content 為 run 的 assistant 訊息", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      insertRunMessages(run.id, SOURCE_POD_ID, true); // 含 assistant 訊息

      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        resolvedModel: undefined,
        error: "AI 呼叫失敗",
      });

      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        runContext,
      );

      expect(result.success).toBe(true);
      expect(result.summary).toBe("run 模式分析結果");
    });

    it("case B：disposableChat 失敗 + runContext 存在 + run 內無 assistant 訊息 → success:false 含 zh-TW 錯誤", async () => {
      insertPodViaSQL(SOURCE_POD_ID, "Source Pod");
      insertPodViaSQL(TARGET_POD_ID, "Target Pod");

      const run = runStore.createRun(CANVAS_ID, SOURCE_POD_ID, "test");
      insertRunMessages(run.id, SOURCE_POD_ID, false); // 只有 user 訊息，無 assistant

      asMock(disposableChatService.executeDisposableChat).mockResolvedValue({
        success: false,
        content: "",
        resolvedModel: undefined,
        error: "AI 呼叫失敗",
      });

      const runContext: RunContext = {
        runId: run.id,
        canvasId: CANVAS_ID,
        sourcePodId: SOURCE_POD_ID,
      };

      const result = await summaryService.generateSummaryForTarget(
        CANVAS_ID,
        SOURCE_POD_ID,
        TARGET_POD_ID,
        "claude",
        "sonnet",
        runContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
