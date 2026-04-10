import type { Mock } from "vitest";

vi.mock("../../src/services/runStore.js", () => ({
  runStore: {
    getPodInstance: vi.fn(() => undefined),
    upsertRunMessage: vi.fn(() => {}),
    updatePodInstanceClaudeSessionId: vi.fn(() => {}),
  },
}));

vi.mock("../../src/services/workflow/runExecutionService.js", () => ({
  runExecutionService: {
    startPodInstance: vi.fn(() => {}),
    summarizingPodInstance: vi.fn(() => {}),
    errorPodInstance: vi.fn(() => {}),
    registerActiveStream: vi.fn(() => {}),
    unregisterActiveStream: vi.fn(() => {}),
  },
}));

vi.mock("../../src/utils/runChatHelpers.js", () => ({
  injectRunUserMessage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/services/chatEmitStrategy.js", () => ({
  createRunEmitStrategy: vi.fn(() => ({
    emitText: vi.fn(() => {}),
    emitToolUse: vi.fn(() => {}),
    emitToolResult: vi.fn(() => {}),
    emitComplete: vi.fn(() => {}),
  })),
}));

import { RunModeExecutionStrategy } from "../../src/services/executionStrategy.js";
import { runStore } from "../../src/services/runStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { injectRunUserMessage } from "../../src/utils/runChatHelpers.js";
import { createRunEmitStrategy } from "../../src/services/chatEmitStrategy.js";
import type { RunContext } from "../../src/types/run.js";

/** 取得 mock 函式的型別化引用 */
function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

describe("RunModeExecutionStrategy", () => {
  const canvasId = "test-canvas";
  const runId = "test-run";
  const podId = "test-pod";
  const sourcePodId = "source-pod";

  const runContext: RunContext = {
    runId,
    canvasId,
    sourcePodId,
  };

  function makeStrategy() {
    return new RunModeExecutionStrategy(canvasId, runContext);
  }

  beforeEach(() => {
    asMock(runExecutionService.startPodInstance).mockClear();
    asMock(runExecutionService.summarizingPodInstance).mockClear();
    asMock(runExecutionService.errorPodInstance).mockClear();
    asMock(runExecutionService.registerActiveStream).mockClear();
    asMock(runExecutionService.unregisterActiveStream).mockClear();
    asMock(runStore.getPodInstance).mockClear();
    asMock(runStore.upsertRunMessage).mockClear();
    asMock(runStore.updatePodInstanceClaudeSessionId).mockClear();
    asMock(injectRunUserMessage).mockClear();
    asMock(createRunEmitStrategy).mockClear();
  });

  describe("setStatus", () => {
    it("狀態為 chatting 時應呼叫 runExecutionService.startPodInstance", () => {
      const strategy = makeStrategy();
      strategy.setStatus(podId, "chatting");

      expect(runExecutionService.startPodInstance).toHaveBeenCalledWith(
        runContext,
        podId,
      );
    });

    it("狀態為 summarizing 時應呼叫 runExecutionService.summarizingPodInstance", () => {
      const strategy = makeStrategy();
      strategy.setStatus(podId, "summarizing");

      expect(runExecutionService.summarizingPodInstance).toHaveBeenCalledWith(
        runContext,
        podId,
      );
    });

    it("狀態為 error 時應呼叫 runExecutionService.errorPodInstance", () => {
      const strategy = makeStrategy();
      strategy.setStatus(podId, "error");

      expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
        runContext,
        podId,
        "執行發生錯誤",
      );
    });

    it("狀態為 idle 時應為 no-op", () => {
      const strategy = makeStrategy();
      strategy.setStatus(podId, "idle");

      expect(runExecutionService.startPodInstance).not.toHaveBeenCalled();
      expect(runExecutionService.summarizingPodInstance).not.toHaveBeenCalled();
      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
    });
  });

  describe("getSessionId", () => {
    it("Pod instance 不存在時應回傳 undefined", () => {
      asMock(runStore.getPodInstance).mockReturnValue(undefined);

      const strategy = makeStrategy();
      const result = strategy.getSessionId(podId);

      expect(runStore.getPodInstance).toHaveBeenCalledWith(runId, podId);
      expect(result).toBeUndefined();
    });

    it("Pod instance 存在且有 claudeSessionId 時應回傳該值", () => {
      const sessionId = "run-session-789";
      asMock(runStore.getPodInstance).mockReturnValue({
        id: "instance-1",
        claudeSessionId: sessionId,
      });

      const strategy = makeStrategy();
      const result = strategy.getSessionId(podId);

      expect(result).toBe(sessionId);
    });

    it("Pod instance 的 claudeSessionId 為 null 時應回傳 undefined", () => {
      asMock(runStore.getPodInstance).mockReturnValue({
        id: "instance-1",
        claudeSessionId: null,
      });

      const strategy = makeStrategy();
      const result = strategy.getSessionId(podId);

      expect(result).toBeUndefined();
    });
  });

  describe("getQueryKey", () => {
    it("應回傳 `runId:podId` 格式", () => {
      const strategy = makeStrategy();
      const result = strategy.getQueryKey(podId);

      expect(result).toBe(`${runId}:${podId}`);
    });
  });

  describe("createEmitStrategy", () => {
    it("應呼叫 createRunEmitStrategy 並回傳有四個 emit 方法的物件", () => {
      const strategy = makeStrategy();
      const emitStrategy = strategy.createEmitStrategy();

      expect(createRunEmitStrategy).toHaveBeenCalledWith(runId);
      expect(emitStrategy).toHaveProperty("emitText");
      expect(emitStrategy).toHaveProperty("emitToolUse");
      expect(emitStrategy).toHaveProperty("emitToolResult");
      expect(emitStrategy).toHaveProperty("emitComplete");
    });
  });

  describe("persistMessage", () => {
    it("應呼叫 runStore.upsertRunMessage 並帶入正確參數", () => {
      const strategy = makeStrategy();
      const message = {
        id: "msg-run-1",
        role: "assistant" as const,
        content: "Run 模式訊息",
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      strategy.persistMessage(podId, message);

      expect(runStore.upsertRunMessage).toHaveBeenCalledWith(
        runId,
        podId,
        message,
      );
    });
  });

  describe("addUserMessage", () => {
    it("應呼叫 injectRunUserMessage 並帶入正確參數（字串內容）", async () => {
      const strategy = makeStrategy();
      const content = "使用者的 run 訊息";

      await strategy.addUserMessage(podId, content);

      expect(injectRunUserMessage).toHaveBeenCalledWith(
        runContext,
        podId,
        content,
      );
    });

    it("應呼叫 injectRunUserMessage 並帶入正確參數（ContentBlock 陣列）", async () => {
      const strategy = makeStrategy();
      const content = [{ type: "text" as const, text: "Run 測試" }];

      await strategy.addUserMessage(podId, content);

      expect(injectRunUserMessage).toHaveBeenCalledWith(
        runContext,
        podId,
        content,
      );
    });
  });

  describe("isBusy", () => {
    it("應固定回傳 false", () => {
      const strategy = makeStrategy();
      const result = strategy.isBusy(podId);

      expect(result).toBe(false);
    });
  });

  describe("onStreamStart", () => {
    it("應呼叫 runExecutionService.registerActiveStream", () => {
      const strategy = makeStrategy();
      strategy.onStreamStart(podId);

      expect(runExecutionService.registerActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );
    });
  });

  describe("onStreamComplete", () => {
    it("應呼叫 runExecutionService.unregisterActiveStream", () => {
      const strategy = makeStrategy();
      strategy.onStreamComplete(podId, undefined);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );
    });

    it("有 sessionId 且 instance 存在時應更新 claudeSessionId", () => {
      const sessionId = "run-new-session";
      const instance = { id: "instance-abc", claudeSessionId: null };
      asMock(runStore.getPodInstance).mockReturnValue(instance);

      const strategy = makeStrategy();
      strategy.onStreamComplete(podId, sessionId);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );
      expect(runStore.getPodInstance).toHaveBeenCalledWith(runId, podId);
      expect(runStore.updatePodInstanceClaudeSessionId).toHaveBeenCalledWith(
        instance.id,
        sessionId,
      );
    });

    it("sessionId 為 undefined 時不應呼叫 updatePodInstanceClaudeSessionId", () => {
      const strategy = makeStrategy();
      strategy.onStreamComplete(podId, undefined);

      expect(runStore.updatePodInstanceClaudeSessionId).not.toHaveBeenCalled();
    });

    it("有 sessionId 但 instance 不存在時不應呼叫 updatePodInstanceClaudeSessionId", () => {
      asMock(runStore.getPodInstance).mockReturnValue(undefined);

      const strategy = makeStrategy();
      strategy.onStreamComplete(podId, "some-session");

      expect(runStore.updatePodInstanceClaudeSessionId).not.toHaveBeenCalled();
    });
  });

  describe("onStreamAbort", () => {
    it("應呼叫 unregisterActiveStream 和 errorPodInstance", () => {
      const reason = "使用者手動中斷";
      const strategy = makeStrategy();
      strategy.onStreamAbort(podId, reason);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );
      expect(runExecutionService.errorPodInstance).toHaveBeenCalledWith(
        runContext,
        podId,
        reason,
      );
    });
  });

  describe("onStreamError", () => {
    it("應呼叫 runExecutionService.unregisterActiveStream", () => {
      const strategy = makeStrategy();
      strategy.onStreamError(podId);

      expect(runExecutionService.unregisterActiveStream).toHaveBeenCalledWith(
        runId,
        podId,
      );
    });

    it("不應呼叫 errorPodInstance（錯誤由上層處理）", () => {
      const strategy = makeStrategy();
      strategy.onStreamError(podId);

      expect(runExecutionService.errorPodInstance).not.toHaveBeenCalled();
    });
  });

  describe("getRunContext", () => {
    it("應回傳建構時傳入的 runContext", () => {
      const strategy = makeStrategy();
      const result = strategy.getRunContext();

      expect(result).toBe(runContext);
    });

    it("回傳的 runContext 應包含正確的 runId 和 canvasId", () => {
      const strategy = makeStrategy();
      const result = strategy.getRunContext();

      expect(result?.runId).toBe(runId);
      expect(result?.canvasId).toBe(canvasId);
    });
  });
});
