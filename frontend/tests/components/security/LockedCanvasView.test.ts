import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import LockedCanvasView from "@/components/security/LockedCanvasView.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSecurityStore } from "@/stores/securityStore";

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["type", "variant"],
    emits: ["click"],
    template:
      '<button :type="type ?? \'button\'" @click="$emit(\'click\')"><slot /></button>',
  },
}));

describe("LockedCanvasView", () => {
  setupStoreTest();

  it("只顯示仍需解鎖的受保護 Canvas", () => {
    const canvasStore = useCanvasStore();
    const securityStore = useSecurityStore();

    canvasStore.canvases = [
      { id: "locked-1", name: "Finance", sortIndex: 0, isProtected: true },
      { id: "unlocked-1", name: "Ops", sortIndex: 1, isProtected: true },
      { id: "open-1", name: "General", sortIndex: 2, isProtected: false },
    ];
    securityStore.unlockedCanvasIds = ["unlocked-1"];

    const wrapper = mount(LockedCanvasView);

    expect(wrapper.text()).toContain("目前看得到的 Canvas 全都需要密碼。");
    expect(wrapper.text()).toContain("Finance");
    expect(wrapper.text()).not.toContain("Ops");
    expect(wrapper.text()).not.toContain("General");

    wrapper.unmount();
  });

  it("可直接從鎖頁要求解鎖指定 Canvas，並可打開 sidebar", async () => {
    const canvasStore = useCanvasStore();
    const securityStore = useSecurityStore();

    canvasStore.canvases = [
      { id: "locked-1", name: "Finance", sortIndex: 0, isProtected: true },
    ];

    const requestCanvasAccessSpy = vi
      .spyOn(securityStore, "requestCanvasAccess")
      .mockResolvedValue();
    const setSidebarOpenSpy = vi.spyOn(canvasStore, "setSidebarOpen");

    const wrapper = mount(LockedCanvasView);

    const sidebarButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("打開 Canvas 清單"));
    const unlockButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Finance"));

    expect(sidebarButton).toBeDefined();
    expect(unlockButton).toBeDefined();

    await sidebarButton!.trigger("click");
    await unlockButton!.trigger("click");

    expect(setSidebarOpenSpy).toHaveBeenCalledWith(true);
    expect(requestCanvasAccessSpy).toHaveBeenCalledWith("locked-1");

    wrapper.unmount();
  });
});
