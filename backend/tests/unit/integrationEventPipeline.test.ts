import type { Mock } from "vitest";

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    findByIntegrationApp: vi.fn(() => []),
    findByIntegrationAppAndResource: vi.fn(() => []),
    getById: vi.fn(),
    setStatus: vi.fn(),
  },
}));

vi.mock("../../src/services/messageStore.js", () => ({
  messageStore: {
    addMessage: vi.fn(() =>
      Promise.resolve({ success: true, data: { id: "msg-1" } }),
    ),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(),
  },
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: vi.fn(() =>
    Promise.resolve({
      messageId: "stream-1",
      content: "回覆",
      hasContent: true,
      aborted: false,
    }),
  ),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/workflow/index.js", () => ({
  workflowExecutionService: {
    checkAndTriggerWorkflows: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("../../src/utils/workflowChainTraversal.js", () => ({
  isWorkflowChainBusy: vi.fn(() => false),
}));

vi.mock("../../src/services/integration/integrationRegistry.js", () => ({
  integrationRegistry: {
    get: vi.fn(() => undefined),
  },
}));

vi.mock("../../src/utils/runChatHelpers.js", () => ({
  launchMultiInstanceRun: vi.fn(() =>
    Promise.resolve({ runId: "run-1", canvasId: "canvas-1" }),
  ),
}));

vi.mock("../../src/utils/chatCallbacks.js", () => ({
  onRunChatComplete: vi.fn(),
  onChatComplete: vi.fn(),
  onChatAborted: vi.fn(),
}));

vi.mock("../../src/utils/chatHelpers.js", () => ({
  injectUserMessage: vi.fn(() => Promise.resolve()),
  extractDisplayContent: vi.fn((text: string) => text),
}));

vi.mock("../../src/services/integration/replyContextStore.js", () => ({
  replyContextStore: {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
  buildReplyContextKey: vi.fn((runContext: unknown, podId: string) => {
    if (runContext && typeof runContext === "object" && "runId" in runContext) {
      return `${(runContext as { runId: string }).runId}:${podId}`;
    }
    return `pod:${podId}`;
  }),
  setReplyContextIfPresent: vi.fn(),
}));

import { integrationEventPipeline } from "../../src/services/integration/integrationEventPipeline.js";
import { podStore } from "../../src/services/podStore.js";
import { executeStreamingChat } from "../../src/services/claude/streamingChatExecutor.js";
import { workflowExecutionService } from "../../src/services/workflow/index.js";
import { isWorkflowChainBusy } from "../../src/utils/workflowChainTraversal.js";
import { integrationRegistry } from "../../src/services/integration/integrationRegistry.js";
import { launchMultiInstanceRun } from "../../src/utils/runChatHelpers.js";
import { onRunChatComplete } from "../../src/utils/chatCallbacks.js";
import { injectUserMessage } from "../../src/utils/chatHelpers.js";
import {
  replyContextStore,
  setReplyContextIfPresent,
} from "../../src/services/integration/replyContextStore.js";
import type { Pod } from "../../src/types/index.js";
import type { NormalizedEvent } from "../../src/services/integration/types.js";
import type { RunContext } from "../../src/types/run.js";

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Test Pod",
    status: "idle",
    workspacePath: "/workspace/pod-1",
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    outputStyleId: null,
    skillIds: [],
    subAgentIds: [],
    mcpServerIds: [],
    provider: "claude",
    providerConfig: { model: "opus" },
    repositoryId: null,
    commandId: null,
    multiInstance: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    provider: "slack",
    appId: "app-1",
    resourceId: "C123",
    userName: "testuser",
    text: "[Slack: @testuser] <user_data>測試訊息</user_data>",
    rawEvent: {},
    ...overrides,
  };
}

describe("IntegrationEventPipeline", () => {
  const canvasId = "canvas-1";
  const podId = "pod-1";

  const mockRunContext: RunContext = { runId: "run-1", canvasId: "canvas-1" };

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(podStore.findByIntegrationApp).mockReturnValue([]);
    asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([]);
    asMock(podStore.getById).mockReturnValue(undefined);
    asMock(executeStreamingChat).mockResolvedValue({
      messageId: "stream-1",
      content: "回覆",
      hasContent: true,
      aborted: false,
    });
    asMock(workflowExecutionService.checkAndTriggerWorkflows).mockResolvedValue(
      undefined,
    );
    asMock(isWorkflowChainBusy).mockReturnValue(false);
    asMock(integrationRegistry.get).mockReturnValue(undefined);
    asMock(launchMultiInstanceRun).mockResolvedValue(mockRunContext);
    asMock(onRunChatComplete).mockReturnValue(undefined);
    asMock(injectUserMessage).mockResolvedValue(undefined);
    asMock(replyContextStore.set).mockReturnValue(undefined);
    asMock(replyContextStore.get).mockReturnValue(undefined);
    asMock(replyContextStore.delete).mockReturnValue(undefined);
  });

  describe("processEvent", () => {
    it("找不到綁定 Pod 時不呼叫 executeStreamingChat", async () => {
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([]);

      await integrationEventPipeline.processEvent(
        "slack",
        "app-1",
        makeEvent(),
      );

      expect(executeStreamingChat).not.toHaveBeenCalled();
    });

    it("正確注入訊息至綁定的 Pod", async () => {
      const pod = makePod();
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod },
      ]);
      asMock(podStore.getById).mockReturnValue(pod);

      await integrationEventPipeline.processEvent(
        "slack",
        "app-1",
        makeEvent(),
      );

      expect(injectUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId,
          podId,
          content: "[Slack: @testuser] <user_data>測試訊息</user_data>",
        }),
      );
      expect(executeStreamingChat).toHaveBeenCalledWith(
        expect.objectContaining({ canvasId, podId, abortable: false }),
        { onComplete: expect.any(Function) },
      );
    });

    it("廣播 POD_CHAT_USER_MESSAGE 事件至前端（由 injectUserMessage 負責）", async () => {
      const pod = makePod();
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod },
      ]);
      asMock(podStore.getById).mockReturnValue(pod);

      await integrationEventPipeline.processEvent(
        "slack",
        "app-1",
        makeEvent(),
      );

      expect(injectUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ canvasId, podId }),
      );
    });

    it("完成後應觸發 workflow", async () => {
      const pod = makePod();
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod },
      ]);
      asMock(podStore.getById).mockReturnValue(pod);

      asMock(executeStreamingChat).mockImplementationOnce(
        async (
          _params: unknown,
          options: { onComplete?: (cId: string, pId: string) => Promise<void> },
        ) => {
          if (options?.onComplete) {
            await options.onComplete(canvasId, podId);
          }
          return {
            messageId: "stream-1",
            content: "回覆",
            hasContent: true,
            aborted: false,
          };
        },
      );

      await integrationEventPipeline.processEvent(
        "slack",
        "app-1",
        makeEvent(),
      );

      await vi.waitFor(() => {
        expect(
          workflowExecutionService.checkAndTriggerWorkflows,
        ).toHaveBeenCalledWith(canvasId, podId);
      });
    });

    describe("忙碌處理", () => {
      it("資源忙碌時不注入訊息", async () => {
        const pod = makePod({ status: "chatting" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(executeStreamingChat).not.toHaveBeenCalled();
      });

      it("資源忙碌且 Provider 有 sendMessage 時發送忙碌回覆", async () => {
        const pod = makePod({ status: "chatting" });
        // 使用不同的 resourceId 避免 singleton busyReplyCooldowns 狀態干擾
        const event = makeEvent({ resourceId: "C-sendmsg-test" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        const mockSendMessage = vi.fn(() =>
          Promise.resolve({ success: true as const }),
        );
        asMock(integrationRegistry.get).mockReturnValue({
          sendMessage: mockSendMessage,
        });

        await integrationEventPipeline.processEvent("slack", "app-1", event);

        expect(mockSendMessage).toHaveBeenCalledWith(
          "app-1",
          "C-sendmsg-test",
          "目前忙碌中，請稍後再試",
          expect.any(Object),
        );
      });

      it("資源忙碌且 Provider 無 sendMessage 時不拋出錯誤", async () => {
        const pod = makePod({ status: "chatting" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(integrationRegistry.get).mockReturnValue({});

        await expect(
          integrationEventPipeline.processEvent("slack", "app-1", makeEvent()),
        ).resolves.not.toThrow();
      });

      it("同一資源短時間內第二次忙碌不再發送忙碌回覆", async () => {
        const pod = makePod({ status: "chatting", id: "pod-busy" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        const mockSendMessage = vi.fn(() =>
          Promise.resolve({ success: true as const }),
        );
        asMock(integrationRegistry.get).mockReturnValue({
          sendMessage: mockSendMessage,
        });

        const mockNow = vi.spyOn(Date, "now");
        mockNow.mockReturnValue(200_000_000);

        const event = makeEvent({ resourceId: "C-busy" });
        await integrationEventPipeline.processEvent("slack", "app-1", event);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);

        // 模擬 10 秒後（30 秒冷卻未到）
        mockNow.mockReturnValue(200_010_000);
        await integrationEventPipeline.processEvent("slack", "app-1", event);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);

        mockNow.mockRestore();
      });

      it("Workflow 鏈中有忙碌 Pod 時判定為資源忙碌", async () => {
        const pod = makePod({ status: "idle" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(isWorkflowChainBusy).mockReturnValue(true);

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(executeStreamingChat).not.toHaveBeenCalled();
      });
    });

    describe("Pod 狀態處理", () => {
      it("Pod 狀態為 chatting 時跳過該 Pod", async () => {
        // 測試設計：
        // - boundPods（filteredPods）含一個 chatting Pod（normalPods）
        // - isResourceBusy 檢查時，傳入的 pods 參數也是 chatting，所以 isResourceBusy 回傳 true
        // - executeNormalPods 直接因 isResourceBusy=true 跳過，executeStreamingChat 不被呼叫
        const pod = makePod({ status: "chatting" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(podStore.getById).mockReturnValue(pod);

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(executeStreamingChat).not.toHaveBeenCalled();
      });

      it("Pod 狀態為 error 時先重置為 idle 再注入訊息", async () => {
        const pod = makePod({ status: "error" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        // injectMessage 中的二次確認 getById 回傳 idle（error 被重置後）
        asMock(podStore.getById).mockReturnValue({ ...pod, status: "idle" });

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(podStore.setStatus).toHaveBeenCalledWith(
          canvasId,
          pod.id,
          "idle",
        );
        expect(executeStreamingChat).toHaveBeenCalled();
      });

      it("executeStreamingChat 拋出錯誤時 injectMessage 的 catch 不設定 Pod 狀態，錯誤向上拋出由 settleAndLogErrors 處理", async () => {
        const pod = makePod();
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(podStore.getById).mockReturnValue(pod);
        asMock(executeStreamingChat).mockRejectedValue(new Error("串流失敗"));

        // processEvent 本身不拋出（由 settleAndLogErrors 吞掉），但 podStore.setStatus 不應被以 "error" 呼叫
        await expect(
          integrationEventPipeline.processEvent("slack", "app-1", makeEvent()),
        ).resolves.not.toThrow();

        expect(podStore.setStatus).not.toHaveBeenCalledWith(
          canvasId,
          podId,
          "error",
        );
      });

      it("Pod 在二次確認時已變為 chatting 應跳過注入", async () => {
        const pod = makePod({ status: "idle" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        // 二次確認時回傳 chatting 狀態
        asMock(podStore.getById).mockReturnValue({
          ...pod,
          status: "chatting",
        });

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(executeStreamingChat).not.toHaveBeenCalled();
        expect(podStore.setStatus).not.toHaveBeenCalledWith(
          canvasId,
          podId,
          "chatting",
        );
      });
    });

    it("多個綁定 Pod 應並行執行", async () => {
      const pod1 = makePod({ id: "pod-1" });
      const pod2 = makePod({ id: "pod-2" });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod: pod1 },
        { canvasId, pod: pod2 },
      ]);
      asMock(podStore.getById).mockImplementation(
        (_canvasId: string, id: string) => {
          if (id === "pod-1") return pod1;
          if (id === "pod-2") return pod2;
          return undefined;
        },
      );

      const startedIds: string[] = [];
      const resolvers: Array<() => void> = [];

      asMock(executeStreamingChat).mockImplementation(
        async (params: { podId: string }) => {
          startedIds.push(params.podId);
          await new Promise<void>((resolve) => resolvers.push(resolve));
          return {
            messageId: "stream-1",
            content: "回覆",
            hasContent: true,
            aborted: false,
          };
        },
      );

      const handlePromise = integrationEventPipeline.processEvent(
        "slack",
        "app-1",
        makeEvent(),
      );

      await vi.waitFor(() => {
        expect(startedIds).toHaveLength(2);
      });

      resolvers.forEach((resolve) => resolve());
      await handlePromise;

      expect(executeStreamingChat).toHaveBeenCalledTimes(2);
    });

    it("部分 Pod 執行失敗不影響其他 Pod", async () => {
      const pod1 = makePod({ id: "pod-1" });
      const pod2 = makePod({ id: "pod-2" });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod: pod1 },
        { canvasId, pod: pod2 },
      ]);
      asMock(podStore.getById).mockImplementation(
        (_canvasId: string, id: string) => {
          if (id === "pod-1") return pod1;
          if (id === "pod-2") return pod2;
          return undefined;
        },
      );
      asMock(executeStreamingChat)
        .mockRejectedValueOnce(new Error("Pod 1 執行失敗"))
        .mockResolvedValueOnce({
          messageId: "stream-2",
          content: "回覆",
          hasContent: true,
          aborted: false,
        });

      await expect(
        integrationEventPipeline.processEvent("slack", "app-1", makeEvent()),
      ).resolves.not.toThrow();

      expect(executeStreamingChat).toHaveBeenCalledTimes(2);
    });

    describe("multiInstance Pod", () => {
      it("應呼叫 launchMultiInstanceRun 啟動 Run", async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(launchMultiInstanceRun).toHaveBeenCalledWith(
          expect.objectContaining({ canvasId, podId, abortable: false }),
        );
      });

      it("應跳過 busy check，即使 Pod 狀態為 chatting 也建立新 Run", async () => {
        const pod = makePod({ multiInstance: true, status: "chatting" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(launchMultiInstanceRun).toHaveBeenCalled();
      });

      it("processEvent 層級：所有 Pod 皆為 multiInstance 時回覆「已接收到命令」", async () => {
        const pod = makePod({ multiInstance: true, status: "chatting" });
        const event = makeEvent({ resourceId: "C-multi-only" });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        const mockSendMessage = vi.fn(() =>
          Promise.resolve({ success: true as const }),
        );
        asMock(integrationRegistry.get).mockReturnValue({
          sendMessage: mockSendMessage,
        });

        await integrationEventPipeline.processEvent("slack", "app-1", event);

        expect(mockSendMessage).toHaveBeenCalledWith(
          "app-1",
          "C-multi-only",
          "已接收到命令",
          expect.any(Object),
        );
      });

      it("完成後應呼叫 onRunChatComplete", async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        asMock(launchMultiInstanceRun).mockImplementationOnce(
          async (params: { onComplete: (runContext: RunContext) => void }) => {
            params.onComplete(mockRunContext);
            return mockRunContext;
          },
        );

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(onRunChatComplete).toHaveBeenCalledWith(
          mockRunContext,
          canvasId,
          podId,
        );
      });

      it("執行失敗時不設定 Pod 全域狀態為 error", async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(launchMultiInstanceRun).mockRejectedValueOnce(
          new Error("串流失敗"),
        );

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(podStore.setStatus).not.toHaveBeenCalledWith(
          canvasId,
          podId,
          "error",
        );
      });

      it("非 multiInstance Pod 維持現有行為（走 injectUserMessage 路徑）", async () => {
        const pod = makePod({ multiInstance: false });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(podStore.getById).mockReturnValue(pod);

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(launchMultiInstanceRun).not.toHaveBeenCalled();
        expect(injectUserMessage).toHaveBeenCalled();
      });

      it("event 有 senderId/threadTs 時應設定 replyContextStore", async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);

        const event = makeEvent({
          senderId: "U123",
          messageTs: "1234.5678",
          threadTs: "1111.2222",
        });

        asMock(launchMultiInstanceRun).mockImplementationOnce(
          async (params: {
            onRunContextCreated?: (runContext: RunContext) => void;
            onComplete: (runContext: RunContext) => void;
          }) => {
            params.onRunContextCreated?.(mockRunContext);
            params.onComplete(mockRunContext);
            return mockRunContext;
          },
        );

        await integrationEventPipeline.processEvent("slack", "app-1", event);

        expect(setReplyContextIfPresent).toHaveBeenCalledWith(
          "run-1:pod-1",
          event,
        );
        expect(replyContextStore.delete).toHaveBeenCalledWith("run-1:pod-1");
      });

      it("launchMultiInstanceRun 失敗時不設定 Pod 全域狀態為 error", async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(launchMultiInstanceRun).mockRejectedValueOnce(
          new Error("建立 Run 失敗"),
        );

        await integrationEventPipeline.processEvent(
          "slack",
          "app-1",
          makeEvent(),
        );

        expect(podStore.setStatus).not.toHaveBeenCalledWith(
          canvasId,
          podId,
          "error",
        );
      });

      it("launchMultiInstanceRun 失敗且未設定 replyContext 時不拋出錯誤", async () => {
        const pod = makePod({ multiInstance: true });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(launchMultiInstanceRun).mockRejectedValueOnce(
          new Error("建立 Run 失敗"),
        );

        await expect(
          integrationEventPipeline.processEvent("slack", "app-1", makeEvent()),
        ).resolves.not.toThrow();

        // onRunContextCreated 未被呼叫，故 setReplyContextIfPresent 不應有呼叫
        expect(setReplyContextIfPresent).not.toHaveBeenCalled();
      });

      it("非 multiInstance event 有 senderId 時應設定 replyContextStore", async () => {
        const pod = makePod({ multiInstance: false });
        asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
          { canvasId, pod },
        ]);
        asMock(podStore.getById).mockReturnValue(pod);

        const event = makeEvent({ senderId: "U456", messageTs: "9999.0000" });

        await integrationEventPipeline.processEvent("slack", "app-1", event);

        expect(setReplyContextIfPresent).toHaveBeenCalledWith(
          "pod:pod-1",
          event,
        );
        expect(replyContextStore.delete).toHaveBeenCalledWith("pod:pod-1");
      });
    });
  });

  describe("safeProcessEvent", () => {
    it("應以 fire-and-forget 方式呼叫 processEvent，不拋出錯誤", async () => {
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([]);

      expect(() => {
        integrationEventPipeline.safeProcessEvent(
          "slack",
          "app-1",
          makeEvent(),
        );
      }).not.toThrow();

      await vi.waitFor(() => {
        expect(podStore.findByIntegrationAppAndResource).toHaveBeenCalled();
      });
    });
  });

  describe("確認回覆", () => {
    async function assertAckReply(options: {
      provider: string;
      appId: string;
      event: Partial<NormalizedEvent>;
      pods: Pod[];
      expectedMessage: string;
      expectedExtra?: Record<string, unknown>;
      shouldCall?: boolean;
    }): Promise<void> {
      const {
        provider,
        appId,
        event,
        pods,
        expectedMessage,
        expectedExtra,
        shouldCall = true,
      } = options;
      const fullEvent = makeEvent(event);

      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue(
        pods.map((pod) => ({ canvasId, pod })),
      );
      asMock(podStore.getById).mockImplementation((_cId: string, id: string) =>
        pods.find((p) => p.id === id),
      );

      const mockSendMessage = vi.fn(() =>
        Promise.resolve({ success: true as const }),
      );
      const mockBuildAckExtra = vi.fn(() => expectedExtra ?? {});
      asMock(integrationRegistry.get).mockReturnValue({
        sendMessage: mockSendMessage,
        buildAckExtra: mockBuildAckExtra,
      });

      await integrationEventPipeline.processEvent(provider, appId, fullEvent);

      if (!shouldCall) {
        expect(mockSendMessage).not.toHaveBeenCalled();
        return;
      }

      const extraMatcher = expectedExtra
        ? expect.objectContaining(expectedExtra)
        : expect.any(Object);

      expect(mockSendMessage).toHaveBeenCalledWith(
        appId,
        fullEvent.resourceId,
        expectedMessage,
        extraMatcher,
      );
    }

    it("Slack 一般模式 Pod 非忙碌 — 回覆「已接收到命令」並帶 senderId 和 thread", async () => {
      await assertAckReply({
        provider: "slack",
        appId: "app-1",
        event: {
          resourceId: "C-ack-slack-idle",
          senderId: "U123",
          messageTs: "1000.0001",
          threadTs: "1000.0000",
        },
        pods: [makePod({ status: "idle" })],
        expectedMessage: "已接收到命令",
        expectedExtra: {
          senderId: "U123",
          messageTs: "1000.0001",
          threadTs: "1000.0000",
        },
      });
    });

    it("Slack 一般模式 Pod 忙碌 — 回覆「目前忙碌中，請稍後再試」並帶 senderId 和 thread", async () => {
      await assertAckReply({
        provider: "slack",
        appId: "app-1",
        event: {
          resourceId: "C-ack-slack-busy",
          senderId: "U456",
          messageTs: "2000.0001",
          threadTs: "2000.0000",
        },
        pods: [makePod({ status: "chatting" })],
        expectedMessage: "目前忙碌中，請稍後再試",
        expectedExtra: {
          senderId: "U456",
          messageTs: "2000.0001",
          threadTs: "2000.0000",
        },
      });
    });

    it("Slack Multi-Instance 模式 Pod — 回覆「已接收到命令」", async () => {
      await assertAckReply({
        provider: "slack",
        appId: "app-1",
        event: { resourceId: "C-ack-slack-multi" },
        pods: [makePod({ multiInstance: true })],
        expectedMessage: "已接收到命令",
      });
    });

    it("Slack 同時有一般（閒置）與 Multi-Instance Pod — 只回覆一次「已接收到命令」", async () => {
      const normalPod = makePod({ id: "pod-normal", status: "idle" });
      const multiPod = makePod({ id: "pod-multi", multiInstance: true });
      const event = makeEvent({ resourceId: "C-ack-slack-mixed-idle" });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod: normalPod },
        { canvasId, pod: multiPod },
      ]);
      asMock(podStore.getById).mockImplementation((_cId: string, id: string) =>
        id === "pod-normal"
          ? normalPod
          : id === "pod-multi"
            ? multiPod
            : undefined,
      );

      const mockSendMessage = vi.fn(() =>
        Promise.resolve({ success: true as const }),
      );
      asMock(integrationRegistry.get).mockReturnValue({
        sendMessage: mockSendMessage,
      });

      await integrationEventPipeline.processEvent("slack", "app-1", event);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        "app-1",
        "C-ack-slack-mixed-idle",
        "已接收到命令",
        expect.any(Object),
      );
    });

    it("Slack 同時有一般（忙碌）與 Multi-Instance Pod — 回覆「已接收到命令」（因 multiInstance 會處理）", async () => {
      const normalPod = makePod({ id: "pod-normal-busy", status: "chatting" });
      const multiPod = makePod({ id: "pod-multi-busy", multiInstance: true });
      const event = makeEvent({ resourceId: "C-ack-slack-mixed-busy" });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod: normalPod },
        { canvasId, pod: multiPod },
      ]);

      const mockSendMessage = vi.fn(() =>
        Promise.resolve({ success: true as const }),
      );
      asMock(integrationRegistry.get).mockReturnValue({
        sendMessage: mockSendMessage,
      });

      await integrationEventPipeline.processEvent("slack", "app-1", event);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        "app-1",
        "C-ack-slack-mixed-busy",
        "已接收到命令",
        expect.any(Object),
      );
    });

    it("Slack 沒有綁定 Pod — 不回覆", async () => {
      await assertAckReply({
        provider: "slack",
        appId: "app-1",
        event: makeEvent(),
        pods: [],
        expectedMessage: "",
        shouldCall: false,
      });
    });

    it("Telegram 一般模式 Pod 非忙碌 — 回覆「已接收到命令」（無 senderId mention），extra 包含 replyToMessageId", async () => {
      await assertAckReply({
        provider: "telegram",
        appId: "app-tg",
        event: {
          provider: "telegram",
          resourceId: "99999",
          messageId: 42,
          senderId: undefined,
        },
        pods: [makePod({ status: "idle" })],
        expectedMessage: "已接收到命令",
        expectedExtra: { replyToMessageId: 42 },
      });
    });

    it("Telegram 一般模式 Pod 忙碌 — 回覆「目前忙碌中，請稍後再試」", async () => {
      await assertAckReply({
        provider: "telegram",
        appId: "app-tg",
        event: {
          provider: "telegram",
          resourceId: "tg-busy-unique",
          messageId: 55,
        },
        pods: [makePod({ status: "chatting" })],
        expectedMessage: "目前忙碌中，請稍後再試",
        expectedExtra: { replyToMessageId: 55 },
      });
    });

    it("Telegram Multi-Instance 模式 Pod — 回覆「已接收到命令」", async () => {
      await assertAckReply({
        provider: "telegram",
        appId: "app-tg",
        event: {
          provider: "telegram",
          resourceId: "tg-multi-unique",
          messageId: 77,
        },
        pods: [makePod({ multiInstance: true })],
        expectedMessage: "已接收到命令",
      });
    });

    it("Telegram 沒有綁定 Pod — 不回覆", async () => {
      await assertAckReply({
        provider: "telegram",
        appId: "app-tg",
        event: { provider: "telegram" },
        pods: [],
        expectedMessage: "",
        shouldCall: false,
      });
    });

    it("忙碌回覆受冷卻時間控制（30 秒內不重複）", async () => {
      const pod = makePod({ status: "chatting" });
      const event = makeEvent({ resourceId: "C-cooldown-test" });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod },
      ]);

      const mockSendMessage = vi.fn(() =>
        Promise.resolve({ success: true as const }),
      );
      asMock(integrationRegistry.get).mockReturnValue({
        sendMessage: mockSendMessage,
      });

      const mockNow = vi.spyOn(Date, "now");
      mockNow.mockReturnValue(300_000_000);

      await integrationEventPipeline.processEvent("slack", "app-1", event);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      mockNow.mockReturnValue(300_015_000);
      await integrationEventPipeline.processEvent("slack", "app-1", event);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      // 超過 30 秒後可再次發送
      mockNow.mockReturnValue(300_035_000);
      await integrationEventPipeline.processEvent("slack", "app-1", event);
      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      mockNow.mockRestore();
    });

    it("確認回覆 sendMessage 失敗時不影響後續訊息處理", async () => {
      const pod = makePod({ status: "idle" });
      const event = makeEvent({ resourceId: "C-ack-fail" });
      asMock(podStore.findByIntegrationAppAndResource).mockReturnValue([
        { canvasId, pod },
      ]);
      asMock(podStore.getById).mockReturnValue(pod);

      const mockSendMessage = vi.fn(() =>
        Promise.reject(new Error("網路錯誤")),
      );
      asMock(integrationRegistry.get).mockReturnValue({
        sendMessage: mockSendMessage,
      });

      await expect(
        integrationEventPipeline.processEvent("slack", "app-1", event),
      ).resolves.not.toThrow();

      expect(executeStreamingChat).toHaveBeenCalled();
    });
  });

  describe("Jira eventFilter 過濾", () => {
    const appId = "app-jira-filter";

    it("一個 all、一個 status_changed 的 Pod，非 status 變更事件只有 all 的 Pod 被執行", async () => {
      const podAll = makePod({
        id: "pod-all",
        name: "Pod All",
        integrationBindings: [
          {
            provider: "jira",
            appId,
            resourceId: "*",
            extra: { eventFilter: "all" },
          },
        ],
      });
      const podStatus = makePod({
        id: "pod-status",
        name: "Pod Status",
        integrationBindings: [
          {
            provider: "jira",
            appId,
            resourceId: "*",
            extra: { eventFilter: "status_changed" },
          },
        ],
      });

      asMock(podStore.findByIntegrationApp).mockReturnValue([
        { canvasId, pod: podAll },
        { canvasId, pod: podStatus },
      ]);
      asMock(podStore.getById).mockImplementation(
        (_cId: string, pid: string) => {
          if (pid === "pod-all") return podAll;
          if (pid === "pod-status") return podStatus;
          return undefined;
        },
      );

      // 非 status 變更的 issue_updated 事件
      const event = {
        provider: "jira" as const,
        appId,
        resourceId: "*",
        userName: "tester",
        text: "[Jira: tester] <user_data>更新了 Issue PROJ-1</user_data>",
        rawEvent: {
          webhookEvent: "jira:issue_updated",
          changelog: {
            items: [{ field: "priority", fromString: "Low", toString: "High" }],
          },
        },
      };

      await integrationEventPipeline.processEvent("jira", appId, event);

      // 只有 pod-all 被執行
      expect(injectUserMessage).toHaveBeenCalledTimes(1);
      expect(injectUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ canvasId, podId: "pod-all" }),
      );
    });

    it("兩個 Pod 都設 status_changed，送入 status 變更事件，兩個 Pod 都被執行", async () => {
      const pod1 = makePod({
        id: "pod-s1",
        name: "Pod S1",
        integrationBindings: [
          {
            provider: "jira",
            appId,
            resourceId: "*",
            extra: { eventFilter: "status_changed" },
          },
        ],
      });
      const pod2 = makePod({
        id: "pod-s2",
        name: "Pod S2",
        integrationBindings: [
          {
            provider: "jira",
            appId,
            resourceId: "*",
            extra: { eventFilter: "status_changed" },
          },
        ],
      });

      asMock(podStore.findByIntegrationApp).mockReturnValue([
        { canvasId, pod: pod1 },
        { canvasId, pod: pod2 },
      ]);
      asMock(podStore.getById).mockImplementation(
        (_cId: string, pid: string) => {
          if (pid === "pod-s1") return pod1;
          if (pid === "pod-s2") return pod2;
          return undefined;
        },
      );

      // status 變更的 issue_updated 事件
      const event = {
        provider: "jira" as const,
        appId,
        resourceId: "*",
        userName: "tester",
        text: "[Jira: tester] <user_data>更新了 Issue PROJ-2</user_data>",
        rawEvent: {
          webhookEvent: "jira:issue_updated",
          changelog: {
            items: [{ field: "status", fromString: "Open", toString: "Done" }],
          },
        },
      };

      await integrationEventPipeline.processEvent("jira", appId, event);

      // 兩個 Pod 都被執行
      expect(injectUserMessage).toHaveBeenCalledTimes(2);
      expect(injectUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ canvasId, podId: "pod-s1" }),
      );
      expect(injectUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({ canvasId, podId: "pod-s2" }),
      );
    });

    it("所有 Pod 都被 eventFilter 過濾後，filteredPods 為空，不執行任何 Pod", async () => {
      // 唯一一個 Pod 設定 status_changed，但送入非 status 變更事件
      const podStatus = makePod({
        id: "pod-only-status",
        name: "Pod Only Status",
        integrationBindings: [
          {
            provider: "jira",
            appId,
            resourceId: "*",
            extra: { eventFilter: "status_changed" },
          },
        ],
      });

      asMock(podStore.findByIntegrationApp).mockReturnValue([
        { canvasId, pod: podStatus },
      ]);
      asMock(podStore.getById).mockReturnValue(podStatus);

      // 非 status 變更的事件，podStatus 應被過濾掉
      const event = {
        provider: "jira" as const,
        appId,
        resourceId: "*",
        userName: "tester",
        text: "[Jira: tester] <user_data>新增了 Issue PROJ-3</user_data>",
        rawEvent: {
          webhookEvent: "jira:issue_created",
          changelog: { items: [] },
        },
      };

      await integrationEventPipeline.processEvent("jira", appId, event);

      // filteredPods 為空，不應呼叫任何 Pod 執行
      expect(injectUserMessage).not.toHaveBeenCalled();
      expect(executeStreamingChat).not.toHaveBeenCalled();
    });
  });
});
