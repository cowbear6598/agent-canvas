import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PodActions from "@/components/pod/PodActions.vue";
import i18n from "@/i18n";

const dialogStub = { template: "<div><slot /></div>" };

function mountPodActions(hasPodMemory: boolean) {
  return mount(PodActions, {
    props: {
      podName: "Memory Pod",
      showScheduleButton: false,
      showDeleteDialog: true,
      hasPodMemory,
      hasSchedule: false,
      scheduleEnabled: false,
      scheduleTooltip: "",
    },
    global: {
      plugins: [i18n],
      stubs: {
        Dialog: dialogStub,
        DialogContent: dialogStub,
        DialogDescription: dialogStub,
        DialogHeader: dialogStub,
        DialogTitle: dialogStub,
        DialogFooter: dialogStub,
      },
    },
  });
}

function findButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

describe("PodActions", () => {
  it("沒有 Pod Memory 時，第一次確認就直接送出刪除事件", async () => {
    const wrapper = mountPodActions(false);

    await findButtonByText(
      wrapper,
      i18n.global.t("pod.delete.confirm"),
    )?.trigger("click");

    expect(wrapper.emitted("confirm-delete")).toHaveLength(1);
    expect(wrapper.text()).not.toContain(
      i18n.global.t("pod.delete.memoryTitle"),
    );
  });

  it("有 Pod Memory 時，刪除前需要第二次確認", async () => {
    const wrapper = mountPodActions(true);

    await findButtonByText(
      wrapper,
      i18n.global.t("pod.delete.confirm"),
    )?.trigger("click");

    expect(wrapper.emitted("confirm-delete")).toBeUndefined();
    expect(wrapper.text()).toContain(i18n.global.t("pod.delete.memoryTitle"));
    expect(wrapper.text()).toContain(
      i18n.global.t("pod.delete.memoryConfirm"),
    );

    await findButtonByText(
      wrapper,
      i18n.global.t("pod.delete.memoryConfirm"),
    )?.trigger("click");

    expect(wrapper.emitted("confirm-delete")).toHaveLength(1);
  });
});
