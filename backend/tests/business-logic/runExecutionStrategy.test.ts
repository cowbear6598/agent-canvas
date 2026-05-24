/**
 * ChatExecutionStrategy 單元測試
 *
 * 移除自家 store / service mock，改用 initTestDb + 真實 store + vi.spyOn 觀察呼叫。
 * 僅保留必要的 spyOn：
 *   - runExecutionService.*（服務層方法需複雜 run 狀態設定，spyOn 保留真實簽名）
 *   - runStore.getPodInstance / upsertRunMessage / updatePodInstanceSessionId（run instance 需額外 run 骨架）
 *   - injectRunUserMessage（觸發外部 SDK 執行鏈，超出本測試範圍）
 *   - socketService.emitToCanvas（防止廣播副作用）
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { ChatExecutionStrategy } from "../../src/services/executionStrategy.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { socketService } from "../../src/services/socketService.js";
import { podStore } from "../../src/services/podStore.js";
import * as runChatHelpers from "../../src/utils/runChatHelpers.js";
import type { RunContext } from "../../src/types/run.js";

/** 清除 podStore 內部動態 PreparedStatement LRU 快取，防止跨測試 DB 污染 */
function clearPodStoreCache(): void {
  type PodStoreTestHooks = { stmtCache: Map<string, unknown> };
  (podStore as unknown as PodStoreTestHooks).stmtCache.clear();
}

const CANVAS_ID = "test-canvas";
const RUN_ID = "test-run";
const SOURCE_POD_ID = "source-pod";

const runContext: RunContext = {
  runId: RUN_ID,
  canvasId: CANVAS_ID,
  sourcePodId: SOURCE_POD_ID,
};

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, `canvas-${CANVAS_ID}`, 0);
}

describe("ChatExecutionStrategy", () => {
  beforeEach(() => {
    closeDb();
    clearPodStoreCache();
    resetStatements();
    initTestDb();
    insertCanvas();

    vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {});

    // spyOn runExecutionService（需要複雜 run 骨架，直接觀察呼叫行為即可）
    vi.spyOn(runExecutionService, "startPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "summarizingPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "errorPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "registerActiveStream").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "unregisterActiveStream").mockImplementation(
      () => {},
    );

    // spyOn runStore 需要預先存在的 run instance
    vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
    // persistMessage 會先 getRun 檢查是否 cancelled；測試環境 mock 為 running run
    vi.spyOn(runStore, "getRun").mockReturnValue({
      id: RUN_ID,
      status: "running",
    } as ReturnType<typeof runStore.getRun>);
    vi.spyOn(runStore, "upsertRunMessage").mockImplementation(() => {});
    vi.spyOn(runStore, "updatePodInstanceSessionId").mockImplementation(
      () => {},
    );
    vi.spyOn(
      runStore,
      "updatePodInstanceLastResponseSummary",
    ).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    clearPodStoreCache();
  });

  function makeStrategy(): ChatExecutionStrategy {
    return new ChatExecutionStrategy(CANVAS_ID, runContext);
  }

  describe("getSessionId", () => {
    it("Pod instance 不存在時應回傳 undefined", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
      const strategy = makeStrategy();

      expect(strategy.getSessionId("pod-1")).toBeUndefined();
      expect(runStore.getPodInstance).toHaveBeenCalledWith(RUN_ID, "pod-1");
    });

    it("Pod instance 存在且有 sessionId 時應回傳該值", () => {
      const sessionId = "run-session-789";
      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        id: "instance-1",
        sessionId,
      } as ReturnType<typeof runStore.getPodInstance>);

      const strategy = makeStrategy();
      expect(strategy.getSessionId("pod-1")).toBe(sessionId);
    });

    it("Pod instance 的 sessionId 為 null 時應回傳 undefined", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        id: "instance-1",
        sessionId: null,
      } as ReturnType<typeof runStore.getPodInstance>);

      const strategy = makeStrategy();
      expect(strategy.getSessionId("pod-1")).toBeUndefined();
    });
  });

  describe("createEmitStrategy", () => {
    it("回傳的 emitStrategy.emitText 應廣播含 runId 的 payload", () => {
      const strategy = makeStrategy();
      const emitStrategy = strategy.createEmitStrategy();

      emitStrategy.emitText({
        canvasId: CANVAS_ID,
        podId: "pod-1",
        messageId: "msg-1",
        content: "Run 訊息",
        delta: "訊息",
      });

      expect(socketService.emitToCanvas).toHaveBeenCalledWith(
        CANVAS_ID,
        expect.any(String),
        expect.objectContaining({ runId: RUN_ID }),
      );
    });
  });

  describe("persistMessage", () => {
    it("應呼叫 runStore.upsertRunMessage 並帶入正確參數", () => {
      const strategy = makeStrategy();
      const message = {
        id: "msg-run-1",
        role: "assistant" as const,
        content: "Run 模式訊息",
        timestamp: new Date().toISOString(),
      };

      strategy.persistMessage("pod-1", message);

      expect(runStore.upsertRunMessage).toHaveBeenCalledWith(
        RUN_ID,
        "pod-1",
        message,
      );
    });

    it("run.status 為 cancelled 時應跳過 upsertRunMessage", () => {
      vi.spyOn(runStore, "getRun").mockReturnValue({
        id: RUN_ID,
        status: "cancelled",
      } as ReturnType<typeof runStore.getRun>);
      const strategy = makeStrategy();
      const message = {
        id: "msg-run-2",
        role: "assistant" as const,
        content: "cancelled run 訊息",
        timestamp: new Date().toISOString(),
      };

      strategy.persistMessage("pod-1", message);

      expect(runStore.upsertRunMessage).not.toHaveBeenCalled();
    });

    it("run 不存在時應跳過 upsertRunMessage", () => {
      vi.spyOn(runStore, "getRun").mockReturnValue(undefined);
      const strategy = makeStrategy();
      const message = {
        id: "msg-run-3",
        role: "assistant" as const,
        content: "不存在 run 的訊息",
        timestamp: new Date().toISOString(),
      };

      strategy.persistMessage("pod-1", message);

      expect(runStore.upsertRunMessage).not.toHaveBeenCalled();
    });
  });

  describe("updateLastResponseSummary", () => {
    it("有 pod instance 時應更新持久化摘要欄位", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue({
        id: "instance-1",
      } as ReturnType<typeof runStore.getPodInstance>);
      const strategy = makeStrategy();

      strategy.updateLastResponseSummary("pod-1", "最新摘要");

      expect(runStore.updatePodInstanceLastResponseSummary).toHaveBeenCalledWith(
        "instance-1",
        "最新摘要",
      );
    });

    it("找不到 pod instance 時應跳過摘要更新", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);
      const strategy = makeStrategy();

      strategy.updateLastResponseSummary("pod-1", "最新摘要");

      expect(
        runStore.updatePodInstanceLastResponseSummary,
      ).not.toHaveBeenCalled();
    });
  });

  describe("addUserMessage", () => {
    it("應呼叫 injectRunUserMessage 帶入正確參數（字串內容）", async () => {
      const injectSpy = vi
        .spyOn(runChatHelpers, "injectRunUserMessage")
        .mockResolvedValue(undefined);
      const strategy = makeStrategy();
      const content = "使用者的 run 訊息";

      await strategy.addUserMessage("pod-1", content);

      expect(injectSpy).toHaveBeenCalledWith(runContext, "pod-1", content);
    });

    it("應呼叫 injectRunUserMessage 帶入正確參數（ContentBlock 陣列）", async () => {
      const injectSpy = vi
        .spyOn(runChatHelpers, "injectRunUserMessage")
        .mockResolvedValue(undefined);
      const strategy = makeStrategy();
      const content = [{ type: "text" as const, text: "Run 測試" }];

      await strategy.addUserMessage("pod-1", content);

      expect(injectSpy).toHaveBeenCalledWith(runContext, "pod-1", content);
    });
  });

  describe("onStreamStart", () => {
    it("應呼叫 runExecutionService.registerActiveStream", () => {
      const strategy = makeStrategy();
      strategy.onStreamStart("pod-1");

      expect(runExecutionService.registerActiveStream).toHaveBeenCalledWith(
        RUN_ID,
        "pod-1",
      );
    });
  });

  describe("onStreamComplete", () => {
    it("應呼叫 runExecutionService.unregisterActiveStream", () => {
      const strategy = makeStrategy();
      strategy.onStreamComplete("pod-1", undefined);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        RUN_ID,
        "pod-1",
      );
    });

    it("sessionId 為 undefined 時不應呼叫 updatePodInstanceSessionId", () => {
      const strategy = makeStrategy();
      strategy.onStreamComplete("pod-1", undefined);

      expect(runStore.updatePodInstanceSessionId).not.toHaveBeenCalled();
    });

    it("有 sessionId 且 instance 存在時應呼叫 updatePodInstanceSessionId", () => {
      const sessionId = "run-new-session";
      const instance = { id: "instance-abc", sessionId: null };
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(
        instance as ReturnType<typeof runStore.getPodInstance>,
      );

      const strategy = makeStrategy();
      strategy.onStreamComplete("pod-1", sessionId);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        RUN_ID,
        "pod-1",
      );
      expect(runStore.getPodInstance).toHaveBeenCalledWith(RUN_ID, "pod-1");
      expect(runStore.updatePodInstanceSessionId).toHaveBeenCalledWith(
        instance.id,
        sessionId,
      );
    });

    it("有 sessionId 但 instance 不存在時不應呼叫 updatePodInstanceSessionId", () => {
      vi.spyOn(runStore, "getPodInstance").mockReturnValue(undefined);

      const strategy = makeStrategy();
      strategy.onStreamComplete("pod-1", "some-session");

      expect(runStore.updatePodInstanceSessionId).not.toHaveBeenCalled();
    });
  });

  describe("onStreamAbort", () => {
    it("應呼叫 unregisterActiveStream 和 errorPodInstance", () => {
      const reason = "使用者手動中斷";
      const strategy = makeStrategy();
      strategy.onStreamAbort("pod-1", reason);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        RUN_ID,
        "pod-1",
      );
      expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
        runContext,
        "pod-1",
        reason,
      );
    });
  });

  describe("onStreamError", () => {
    it("應呼叫 runExecutionService.unregisterActiveStream", () => {
      const strategy = makeStrategy();
      strategy.onStreamError("pod-1");

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        RUN_ID,
        "pod-1",
      );
    });

    it("不應呼叫 errorPodInstance（錯誤由上層處理）", () => {
      const strategy = makeStrategy();
      strategy.onStreamError("pod-1");

      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
    });
  });
});
