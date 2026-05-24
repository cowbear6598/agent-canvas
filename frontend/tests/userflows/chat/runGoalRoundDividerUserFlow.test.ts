import { describe, it, expect, afterEach, vi } from "vitest";
import { defineComponent, h, onMounted } from "vue";
import RunChatModal from "@/components/run/RunChatModal.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRunStore } from "@/stores/run/runStore";
import { handleRunGoalRoundDivider } from "@/composables/eventHandlers/runEventHandlers";
import {
  mockCreateWebSocketRequest,
} from "@tests/helpers/mockWebSocket";
import {
  createMockRunPodInstance,
  createMockWorkflowRun,
} from "@tests/helpers/factories";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import type { RunGoalRoundDivider, WorkflowRun } from "@/types/run";

vi.mock("@/services/websocket", async () => {
  const { webSocketMockFactory } = await import("@tests/helpers/mockWebSocket");
  return webSocketMockFactory();
});
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const CANVAS_ID = "canvas-goal-round-history";
const RUN_ID = "run-goal-round-history";
const TARGET_POD_ID = "pod-target";
const TARGET_POD_NAME = "Target Pod";

function createDivider(
  overrides: Partial<RunGoalRoundDivider>,
): RunGoalRoundDivider {
  return {
    type: "goal-round-divider",
    id: "divider-1",
    runId: RUN_ID,
    podId: TARGET_POD_ID,
    sourcePodIds: ["pod-source-1"],
    sourcePodNames: ["Pod 1"],
    status: "completed",
    blockedReason: null,
    completedAt: "2026-05-24T10:00:00.000Z",
    connectionIds: ["connection-1"],
    ...overrides,
  };
}

const RunGoalRoundDividerHarness = defineComponent({
  name: "RunGoalRoundDividerHarness",
  setup() {
    const runStore = useRunStore();
    const run: WorkflowRun = createMockWorkflowRun({
      id: RUN_ID,
      status: "completed",
      podInstances: [
        createMockRunPodInstance({
          runId: RUN_ID,
          podId: TARGET_POD_ID,
          podName: TARGET_POD_NAME,
          status: "completed",
        }),
      ],
    });

    useCanvasStore().activeCanvasId = CANVAS_ID;
    runStore.runsById.set(run.id, run);
    onMounted(() => {
      void runStore.openRunChatModal(RUN_ID, TARGET_POD_ID);
    });

    return () =>
      h(RunChatModal, {
        runId: RUN_ID,
        podId: TARGET_POD_ID,
        podName: TARGET_POD_NAME,
        runStatus: "completed",
        onClose: () => {},
      });
  },
});

describe("run chat Goal round divider userflow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("歷史載入後會依 timeline 顯示多輪 Goal divider", async () => {
    mockCreateWebSocketRequest.mockResolvedValueOnce({
      success: true,
      timelineItems: [
        {
          id: "round-1-message",
          role: "assistant",
          content: "第一輪回覆完成",
          timestamp: "2026-05-24T10:00:00.000Z",
        },
        createDivider({
          id: "round-1-divider",
          sourcePodNames: ["Pod 1"],
          status: "completed",
          completedAt: "2026-05-24T10:01:00.000Z",
        }),
        {
          id: "round-2-message",
          role: "assistant",
          content: "第二輪回覆卡住",
          timestamp: "2026-05-24T10:02:00.000Z",
        },
        createDivider({
          id: "round-2-divider",
          sourcePodIds: ["pod-source-2"],
          sourcePodNames: ["Pod 2"],
          status: "blocked",
          blockedReason: "等待人工補充必要資料",
          completedAt: "2026-05-24T10:03:00.000Z",
          connectionIds: ["connection-2"],
        }),
      ],
      pageInfo: {
        hasMore: false,
        nextCursor: null,
      },
    });

    const mounted = await mountUserFlowApp({
      component: RunGoalRoundDividerHarness,
      attachTo: document.body,
    });
    await vi.waitFor(() =>
      expect(
        mounted.wrapper.findAll('[data-testid="goal-round-divider"]'),
      ).toHaveLength(2),
    );

    const dividers = mounted.wrapper.findAll('[data-testid="goal-round-divider"]');
    expect(dividers[0]?.text()).toContain("Goal 已完成");
    expect(dividers[0]?.text()).toContain("Pod 1");
    expect(dividers[1]?.text()).toContain("Goal 已 Blocked");
    expect(dividers[1]?.text()).toContain("Pod 2");
    expect(dividers[1]?.text()).toContain("等待人工補充必要資料");

    const renderedText = mounted.wrapper.text();
    expect(renderedText.indexOf("第一輪回覆完成")).toBeLessThan(
      renderedText.indexOf("Pod 1"),
    );
    expect(renderedText.indexOf("第二輪回覆卡住")).toBeLessThan(
      renderedText.indexOf("Pod 2"),
    );
  });

  it("即時 RUN_GOAL_ROUND_DIVIDER event 會追加到目前 run chat", async () => {
    mockCreateWebSocketRequest.mockResolvedValueOnce({
      success: true,
      timelineItems: [
        {
          id: "message-1",
          role: "assistant",
          content: "來源回覆完成",
          timestamp: "2026-05-24T10:00:00.000Z",
        },
      ],
      pageInfo: {
        hasMore: false,
        nextCursor: null,
      },
    });

    const mounted = await mountUserFlowApp({
      component: RunGoalRoundDividerHarness,
      attachTo: document.body,
    });
    await vi.waitFor(() =>
      expect(mounted.wrapper.text()).toContain("來源回覆完成"),
    );

    handleRunGoalRoundDivider({
      ...createDivider({
        id: "live-divider",
        sourcePodNames: ["Live Source"],
      }),
      canvasId: CANVAS_ID,
    });
    await vi.waitFor(() =>
      expect(mounted.wrapper.text()).toContain("Live Source"),
    );

    const renderedText = mounted.wrapper.text();
    expect(renderedText.indexOf("來源回覆完成")).toBeLessThan(
      renderedText.indexOf("Live Source"),
    );
  });
});
