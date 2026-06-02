import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PodMemoryConfirmModal from "@/components/canvas/PodMemoryConfirmModal.vue";
import i18n from "@/i18n";

const dialogStub = { template: "<div><slot /></div>" };

function mountPodMemoryConfirmModal() {
  return mount(PodMemoryConfirmModal, {
    props: {
      open: true,
      podName: "Memory Pod",
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

describe("PodMemoryConfirmModal", () => {
  it("清除 Pod Memory 前會顯示警告並可送出 confirm", async () => {
    const wrapper = mountPodMemoryConfirmModal();

    expect(wrapper.text()).toContain(
      i18n.global.t("canvas.podMemoryConfirm.clearTitle"),
    );
    expect(wrapper.text()).toContain(
      i18n.global.t("canvas.podMemoryConfirm.description", {
        name: "Memory Pod",
      }),
    );

    await findButtonByText(
      wrapper,
      i18n.global.t("canvas.podMemoryConfirm.clearConfirmButton"),
    )?.trigger("click");

    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });
});
