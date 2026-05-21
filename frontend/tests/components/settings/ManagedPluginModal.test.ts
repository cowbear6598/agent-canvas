import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManagedPluginModal from "@/components/settings/ManagedPluginModal.vue";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import type { InstalledPlugin } from "@/types/plugin";
import { setupTestPinia } from "../../helpers/mockStoreFactory";

vi.mock("vue-draggable-plus", () => ({
  VueDraggable: {
    name: "VueDraggable",
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue", "end"],
    template: `<div class="vue-draggable-stub"><slot /></div>`,
  },
}));

function makePlugin(overrides: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    id: "plugin-a",
    githubRepo: "owner/plugin-a",
    displayName: "Plugin A",
    installPath: "/plugins/plugin-a",
    sortIndex: 0,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const passthroughStub = {
  template: "<div><slot /></div>",
};

describe("ManagedPluginModal", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
  });

  it("拖曳完成後應呼叫 store.reorder(ids)，busy 時不重複提交", async () => {
    const store = useManagedPluginStore();
    const pluginA = makePlugin({ id: "plugin-a", displayName: "Plugin A" });
    const pluginB = makePlugin({
      id: "plugin-b",
      githubRepo: "owner/plugin-b",
      displayName: "Plugin B",
      sortIndex: 1,
    });
    store.plugins = [pluginA, pluginB];
    vi.spyOn(store, "refresh").mockResolvedValue(undefined);

    let resolveReorder!: () => void;
    const reorderSpy = vi.spyOn(store, "reorder").mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReorder = resolve;
      }),
    );

    const wrapper = mount(ManagedPluginModal, {
      props: { open: true },
      global: {
        stubs: {
          Dialog: passthroughStub,
          DialogContent: passthroughStub,
          DialogDescription: passthroughStub,
          DialogFooter: passthroughStub,
          DialogHeader: passthroughStub,
          DialogTitle: passthroughStub,
          ScrollArea: passthroughStub,
          GripVertical: passthroughStub,
        },
      },
    });
    await flushPromises();

    const draggable = wrapper.findComponent({ name: "VueDraggable" });
    await draggable.vm.$emit("update:modelValue", [pluginB, pluginA]);
    await draggable.vm.$emit("end");
    await draggable.vm.$emit("end");

    expect(reorderSpy).toHaveBeenCalledTimes(1);
    expect(reorderSpy).toHaveBeenCalledWith(["plugin-b", "plugin-a"]);

    resolveReorder();
    await flushPromises();
    await draggable.vm.$emit("end");

    expect(reorderSpy).toHaveBeenCalledTimes(2);
  });
});
