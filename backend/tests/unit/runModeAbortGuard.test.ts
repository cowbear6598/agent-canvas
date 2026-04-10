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
    isRunAborted: vi.fn(() => false),
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
import type { RunContext } from "../../src/types/run.js";

/** 取得 mock 函式的型別化引用 */
function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

describe("RunModeExecutionStrategy - 中止檢查", () => {
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
    asMock(runExecutionService.isRunAborted).mockClear();
    asMock(runStore.upsertRunMessage).mockClear();
    asMock(injectRunUserMessage).mockClear();
  });

  describe("addUserMessage 中止檢查", () => {
    it("Run 已中止時應跳過寫入", async () => {
      asMock(runExecutionService.isRunAborted).mockReturnValue(true);

      const strategy = makeStrategy();
      await strategy.addUserMessage(podId, "測試訊息");

      expect(runExecutionService.isRunAborted).toHaveBeenCalledWith(runId);
      expect(injectRunUserMessage).not.toHaveBeenCalled();
    });

    it("Run 未中止時應正常寫入", async () => {
      asMock(runExecutionService.isRunAborted).mockReturnValue(false);

      const strategy = makeStrategy();
      const content = "測試訊息";
      await strategy.addUserMessage(podId, content);

      expect(runExecutionService.isRunAborted).toHaveBeenCalledWith(runId);
      expect(injectRunUserMessage).toHaveBeenCalledWith(
        runContext,
        podId,
        content,
      );
    });
  });

  describe("persistMessage 中止檢查", () => {
    it("Run 已中止時應跳過寫入", () => {
      asMock(runExecutionService.isRunAborted).mockReturnValue(true);

      const strategy = makeStrategy();
      const message = {
        id: "msg-1",
        role: "assistant" as const,
        content: "Run 模式訊息",
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      strategy.persistMessage(podId, message);

      expect(runExecutionService.isRunAborted).toHaveBeenCalledWith(runId);
      expect(runStore.upsertRunMessage).not.toHaveBeenCalled();
    });

    it("Run 未中止時應正常寫入", () => {
      asMock(runExecutionService.isRunAborted).mockReturnValue(false);

      const strategy = makeStrategy();
      const message = {
        id: "msg-2",
        role: "assistant" as const,
        content: "Run 模式訊息",
        timestamp: "2024-01-01T00:00:00.000Z",
      };

      strategy.persistMessage(podId, message);

      expect(runExecutionService.isRunAborted).toHaveBeenCalledWith(runId);
      expect(runStore.upsertRunMessage).toHaveBeenCalledWith(
        runId,
        podId,
        message,
      );
    });
  });
});
