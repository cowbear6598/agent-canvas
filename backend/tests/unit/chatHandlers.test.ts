/**
 * chatHandlers 單元測試 — user flow F1 / F3
 *
 * F1：新建 pod 送出訊息 → 系統建立一筆新的 Run
 * F3：連續快速送多則訊息 → 兩筆 Run 同時平行進行
 *
 * Mock 邊界：
 *   必須 mock：launchRun / validatePod / validateIntegrationBindings（間接 mock）
 *              / abortRegistry / canvasStore（讓 withCanvasId 取得 canvasId）
 *              / socketService / websocketResponse / logger
 *   不可 mock：isPodBusy 等純函式（已不存在於 multi-run 架構）
 *   不可 mock：launchRun 內部呼叫的 runStore / runExecutionService（各有自己的單測）
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

// canvasStore：讓 withCanvasId 能從 connectionId 取得 CANVAS_ID
// 使用字串字面值，避免 vi.mock 提升（hoisting）時常數尚未初始化的問題
vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => "canvas-chat-test"),
    getById: vi.fn((id: string) => ({ id, name: "test-canvas", sortIndex: 0 })),
  },
}));

// podStore：validatePod 的 getById 依賴（回傳預設 mock pod）
vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getById: vi.fn(() => ({
      id: "pod-chat-test",
      name: "TestPod",
      status: "idle",
      workspacePath: "/ws/test",
      x: 0,
      y: 0,
      rotation: 0,
      sessionId: null,
      skillIds: [],
      mcpServerNames: [],
      provider: "claude",
      providerConfig: { model: "opus" },
      repositoryId: null,
      commandId: null,
      integrationBindings: [], // 無 integration binding，validateIntegrationBindings 直接通過
    })),
  },
}));

// launchRun：multi-run SDK 入口（core boundary）
vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchRun: vi.fn().mockResolvedValue({
    runId: "run-1",
    canvasId: "canvas-chat-test",
    sourcePodId: "pod-chat-test",
  }),
}));

// abortRegistry：避免真實 abort 機制影響測試
vi.mock("../../src/services/provider/abortRegistry.js", () => ({
  abortRegistry: {
    abortByPodId: vi.fn(() => true),
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

// chatCallbacks：避免 DB side-effect
vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onChatAborted: vi.fn().mockResolvedValue(undefined),
  onRunChatComplete: vi.fn().mockResolvedValue(undefined),
}));

// socketService：WebSocket boundary
vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(),
    emitToConnection: vi.fn(),
    emitToAll: vi.fn(),
  },
}));

// websocketResponse：避免真實 WebSocket emit
vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

// logger：side-effect only
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── imports ─────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";

import { handleChatSend } from "../../src/handlers/chatHandlers.js";
import * as runChatHelpersModule from "../../src/utils/runChatHelpers.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-chat-test";
const POD_ID = "pod-chat-test";
const CONNECTION_ID = "conn-chat-test";
const REQUEST_ID = "req-chat-test";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // 重設 launchRun 預設回傳值
  asMock(runChatHelpersModule.launchRun).mockResolvedValue({
    runId: "run-1",
    canvasId: CANVAS_ID,
    sourcePodId: POD_ID,
  });
});

// ─── F1：新建 pod 送出訊息 → 建立一筆新 Run ───────────────────────────────────

describe("F1：handleChatSend plain message → 建立新 Run", () => {
  it("F1-1：plain message 路徑呼叫 launchRun 一次", async () => {
    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: "Hello World",
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      } as any,
      REQUEST_ID,
    );

    expect(runChatHelpersModule.launchRun).toHaveBeenCalledTimes(1);
  });

  it("F1-2：launchRun 帶入正確的 canvasId / podId / message", async () => {
    const testMessage = "測試送出的訊息";

    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: testMessage,
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      } as any,
      REQUEST_ID,
    );

    expect(runChatHelpersModule.launchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: testMessage,
      }),
    );
  });

  it("F1-3：launchRun 帶入 abortable: true（chat send 允許 abort）", async () => {
    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: "any",
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      } as any,
      REQUEST_ID,
    );

    expect(runChatHelpersModule.launchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        abortable: true,
      }),
    );
  });
});

// ─── F3：連續快速送多則訊息 → 兩筆 Run 平行進行 ──────────────────────────────

describe("F3：連續兩次 handleChatSend → launchRun 被呼叫兩次（無 busy check 攔截）", () => {
  it("F3-1：連續兩次呼叫 handleChatSend，launchRun 各被呼叫一次，共兩次", async () => {
    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: "第一則訊息",
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      } as any,
      REQUEST_ID,
    );

    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: "第二則訊息",
        requestId: `${REQUEST_ID}-2`,
        canvasId: CANVAS_ID,
      } as any,
      `${REQUEST_ID}-2`,
    );

    expect(runChatHelpersModule.launchRun).toHaveBeenCalledTimes(2);
  });

  it("F3-2：第一次與第二次 launchRun 呼叫均帶正確的 canvasId / podId", async () => {
    const msg1 = "訊息一";
    const msg2 = "訊息二";

    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: msg1,
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      } as any,
      REQUEST_ID,
    );

    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: msg2,
        requestId: `${REQUEST_ID}-2`,
        canvasId: CANVAS_ID,
      } as any,
      `${REQUEST_ID}-2`,
    );

    const calls = asMock(runChatHelpersModule.launchRun).mock.calls;

    expect(calls[0][0]).toMatchObject({
      canvasId: CANVAS_ID,
      podId: POD_ID,
      message: msg1,
    });
    expect(calls[1][0]).toMatchObject({
      canvasId: CANVAS_ID,
      podId: POD_ID,
      message: msg2,
    });
  });

  it("F3-3：兩次 launchRun 均帶 commandNotFoundBehavior: skip（chat send 路徑）", async () => {
    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: "msg1",
        requestId: REQUEST_ID,
        canvasId: CANVAS_ID,
      } as any,
      REQUEST_ID,
    );

    await handleChatSend(
      CONNECTION_ID,
      {
        podId: POD_ID,
        message: "msg2",
        requestId: `${REQUEST_ID}-2`,
        canvasId: CANVAS_ID,
      } as any,
      `${REQUEST_ID}-2`,
    );

    const calls = asMock(runChatHelpersModule.launchRun).mock.calls;
    expect(calls[0][0]).toMatchObject({ commandNotFoundBehavior: "skip" });
    expect(calls[1][0]).toMatchObject({ commandNotFoundBehavior: "skip" });
  });
});
