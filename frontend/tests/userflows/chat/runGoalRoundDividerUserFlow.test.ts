import { describe, it, expect, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import RunChatModal from "@/components/run/RunChatModal.vue";
import { useRunStore } from "@/stores/run/runStore";
import type {
  RunChatTimelineItem,
  RunGoalRoundDivider,
  WorkflowRun,
} from "@/types/run";
import {
  createMockMessage,
  createMockRunPodInstance,
  createMockWorkflowRun,
} from "@tests/helpers/factories";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

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

function createRunGoalRoundDividerHarness(timelineItems: RunChatTimelineItem[]) {
  return defineComponent({
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

      runStore.runsById.set(run.id, run);
      runStore.activeRunChatModal = { runId: RUN_ID, podId: TARGET_POD_ID };
      runStore.setActiveRunChatTimelineItems(
        RUN_ID,
        TARGET_POD_ID,
        timelineItems,
      );

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
}

describe("run chat Goal round divider userflow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("同一 Pod 多輪 Goal 歷程會在每輪結束處顯示來源 Pod divider", async () => {
    const RunGoalRoundDividerHarness = createRunGoalRoundDividerHarness([
      createMockMessage({
        id: "round-1-message",
        role: "assistant",
        content: "第一輪回覆完成",
      }),
      createDivider({
        id: "round-1-divider",
        sourcePodIds: ["pod-source-1"],
        sourcePodNames: ["Pod 1"],
        status: "completed",
        completedAt: "2026-05-24T10:01:00.000Z",
      }),
      createMockMessage({
        id: "round-2-message",
        role: "assistant",
        content: "第二輪回覆卡住",
      }),
      createDivider({
        id: "round-2-divider",
        sourcePodIds: ["pod-source-2"],
        sourcePodNames: ["Pod 2"],
        status: "blocked",
        blockedReason: "等待人工補充必要資料",
        completedAt: "2026-05-24T10:02:00.000Z",
        connectionIds: ["connection-2"],
      }),
    ]);

    const mounted = await mountUserFlowApp({
      component: RunGoalRoundDividerHarness,
      attachTo: document.body,
    });

    const dividers = mounted.wrapper.findAll('[data-testid="goal-round-divider"]');
    expect(dividers).toHaveLength(2);
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

    mounted.unmount();
  });

  it("三條 Direct 不合併時會依序顯示三個 Goal round divider", async () => {
    const RunGoalRoundDividerHarness = createRunGoalRoundDividerHarness([
      createMockMessage({
        id: "direct-round-1-message",
        role: "assistant",
        content: "Direct 第一輪完成",
      }),
      createDivider({
        id: "direct-round-1-divider",
        sourcePodIds: ["pod-direct-1"],
        sourcePodNames: ["Direct Pod 1"],
        status: "completed",
        completedAt: "2026-05-24T11:01:00.000Z",
        connectionIds: ["direct-connection-1"],
      }),
      createMockMessage({
        id: "direct-round-2-message",
        role: "assistant",
        content: "Direct 第二輪完成",
      }),
      createDivider({
        id: "direct-round-2-divider",
        sourcePodIds: ["pod-direct-2"],
        sourcePodNames: ["Direct Pod 2"],
        status: "completed",
        completedAt: "2026-05-24T11:02:00.000Z",
        connectionIds: ["direct-connection-2"],
      }),
      createMockMessage({
        id: "direct-round-3-message",
        role: "assistant",
        content: "Direct 第三輪 blocked",
      }),
      createDivider({
        id: "direct-round-3-divider",
        sourcePodIds: ["pod-direct-3"],
        sourcePodNames: ["Direct Pod 3"],
        status: "blocked",
        blockedReason: "等待第三個來源補資料",
        completedAt: "2026-05-24T11:03:00.000Z",
        connectionIds: ["direct-connection-3"],
      }),
    ]);

    const mounted = await mountUserFlowApp({
      component: RunGoalRoundDividerHarness,
      attachTo: document.body,
    });

    const dividers = mounted.wrapper.findAll('[data-testid="goal-round-divider"]');
    expect(dividers).toHaveLength(3);
    expect(dividers.map((divider) => divider.text())).toEqual([
      expect.stringContaining("Direct Pod 1"),
      expect.stringContaining("Direct Pod 2"),
      expect.stringContaining("Direct Pod 3"),
    ]);

    const renderedText = mounted.wrapper.text();
    expect(renderedText.indexOf("Direct 第一輪完成")).toBeLessThan(
      renderedText.indexOf("Direct Pod 1"),
    );
    expect(renderedText.indexOf("Direct Pod 1")).toBeLessThan(
      renderedText.indexOf("Direct 第二輪完成"),
    );
    expect(renderedText.indexOf("Direct 第二輪完成")).toBeLessThan(
      renderedText.indexOf("Direct Pod 2"),
    );
    expect(renderedText.indexOf("Direct Pod 2")).toBeLessThan(
      renderedText.indexOf("Direct 第三輪 blocked"),
    );
    expect(renderedText.indexOf("Direct 第三輪 blocked")).toBeLessThan(
      renderedText.indexOf("Direct Pod 3"),
    );
    expect(dividers[2]?.text()).toContain("Goal 已 Blocked");
    expect(dividers[2]?.text()).toContain("等待第三個來源補資料");

    mounted.unmount();
  });

  it("Auto/Branch multi-input group 只會顯示一個包含多個來源 Pod 名稱的 divider", async () => {
    const RunGoalRoundDividerHarness = createRunGoalRoundDividerHarness([
      createMockMessage({
        id: "multi-input-round-message",
        role: "assistant",
        content: "合併輸入同一輪 Goal 完成",
      }),
      createDivider({
        id: "multi-input-round-divider",
        sourcePodIds: ["pod-auto-source", "pod-branch-source"],
        sourcePodNames: ["Auto Source Pod", "Branch Source Pod"],
        status: "completed",
        completedAt: "2026-05-24T12:01:00.000Z",
        connectionIds: ["auto-connection", "branch-connection"],
      }),
    ]);

    const mounted = await mountUserFlowApp({
      component: RunGoalRoundDividerHarness,
      attachTo: document.body,
    });

    const dividers = mounted.wrapper.findAll('[data-testid="goal-round-divider"]');
    expect(dividers).toHaveLength(1);
    expect(dividers[0]?.text()).toContain("Goal 已完成");
    expect(dividers[0]?.text()).toContain("Auto Source Pod、Branch Source Pod");

    const renderedText = mounted.wrapper.text();
    expect(renderedText.indexOf("合併輸入同一輪 Goal 完成")).toBeLessThan(
      renderedText.indexOf("Auto Source Pod"),
    );

    mounted.unmount();
  });
});
