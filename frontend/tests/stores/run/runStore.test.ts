import { describe, it, expect, vi } from "vitest";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useRunStore } from "@/stores/run/runStore";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowRun, RunPodInstance } from "@/types/run";

// Mock WebSocket
vi.mock("@/services/websocket", () => webSocketMockFactory());

// Mock useToast（connectionStore 依賴）
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// Mock useCanvasWebSocketAction（connectionStore 依賴）
const mockExecuteAction = vi.fn();
vi.mock("@/composables/useCanvasWebSocketAction", () => ({
  useCanvasWebSocketAction: () => ({
    executeAction: mockExecuteAction,
  }),
}));

function createMockPodInstance(
  overrides?: Partial<RunPodInstance>,
): RunPodInstance {
  return {
    id: "pi-1",
    runId: "run-1",
    podId: "pod-1",
    podName: "Pod 1",
    status: "pending",
    autoPathwaySettled: "not-applicable",
    directPathwaySettled: "not-applicable",
    ...overrides,
  };
}

function createMockRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-1",
    sourcePodName: "Pod 1",
    triggerMessage: "Hello",
    status: "running",
    podInstances: [createMockPodInstance()],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runStore", () => {
  setupStoreTest(() => {
    mockExecuteAction.mockResolvedValue({ success: false, error: "未知錯誤" });
  });

  describe("初始狀態", () => {
    it("各欄位應有正確預設值", () => {
      const store = useRunStore();

      expect(store.runs).toEqual([]);
      expect(store.isHistoryPanelOpen).toBe(false);
      expect(store.expandedRunIds.size).toBe(0);
      expect(store.activeRunChatModal).toBeNull();
      expect(store.runChatMessages.size).toBe(0);
      expect(store.isLoadingPodMessages).toBe(false);
    });
  });

  describe("getters", () => {
    describe("sortedRuns", () => {
      it("應依 createdAt 降冪排序", () => {
        const store = useRunStore();
        const run1 = createMockRun({
          id: "run-1",
          createdAt: "2024-01-01T10:00:00Z",
        });
        const run2 = createMockRun({
          id: "run-2",
          createdAt: "2024-01-03T10:00:00Z",
        });
        const run3 = createMockRun({
          id: "run-3",
          createdAt: "2024-01-02T10:00:00Z",
        });
        store.runs = [run1, run2, run3];

        const result = store.sortedRuns;

        expect(result[0]?.id).toBe("run-2");
        expect(result[1]?.id).toBe("run-3");
        expect(result[2]?.id).toBe("run-1");
      });

      it("應限制最多 MAX_RUNS_PER_CANVAS 筆", () => {
        const store = useRunStore();
        store.runs = Array.from({ length: 35 }, (_, i) =>
          createMockRun({
            id: `run-${i}`,
            createdAt: new Date(i * 1000).toISOString(),
          }),
        );

        expect(store.sortedRuns).toHaveLength(30);
      });
    });

    describe("runningRunsCount", () => {
      it("應計算 status=running 的 run 數量", () => {
        const store = useRunStore();
        store.runs = [
          createMockRun({ id: "run-1", status: "running" }),
          createMockRun({ id: "run-2", status: "completed" }),
          createMockRun({ id: "run-3", status: "running" }),
        ];

        expect(store.runningRunsCount).toBe(2);
      });

      it("無執行中 run 時應回傳 0", () => {
        const store = useRunStore();
        store.runs = [createMockRun({ status: "completed" })];

        expect(store.runningRunsCount).toBe(0);
      });
    });

    describe("getRunById", () => {
      it("存在時應回傳對應 run", () => {
        const store = useRunStore();
        const run = createMockRun({ id: "run-abc" });
        store.runs = [run];

        expect(store.getRunById("run-abc")).toEqual(run);
      });

      it("不存在時應回傳 undefined", () => {
        const store = useRunStore();

        expect(store.getRunById("non-existent")).toBeUndefined();
      });
    });

    describe("getActiveRunChatMessages", () => {
      it("無 activeRunChatModal 時應回傳空陣列", () => {
        const store = useRunStore();
        store.activeRunChatModal = null;

        expect(store.getActiveRunChatMessages).toEqual([]);
      });

      it("有 activeRunChatModal 且有訊息時應回傳對應訊息", () => {
        const store = useRunStore();
        store.activeRunChatModal = { runId: "run-1", podId: "pod-1" };
        const messages = [
          { id: "msg-1", role: "user" as const, content: "Hello" },
        ];
        store.runChatMessages.set("run-1:pod-1", messages);

        expect(store.getActiveRunChatMessages).toEqual(messages);
      });

      it("有 activeRunChatModal 但無對應訊息時應回傳空陣列", () => {
        const store = useRunStore();
        store.activeRunChatModal = { runId: "run-1", podId: "pod-1" };

        expect(store.getActiveRunChatMessages).toEqual([]);
      });
    });
  });

  describe("loadRuns", () => {
    it("成功時應更新 runs", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      const runs = [createMockRun({ id: "run-1" })];
      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true, runs });

      await store.loadRuns();

      expect(store.runs).toEqual(runs);
    });

    it("無 activeCanvasId 時應 early return", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      await store.loadRuns();

      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("回應 success=false 時不應更新 runs", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValueOnce({ success: false });

      await store.loadRuns();

      expect(store.runs).toEqual([]);
    });

    it("WebSocket 請求拋出錯誤時應靜默處理，不拋出例外", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error("請求超時"));

      await expect(store.loadRuns()).resolves.toBeUndefined();
      expect(store.runs).toEqual([]);
    });
  });

  describe("addRun", () => {
    it("應新增 run 到頂部", () => {
      const store = useRunStore();
      const run1 = createMockRun({ id: "run-1" });
      const run2 = createMockRun({ id: "run-2" });
      store.runs = [run1];

      store.addRun(run2);

      expect(store.runs[0]?.id).toBe("run-2");
      expect(store.runs[1]?.id).toBe("run-1");
    });

    it("重複 id 應忽略", () => {
      const store = useRunStore();
      const run = createMockRun({ id: "run-1" });
      store.runs = [run];

      store.addRun(createMockRun({ id: "run-1" }));

      expect(store.runs).toHaveLength(1);
    });

    it("超過 MAX_RUNS_PER_CANVAS 時應移除最舊的", () => {
      const store = useRunStore();
      store.runs = Array.from({ length: 30 }, (_, i) =>
        createMockRun({ id: `run-${i}` }),
      );

      store.addRun(createMockRun({ id: "run-new" }));

      expect(store.runs).toHaveLength(30);
      expect(store.runs[0]?.id).toBe("run-new");
    });
  });

  describe("updateRunStatus", () => {
    it("應更新 run 的 status", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1", status: "running" })];

      store.updateRunStatus("run-1", "completed");

      expect(store.runs[0]?.status).toBe("completed");
    });

    it("有 completedAt 時應一併更新", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1", status: "running" })];

      store.updateRunStatus("run-1", "completed", "2024-01-01T12:00:00Z");

      expect(store.runs[0]?.completedAt).toBe("2024-01-01T12:00:00Z");
    });

    it("run 不存在時不應有任何變化", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1", status: "running" })];

      store.updateRunStatus("non-existent", "completed");

      expect(store.runs[0]?.status).toBe("running");
    });
  });

  describe("updatePodInstanceStatus", () => {
    it("應更新 pod instance 的 status", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({
          id: "run-1",
          podInstances: [
            createMockPodInstance({ podId: "pod-1", status: "pending" }),
          ],
        }),
      ];

      store.updatePodInstanceStatus({
        runId: "run-1",
        podId: "pod-1",
        status: "running",
      });

      expect(store.runs[0]?.podInstances[0]?.status).toBe("running");
    });

    it("應更新 lastResponseSummary", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({
          id: "run-1",
          podInstances: [createMockPodInstance({ podId: "pod-1" })],
        }),
      ];

      store.updatePodInstanceStatus({
        runId: "run-1",
        podId: "pod-1",
        status: "completed",
        lastResponseSummary: "完成了",
      });

      expect(store.runs[0]?.podInstances[0]?.lastResponseSummary).toBe(
        "完成了",
      );
    });

    it("應更新 autoPathwaySettled", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({
          id: "run-1",
          podInstances: [
            createMockPodInstance({
              podId: "pod-1",
              autoPathwaySettled: "not-applicable",
            }),
          ],
        }),
      ];

      store.updatePodInstanceStatus({
        runId: "run-1",
        podId: "pod-1",
        status: "completed",
        autoPathwaySettled: "settled",
      });

      expect(store.runs[0]?.podInstances[0]?.autoPathwaySettled).toBe(
        "settled",
      );
    });

    it("應更新 directPathwaySettled", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({
          id: "run-1",
          podInstances: [
            createMockPodInstance({
              podId: "pod-1",
              directPathwaySettled: "not-applicable",
            }),
          ],
        }),
      ];

      store.updatePodInstanceStatus({
        runId: "run-1",
        podId: "pod-1",
        status: "completed",
        directPathwaySettled: "pending",
      });

      expect(store.runs[0]?.podInstances[0]?.directPathwaySettled).toBe(
        "pending",
      );
    });

    it("run 不存在時不應有任何變化", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1" })];

      store.updatePodInstanceStatus({
        runId: "non-existent",
        podId: "pod-1",
        status: "running",
      });

      expect(store.runs[0]?.podInstances[0]?.status).toBe("pending");
    });

    it("pod instance 不存在時不應有任何變化", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({
          id: "run-1",
          podInstances: [
            createMockPodInstance({ podId: "pod-1", status: "pending" }),
          ],
        }),
      ];

      store.updatePodInstanceStatus({
        runId: "run-1",
        podId: "non-existent-pod",
        status: "running",
      });

      expect(store.runs[0]?.podInstances[0]?.status).toBe("pending");
    });
  });

  describe("removeRun", () => {
    it("應從 runs 移除對應 run", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({ id: "run-1" }),
        createMockRun({ id: "run-2" }),
      ];

      store.removeRun("run-1");

      expect(store.runs).toHaveLength(1);
      expect(store.runs[0]?.id).toBe("run-2");
    });

    it("應從 expandedRunIds 移除", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1" })];
      store.expandedRunIds.add("run-1");

      store.removeRun("run-1");

      expect(store.expandedRunIds.has("run-1")).toBe(false);
    });

    it("activeRunChatModal 指向此 run 時應清除", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1" })];
      store.activeRunChatModal = { runId: "run-1", podId: "pod-1" };

      store.removeRun("run-1");

      expect(store.activeRunChatModal).toBeNull();
    });

    it("activeRunChatModal 指向其他 run 時不應清除", () => {
      const store = useRunStore();
      store.runs = [
        createMockRun({ id: "run-1" }),
        createMockRun({ id: "run-2" }),
      ];
      store.activeRunChatModal = { runId: "run-2", podId: "pod-1" };

      store.removeRun("run-1");

      expect(store.activeRunChatModal).toEqual({
        runId: "run-2",
        podId: "pod-1",
      });
    });

    it("應清理 runChatMessages 中相關 entries", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1" })];
      store.runChatMessages.set("run-1:pod-1", []);
      store.runChatMessages.set("run-1:pod-2", []);
      store.runChatMessages.set("run-2:pod-1", []);

      store.removeRun("run-1");

      expect(store.runChatMessages.has("run-1:pod-1")).toBe(false);
      expect(store.runChatMessages.has("run-1:pod-2")).toBe(false);
      expect(store.runChatMessages.has("run-2:pod-1")).toBe(true);
    });
  });

  describe("deleteRun", () => {
    it("應從前端 store 移除 run", () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";
      store.runs = [createMockRun({ id: "run-1" })];

      store.deleteRun("run-1");

      expect(store.runs).toHaveLength(0);
    });

    it("無 activeCanvasId 時應 early return", () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;
      store.runs = [createMockRun({ id: "run-1" })];

      store.deleteRun("run-1");

      // run 不應被移除
      expect(store.runs).toHaveLength(1);
    });
  });

  describe("toggleHistoryPanel", () => {
    it("應切換 isHistoryPanelOpen", () => {
      const store = useRunStore();
      expect(store.isHistoryPanelOpen).toBe(false);

      store.toggleHistoryPanel();
      expect(store.isHistoryPanelOpen).toBe(true);

      store.toggleHistoryPanel();
      expect(store.isHistoryPanelOpen).toBe(false);
    });
  });

  describe("openHistoryPanel", () => {
    it("應設定 isHistoryPanelOpen 為 true", () => {
      const store = useRunStore();
      store.isHistoryPanelOpen = false;

      store.openHistoryPanel();

      expect(store.isHistoryPanelOpen).toBe(true);
    });
  });

  describe("toggleRunExpanded", () => {
    it("未展開時應加入", () => {
      const store = useRunStore();

      store.toggleRunExpanded("run-1");

      expect(store.expandedRunIds.has("run-1")).toBe(true);
    });

    it("已展開時應移除", () => {
      const store = useRunStore();
      store.expandedRunIds.add("run-1");

      store.toggleRunExpanded("run-1");

      expect(store.expandedRunIds.has("run-1")).toBe(false);
    });
  });

  describe("openRunChatModal", () => {
    it("應設定 activeRunChatModal", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        messages: [],
      });

      await store.openRunChatModal("run-1", "pod-1");

      expect(store.activeRunChatModal).toEqual({
        runId: "run-1",
        podId: "pod-1",
      });
    });

    it("成功時應將訊息轉換存入 runChatMessages", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      const messages = [
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          timestamp: new Date().toISOString(),
        },
      ];
      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        messages,
      });

      await store.openRunChatModal("run-1", "pod-1");

      const stored = store.runChatMessages.get("run-1:pod-1");
      expect(stored).toHaveLength(1);
      expect(stored?.[0]?.content).toBe("Hello");
    });

    it("完成後 isLoadingPodMessages 應為 false", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        messages: [],
      });

      await store.openRunChatModal("run-1", "pod-1");

      expect(store.isLoadingPodMessages).toBe(false);
    });

    it("無 activeCanvasId 時應設定 modal 但 isLoading 歸 false", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = null;

      await store.openRunChatModal("run-1", "pod-1");

      expect(store.activeRunChatModal).toEqual({
        runId: "run-1",
        podId: "pod-1",
      });
      expect(store.isLoadingPodMessages).toBe(false);
      expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    });

    it("WebSocket 請求拋出錯誤時應確保 isLoadingPodMessages 被重設為 false", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockRejectedValueOnce(new Error("請求超時"));

      // try-finally 會重新拋出錯誤，但 finally 確保 isLoadingPodMessages 一定被重設
      await expect(store.openRunChatModal("run-1", "pod-1")).rejects.toThrow(
        "請求超時",
      );
      expect(store.isLoadingPodMessages).toBe(false);
    });
  });

  describe("closeRunChatModal", () => {
    it("應清除 activeRunChatModal", () => {
      const store = useRunStore();
      store.activeRunChatModal = { runId: "run-1", podId: "pod-1" };

      store.closeRunChatModal();

      expect(store.activeRunChatModal).toBeNull();
    });
  });

  describe("appendRunChatMessage", () => {
    it("不存在訊息時應新增", () => {
      const store = useRunStore();

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello",
        false,
        "user",
      );

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages).toHaveLength(1);
      expect(messages?.[0]?.content).toBe("Hello");
    });

    it("isPartial=true 時 isPartial 應為 true", () => {
      const store = useRunStore();

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello",
        true,
        "assistant",
      );

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages?.[0]?.isPartial).toBe(true);
    });

    it("已存在同 messageId 時應更新 content", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        { id: "msg-1", role: "assistant", content: "Hel", isPartial: true },
      ]);

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello world",
        true,
        "assistant",
      );

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages).toHaveLength(1);
      expect(messages?.[0]?.content).toBe("Hello world");
    });

    it("每次呼叫都應產生新的陣列引用以觸發 Vue 響應性", () => {
      const store = useRunStore();

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello",
        false,
        "user",
      );
      const ref1 = store.runChatMessages.get("run-1:pod-1");

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-2",
        "World",
        false,
        "assistant",
      );
      const ref2 = store.runChatMessages.get("run-1:pod-1");

      expect(ref1).not.toBe(ref2);
    });

    it("更新同一訊息時也應產生新的陣列引用", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        { id: "msg-1", role: "assistant", content: "partial", isPartial: true },
      ]);

      const refBefore = store.runChatMessages.get("run-1:pod-1");

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "full content",
        false,
        "assistant",
      );

      const refAfter = store.runChatMessages.get("run-1:pod-1");
      expect(refBefore).not.toBe(refAfter);
    });

    it("串流過程中 delta 應只傳入新增片段", () => {
      const store = useRunStore();

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello",
        true,
        "assistant",
      );

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello world",
        true,
        "assistant",
      );

      const messages = store.runChatMessages.get("run-1:pod-1");
      // subMessages 最後一個 sub 的 content 應逐步累積
      const lastSub = messages?.[0]?.subMessages?.[0];
      expect(lastSub?.content).toBe("Hello world");
    });

    it("content 長度倒退時應以整段 content 作為 delta", () => {
      const store = useRunStore();

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello world",
        true,
        "assistant",
      );

      // 模擬後端重傳導致 content 較短
      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hi",
        true,
        "assistant",
      );

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages?.[0]?.content).toBe("Hi");
    });

    it("system 訊息應保留 metadata 且不建立 assistant 專用 subMessages", () => {
      const store = useRunStore();

      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-system",
        "Service temporarily unavailable",
        false,
        "system",
        {
          provider: "gemini",
          code: "SERVICE_UNAVAILABLE",
          severity: "error",
        },
      );

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages?.[0]).toMatchObject({
        id: "msg-system",
        role: "system",
        content: "Service temporarily unavailable",
        metadata: {
          provider: "gemini",
          code: "SERVICE_UNAVAILABLE",
          severity: "error",
        },
      });
      expect(messages?.[0]?.subMessages).toBeUndefined();
    });
  });

  describe("handleRunChatToolUse", () => {
    it("應追加 tool use 到對應訊息的 subMessage", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          subMessages: [{ id: "msg-1-sub-0", content: "", isPartial: true }],
        },
      ]);

      store.handleRunChatToolUse({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      const messages = store.runChatMessages.get("run-1:pod-1");
      // 空 content 的 sub 應被合併，tool 附加到同一個 sub
      expect(messages?.[0]?.subMessages).toHaveLength(1);
      expect(messages?.[0]?.subMessages?.[0]?.toolUse?.[0]?.toolName).toBe(
        "Bash",
      );
      // message 層級也應有 toolUse
      expect(messages?.[0]?.toolUse?.[0]?.toolName).toBe("Bash");
    });

    it("訊息尚不存在時應建立新的 assistant 訊息", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", []);

      store.handleRunChatToolUse({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-new",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages).toHaveLength(1);
      expect(messages?.[0]?.id).toBe("msg-new");
      expect(messages?.[0]?.role).toBe("assistant");
      expect(messages?.[0]?.toolUse?.[0]?.toolName).toBe("Bash");
      expect(messages?.[0]?.subMessages?.[0]?.toolUse?.[0]?.toolName).toBe(
        "Bash",
      );
    });

    it("應以新物件取代陣列中的 message 以觸發 Vue 響應性", () => {
      const store = useRunStore();
      const originalMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "",
        subMessages: [{ id: "msg-1-sub-0", content: "", isPartial: true }],
      };
      store.runChatMessages.set("run-1:pod-1", [originalMessage]);

      store.handleRunChatToolUse({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      const messages = store.runChatMessages.get("run-1:pod-1");
      // 陣列中的 message 應為新物件，而非原本的引用
      expect(messages?.[0]).not.toBe(originalMessage);
    });

    it("message 有 content 時首次 tool use 應保留文字到 subMessage", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "我來幫你處理",
          isPartial: true,
          subMessages: [
            { id: "msg-1-sub-0", content: "我來幫你處理", isPartial: true },
          ],
        },
      ]);

      store.handleRunChatToolUse({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: { command: "ls" },
      });

      const messages = store.runChatMessages.get("run-1:pod-1");
      const subMessages = messages?.[0]?.subMessages;
      expect(subMessages).toHaveLength(2);
      // 第一個 subMessage 保留文字
      expect(subMessages?.[0]?.content).toBe("我來幫你處理");
      expect(subMessages?.[0]?.toolUse).toBeUndefined();
      // 第二個 subMessage 是工具
      expect(subMessages?.[1]?.toolUse?.[0]?.toolName).toBe("Bash");
    });

    it("message content 為空時首次 tool use 不應產生額外的文字 subMessage", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          subMessages: [{ id: "msg-1-sub-0", content: "", isPartial: true }],
        },
      ]);

      store.handleRunChatToolUse({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      const messages = store.runChatMessages.get("run-1:pod-1");
      // 空 content 的 sub 與 tool 合併到同一個 sub
      expect(messages?.[0]?.subMessages).toHaveLength(1);
      expect(messages?.[0]?.subMessages?.[0]?.toolUse?.[0]?.toolName).toBe(
        "Bash",
      );
    });

    it("重複的 toolUseId 應被忽略", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          toolUse: [
            {
              toolUseId: "tool-1",
              toolName: "Bash",
              input: {},
              status: "running",
            },
          ],
          subMessages: [
            {
              id: "msg-1-sub-0",
              content: "",
              isPartial: true,
              toolUse: [
                {
                  toolUseId: "tool-1",
                  toolName: "Bash",
                  input: {},
                  status: "running",
                },
              ],
            },
          ],
        },
      ]);

      store.handleRunChatToolUse({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        input: {},
      });

      // toolUse 數量不應增加
      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages?.[0]?.toolUse).toHaveLength(1);
    });
  });

  describe("handleRunChatToolResult", () => {
    it("應更新對應 subMessage 的 output", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          toolUse: [
            {
              toolUseId: "tool-1",
              toolName: "Bash",
              input: {},
              status: "running",
            },
          ],
          subMessages: [
            {
              id: "tool-1",
              content: "",
              toolUse: [
                {
                  toolUseId: "tool-1",
                  toolName: "Bash",
                  input: {},
                  status: "running",
                },
              ],
            },
          ],
        },
      ]);

      store.handleRunChatToolResult({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "file1.txt",
      });

      const toolUse =
        store.runChatMessages.get("run-1:pod-1")?.[0]?.subMessages?.[0]
          ?.toolUse?.[0];
      expect(toolUse?.output).toBe("file1.txt");
      expect(toolUse?.status).toBe("completed");
    });

    it("應以新物件取代陣列中的 message 以觸發 Vue 響應性", () => {
      const store = useRunStore();
      const originalMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "",
        toolUse: [
          {
            toolUseId: "tool-1",
            toolName: "Bash",
            input: {},
            status: "running" as const,
          },
        ],
        subMessages: [
          {
            id: "tool-1",
            content: "",
            toolUse: [
              {
                toolUseId: "tool-1",
                toolName: "Bash",
                input: {},
                status: "running" as const,
              },
            ],
          },
        ],
      };
      store.runChatMessages.set("run-1:pod-1", [originalMessage]);

      store.handleRunChatToolResult({
        runId: "run-1",
        podId: "pod-1",
        messageId: "msg-1",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "result",
      });

      const messages = store.runChatMessages.get("run-1:pod-1");
      // 陣列中的 message 應為新物件，而非原本的引用
      expect(messages?.[0]).not.toBe(originalMessage);
    });

    it("runChatMessages 無對應 key 時不應拋出錯誤", () => {
      const store = useRunStore();

      expect(() => {
        store.handleRunChatToolResult({
          runId: "run-1",
          podId: "pod-1",
          messageId: "msg-1",
          toolUseId: "tool-1",
          toolName: "Bash",
          output: "result",
        });
      }).not.toThrow();
    });

    it("messageId 不存在時不應有任何變化", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          toolUse: [
            {
              toolUseId: "tool-1",
              toolName: "Bash",
              input: {},
              status: "running",
            },
          ],
          subMessages: [
            {
              id: "tool-1",
              content: "",
              toolUse: [
                {
                  toolUseId: "tool-1",
                  toolName: "Bash",
                  input: {},
                  status: "running",
                },
              ],
            },
          ],
        },
      ]);

      store.handleRunChatToolResult({
        runId: "run-1",
        podId: "pod-1",
        messageId: "non-existent",
        toolUseId: "tool-1",
        toolName: "Bash",
        output: "result",
      });

      const toolUse =
        store.runChatMessages.get("run-1:pod-1")?.[0]?.subMessages?.[0]
          ?.toolUse?.[0];
      expect(toolUse?.status).toBe("running");
    });
  });

  describe("handleRunChatComplete", () => {
    it("應更新 isPartial=false 並更新 content", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        { id: "msg-1", role: "assistant", content: "part", isPartial: true },
      ]);

      store.handleRunChatComplete("run-1", "pod-1", "msg-1", "full content");

      const message = store.runChatMessages.get("run-1:pod-1")?.[0];
      expect(message?.isPartial).toBe(false);
      expect(message?.content).toBe("full content");
    });

    it("訊息不存在時不應有任何變化", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", []);

      store.handleRunChatComplete("run-1", "pod-1", "non-existent", "content");

      const messages = store.runChatMessages.get("run-1:pod-1");
      expect(messages).toHaveLength(0);
    });

    it("complete 時應對 subMessages 做 finalizeSubMessages 合併", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "",
          isPartial: true,
          subMessages: [
            {
              id: "sub-1",
              content: "",
              toolUse: [
                {
                  toolUseId: "tool-1",
                  toolName: "Bash",
                  input: {},
                  status: "running",
                },
              ],
            },
            {
              id: "sub-2",
              content: "",
              toolUse: [
                {
                  toolUseId: "tool-2",
                  toolName: "Read",
                  input: {},
                  status: "running",
                },
              ],
            },
          ],
        },
      ]);

      store.handleRunChatComplete("run-1", "pod-1", "msg-1", "完成");

      const message = store.runChatMessages.get("run-1:pod-1")?.[0];
      expect(message?.subMessages).toHaveLength(1);
      expect(message?.subMessages?.[0]?.toolUse).toHaveLength(2);
      expect(
        message?.subMessages?.[0]?.toolUse?.every(
          (t) => t.status === "completed",
        ),
      ).toBe(true);
    });

    it("complete 時應正確設定 fullContent 和 isPartial", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "streaming...",
          isPartial: true,
        },
      ]);

      store.handleRunChatComplete("run-1", "pod-1", "msg-1", "最終完整內容");

      const message = store.runChatMessages.get("run-1:pod-1")?.[0];
      expect(message?.content).toBe("最終完整內容");
      expect(message?.isPartial).toBe(false);
    });

    it("subMessages 為 undefined 時不應產生副作用", () => {
      const store = useRunStore();
      store.runChatMessages.set("run-1:pod-1", [
        {
          id: "msg-1",
          role: "assistant",
          content: "純文字回覆",
          isPartial: true,
        },
      ]);

      store.handleRunChatComplete("run-1", "pod-1", "msg-1", "最終純文字內容");

      const message = store.runChatMessages.get("run-1:pod-1")?.[0];
      expect(message?.subMessages).toBeUndefined();
      expect(message?.content).toBe("最終純文字內容");
      expect(message?.isPartial).toBe(false);
    });

    it("應以新物件取代陣列中的 message 以觸發 Vue 響應性", () => {
      const store = useRunStore();
      const originalMessage = {
        id: "msg-1",
        role: "assistant" as const,
        content: "streaming...",
        isPartial: true,
      };
      store.runChatMessages.set("run-1:pod-1", [originalMessage]);

      store.handleRunChatComplete("run-1", "pod-1", "msg-1", "最終內容");

      const messages = store.runChatMessages.get("run-1:pod-1");
      // 陣列中的 message 應為新物件，而非原本的引用
      expect(messages?.[0]).not.toBe(originalMessage);
    });

    it("complete 後應清除對應 messageId 的 accumulatedLength", () => {
      const store = useRunStore();

      // 先透過 appendRunChatMessage 累積長度
      store.appendRunChatMessage(
        "run-1",
        "pod-1",
        "msg-1",
        "Hello",
        true,
        "assistant",
      );
      expect(store.accumulatedLengthByMessageId.has("msg-1")).toBe(true);

      store.handleRunChatComplete("run-1", "pod-1", "msg-1", "Hello");

      expect(store.accumulatedLengthByMessageId.has("msg-1")).toBe(false);
    });
  });

  describe("openRunChatModal — toMessage 轉換", () => {
    it("assistant 訊息無 subMessages 時應自動補一個帶 content 的預設 sub", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "純文字回覆",
            timestamp: new Date().toISOString(),
          },
        ],
      });

      await store.openRunChatModal("run-1", "pod-1");

      const stored = store.runChatMessages.get("run-1:pod-1");
      expect(stored?.[0]?.subMessages).toHaveLength(1);
      expect(stored?.[0]?.subMessages?.[0]?.content).toBe("純文字回覆");
      expect(stored?.[0]?.subMessages?.[0]?.isPartial).toBe(false);
    });

    it("assistant 訊息有 subMessages 時應展平 toolUse 到 message 層級", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            subMessages: [
              {
                id: "sub-1",
                content: "",
                toolUse: [
                  {
                    toolUseId: "tool-1",
                    toolName: "Bash",
                    input: {},
                    output: "ok",
                    status: "completed",
                  },
                ],
              },
            ],
          },
        ],
      });

      await store.openRunChatModal("run-1", "pod-1");

      const stored = store.runChatMessages.get("run-1:pod-1");
      expect(stored?.[0]?.toolUse).toHaveLength(1);
      expect(stored?.[0]?.toolUse?.[0]?.toolName).toBe("Bash");
    });

    it("toolUse status 無效時應 fallback 為 completed", async () => {
      const store = useRunStore();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      mockCreateWebSocketRequest.mockResolvedValueOnce({
        success: true,
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            subMessages: [
              {
                id: "sub-1",
                content: "",
                toolUse: [
                  {
                    toolUseId: "tool-1",
                    toolName: "Bash",
                    input: {},
                    status: "invalid-status",
                  },
                ],
              },
            ],
          },
        ],
      });

      await store.openRunChatModal("run-1", "pod-1");

      const stored = store.runChatMessages.get("run-1:pod-1");
      expect(stored?.[0]?.subMessages?.[0]?.toolUse?.[0]?.status).toBe(
        "completed",
      );
    });
  });

  describe("resetOnCanvasSwitch", () => {
    it("應清空所有狀態（含 accumulatedLengthByMessageId）", () => {
      const store = useRunStore();
      store.runs = [createMockRun({ id: "run-1" })];
      store.expandedRunIds.add("run-1");
      store.activeRunChatModal = { runId: "run-1", podId: "pod-1" };
      store.runChatMessages.set("run-1:pod-1", []);
      store.isHistoryPanelOpen = true;
      store.accumulatedLengthByMessageId.set("msg-1", 10);

      store.resetOnCanvasSwitch();

      expect(store.runs).toEqual([]);
      expect(store.expandedRunIds.size).toBe(0);
      expect(store.activeRunChatModal).toBeNull();
      expect(store.runChatMessages.size).toBe(0);
      expect(store.isHistoryPanelOpen).toBe(false);
      expect(store.accumulatedLengthByMessageId.size).toBe(0);
    });
  });
});
