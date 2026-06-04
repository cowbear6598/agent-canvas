import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RunCard from "@/components/run/RunCard.vue";
import RunStatusIcon from "@/components/run/RunStatusIcon.vue";
import type { WorkflowRun } from "@/types/run";

function createRun(
  overrides: Partial<WorkflowRun> = {},
): WorkflowRun {
  return {
    id: "run-1",
    canvasId: "canvas-1",
    sourcePodId: "pod-1",
    sourcePodName: "Pod 1",
    triggerMessage: "hi",
    status: "error",
    createdAt: "2026-06-04T00:00:00.000Z",
    podInstances: [
      {
        id: "instance-1",
        runId: "run-1",
        podId: "pod-1",
        podName: "Pod 1",
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      },
      {
        id: "instance-2",
        runId: "run-1",
        podId: "pod-2",
        podName: "Pod 2",
        status: "blocked",
        autoPathwaySettled: "settled",
        directPathwaySettled: "settled",
      },
    ],
    ...overrides,
  };
}

describe("RunCard", () => {
  it("整體 run 為 error 但含 blocked pod 時，頂部 icon 應顯示 blocked", () => {
    const wrapper = mount(RunCard, {
      props: {
        run: createRun(),
        isExpanded: false,
      },
      global: {
        stubs: {
          RunPodInstanceItem: true,
        },
      },
    });

    expect(wrapper.findComponent(RunStatusIcon).props("status")).toBe("blocked");
  });

  it("仍有進行中 pod 時，頂部 icon 應優先顯示 running", () => {
    const wrapper = mount(RunCard, {
      props: {
        run: createRun({
          podInstances: [
            {
              id: "instance-1",
              runId: "run-1",
              podId: "pod-1",
              podName: "Pod 1",
              status: "blocked",
              autoPathwaySettled: "settled",
              directPathwaySettled: "settled",
            },
            {
              id: "instance-2",
              runId: "run-1",
              podId: "pod-2",
              podName: "Pod 2",
              status: "running",
              autoPathwaySettled: "pending",
              directPathwaySettled: "not-applicable",
            },
          ],
        }),
        isExpanded: false,
      },
      global: {
        stubs: {
          RunPodInstanceItem: true,
        },
      },
    });

    expect(wrapper.findComponent(RunStatusIcon).props("status")).toBe("running");
  });
});
