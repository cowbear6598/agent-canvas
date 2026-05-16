import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import PodActions from "@/components/pod/PodActions.vue";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: { name: "Dialog", template: "<div><slot /></div>", props: ["open"] },
  DialogContent: { name: "DialogContent", template: "<div><slot /></div>" },
  DialogHeader: { name: "DialogHeader", template: "<div><slot /></div>" },
  DialogTitle: { name: "DialogTitle", template: "<div><slot /></div>" },
  DialogDescription: {
    name: "DialogDescription",
    template: "<div><slot /></div>",
  },
  DialogFooter: { name: "DialogFooter", template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    template: "<button><slot /></button>",
    props: ["variant", "disabled"],
  },
}));

const defaultProps = {
  podName: "測試 Pod",
  showScheduleButton: false,
  showDeleteDialog: false,
  hasSchedule: false,
  scheduleEnabled: false,
  scheduleTooltip: "",
};

function mountPodActions(propsOverrides: Partial<typeof defaultProps> = {}) {
  return mount(PodActions, {
    props: { ...defaultProps, ...propsOverrides },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: true })],
    },
    attachTo: document.body,
  });
}

describe("PodActions 刪除按鈕", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isUploading=true 時刪除按鈕應 disabled 並帶上 tooltip", () => {
    const wrapper = mountPodActions({ isUploading: true } as never);
    const deleteBtn = wrapper.find(".pod-delete-button");
    expect(deleteBtn.attributes("disabled")).toBeDefined();
    expect(deleteBtn.attributes("title")).toBeTruthy();
    wrapper.unmount();
  });

  it("isUploading=false 時刪除按鈕應正常可用", () => {
    const wrapper = mountPodActions();
    const deleteBtn = wrapper.find(".pod-delete-button");
    expect(deleteBtn.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("點擊刪除按鈕應 emit update:show-delete-dialog=true", async () => {
    const wrapper = mountPodActions();
    await wrapper.find(".pod-delete-button").trigger("click");
    expect(wrapper.emitted("update:show-delete-dialog")).toBeTruthy();
    expect(wrapper.emitted("update:show-delete-dialog")![0]).toEqual([true]);
    wrapper.unmount();
  });
});

describe("PodActions 排程按鈕", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("showScheduleButton=false 時不應出現 .schedule-button", () => {
    const wrapper = mountPodActions({ showScheduleButton: false });
    expect(wrapper.find(".schedule-button").exists()).toBe(false);
    wrapper.unmount();
  });

  it("showScheduleButton=true 時應出現 .schedule-button,點擊 emit open-schedule-modal", async () => {
    const wrapper = mountPodActions({ showScheduleButton: true });
    const btn = wrapper.find(".schedule-button");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(wrapper.emitted("open-schedule-modal")).toBeTruthy();
    wrapper.unmount();
  });
});
