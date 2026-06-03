import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionContextMenu from "@/components/canvas/ConnectionContextMenu.vue";
import TriggerModeRow from "@/components/canvas/connectionMenu/TriggerModeRow.vue";

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

  it("trigger mode 選單只提供 auto、direct、branch，沒有 none 選項", () => {
    const wrapper = mount(ConnectionContextMenu, {
      props: {
        position: { x: 120, y: 80 },
        connectionId: "conn-branch-menu",
        currentTriggerMode: "auto",
        currentSummaryModel: "sonnet",
      },
      global: {
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          SummarySection: true,
          BranchSettingsPanel: true,
        },
      },
    });

    const triggerModeRows = wrapper.findAllComponents(TriggerModeRow);

    expect(triggerModeRows.map((row) => row.props("mode"))).toEqual([
      "auto",
      "direct",
      "branch",
    ]);
    expect(wrapper.text().toLowerCase()).not.toContain("none");

    wrapper.unmount();
  });
});
