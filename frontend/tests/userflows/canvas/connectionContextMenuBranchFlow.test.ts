import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionContextMenu from "@/components/canvas/ConnectionContextMenu.vue";
import TriggerModeRow from "@/components/canvas/connectionMenu/TriggerModeRow.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import type { Connection } from "@/types/connection";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("connection context menu branch userflow", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("trigger mode 選單只提供 auto、branch，並另外顯示 direct toggle", () => {
    const wrapper = mount(ConnectionContextMenu, {
      props: {
        position: { x: 120, y: 80 },
        connectionId: "conn-branch-menu",
        currentTriggerMode: "auto",
        directEnabled: false,
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const triggerModeRows = wrapper.findAllComponents(TriggerModeRow);

    expect(triggerModeRows.map((row) => row.props("mode"))).toEqual([
      "auto",
      "branch",
    ]);
    expect(
      wrapper.find('[data-testid="connection-direct-toggle-row"]').exists(),
    ).toBe(true);
    expect(wrapper.text().toLowerCase()).not.toContain("none");

    wrapper.unmount();
  });

  it("direct toggle 成功後不會主動關閉選單", async () => {
    const connectionStore = useConnectionStore();
    const updatedConnection: Connection = {
      id: "conn-direct-toggle",
      sourceAnchor: "right",
      targetPodId: "target-pod",
      targetAnchor: "left",
      triggerMode: "auto",
      direct: true,
    };
    vi.spyOn(connectionStore, "updateConnectionDirect").mockResolvedValue(
      updatedConnection,
    );

    const wrapper = mount(ConnectionContextMenu, {
      props: {
        position: { x: 120, y: 80 },
        connectionId: "conn-direct-toggle",
        currentTriggerMode: "auto",
        directEnabled: false,
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    await wrapper
      .find('[data-testid="connection-direct-toggle-row"]')
      .trigger("click");

    expect(connectionStore.updateConnectionDirect).toHaveBeenCalledWith(
      "conn-direct-toggle",
      true,
    );
    expect(wrapper.emitted("close")).toBeUndefined();

    wrapper.unmount();
  });

  it("直接觸發下方可切換為直角折線", async () => {
    const connectionStore = useConnectionStore();
    const updatedConnection: Connection = {
      id: "conn-routing",
      sourceAnchor: "right",
      targetPodId: "target-pod",
      targetAnchor: "left",
      triggerMode: "auto",
      direct: false,
      routingMode: "orthogonal",
      routingOffset: 0,
    };
    vi.spyOn(connectionStore, "updateConnectionRouting").mockResolvedValue(
      updatedConnection,
    );

    const wrapper = mount(ConnectionContextMenu, {
      props: {
        position: { x: 120, y: 80 },
        connectionId: "conn-routing",
        currentTriggerMode: "auto",
        directEnabled: false,
        routingMode: "bezier",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    const directRow = wrapper.find(
      '[data-testid="connection-direct-toggle-row"]',
    );
    const orthogonalRow = wrapper.find(
      '[data-testid="connection-routing-orthogonal"]',
    );
    expect(orthogonalRow.exists()).toBe(true);
    expect(
      directRow.element.compareDocumentPosition(orthogonalRow.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await orthogonalRow.trigger("click");
    expect(connectionStore.updateConnectionRouting).toHaveBeenCalledWith(
      "conn-routing",
      { routingMode: "orthogonal" },
    );

    wrapper.unmount();
  });

  it("branch 模式選單不再顯示 branch settings 額外入口", () => {
    const wrapper = mount(ConnectionContextMenu, {
      props: {
        position: { x: 120, y: 80 },
        connectionId: "conn-branch-menu",
        currentTriggerMode: "branch",
        directEnabled: true,
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    expect(wrapper.text()).not.toContain("branchSettings");

    wrapper.unmount();
  });
});
