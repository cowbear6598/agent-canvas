import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import PodTypeMenu from "@/components/canvas/PodTypeMenu.vue";

const loadRepositories = vi.fn().mockResolvedValue(undefined);
const hideTypeMenu = vi.fn();

vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    repositoryStore: {
      loadRepositories,
      typedAvailableItems: [],
    },
    podStore: {
      hideTypeMenu,
    },
  }),
}));

vi.mock("@/composables/useMenuPosition", () => ({
  useMenuPosition: () => ({
    menuStyle: ref({ left: "0px", top: "0px" }),
  }),
}));

vi.mock("@/components/canvas/ProviderPicker.vue", () => ({
  default: {
    name: "ProviderPicker",
    template: "<div data-testid='provider-picker-stub'></div>",
  },
}));

vi.mock("@/components/canvas/PodTypeMenuSubmenu.vue", () => ({
  default: {
    name: "PodTypeMenuSubmenu",
    props: ["visible"],
    template: "<div v-if='visible' data-testid='submenu-stub'></div>",
  },
}));

describe("PodTypeMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("右鍵選單只保留 Pod 與 Repository 入口，不再顯示 Commands", async () => {
    const wrapper = mount(PodTypeMenu, {
      props: {
        position: { x: 120, y: 80 },
      },
    });

    await Promise.resolve();

    expect(loadRepositories).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("Pod >");
    expect(wrapper.text()).toContain("Repository >");
    expect(wrapper.text()).not.toContain("Commands >");

    wrapper.unmount();
  });
});
