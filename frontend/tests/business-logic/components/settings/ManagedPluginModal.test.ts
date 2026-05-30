import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManagedPluginModal from "@/components/settings/ManagedPluginModal.vue";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import type { InstalledPlugin } from "@/types/plugin";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

function createPlugin(overrides?: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    id: "owner/repo-a",
    source: { type: "github", ref: "owner/repo-a" },
    displayName: "Shared Skill",
    installPath: "/plugins/owner__repo-a",
    sortIndex: 0,
    installedAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const dialogStub = { template: "<div><slot /></div>" };

describe("ManagedPluginModal", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
  });

  it("唯一 displayName 時不顯示來源資訊", async () => {
    const store = useManagedPluginStore();
    store.plugins = [createPlugin({ displayName: "Unique Skill" })];
    store.loading = false;
    vi.spyOn(store, "refresh").mockResolvedValue(undefined);

    const wrapper = mount(ManagedPluginModal, {
      props: { open: true },
      global: {
        stubs: {
          Dialog: dialogStub,
          DialogContent: dialogStub,
          DialogDescription: dialogStub,
          DialogHeader: dialogStub,
          DialogTitle: dialogStub,
          DialogFooter: dialogStub,
          ScrollArea: dialogStub,
          VueDraggable: dialogStub,
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Unique Skill");
    expect(wrapper.text()).not.toContain("owner/repo-a");
  });

  it("同名 skill 時顯示來源資訊供使用者區分", async () => {
    const store = useManagedPluginStore();
    store.plugins = [
      createPlugin({
        id: "owner/repo-a",
        source: { type: "github", ref: "owner/repo-a" },
      }),
      createPlugin({
        id: "owner/repo-b",
        source: { type: "github", ref: "owner/repo-b" },
      }),
    ];
    store.loading = false;
    vi.spyOn(store, "refresh").mockResolvedValue(undefined);

    const wrapper = mount(ManagedPluginModal, {
      props: { open: true },
      global: {
        stubs: {
          Dialog: dialogStub,
          DialogContent: dialogStub,
          DialogDescription: dialogStub,
          DialogHeader: dialogStub,
          DialogTitle: dialogStub,
          DialogFooter: dialogStub,
          ScrollArea: dialogStub,
          VueDraggable: dialogStub,
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("owner/repo-a");
    expect(wrapper.text()).toContain("owner/repo-b");
  });

  it("關閉 modal 時會清掉錯誤訊息與已選 zip", async () => {
    const store = useManagedPluginStore();
    store.plugins = [];
    store.loading = false;
    vi.spyOn(store, "refresh").mockResolvedValue(undefined);
    vi.spyOn(store, "upload").mockRejectedValue(new Error("上傳失敗"));

    const wrapper = mount(ManagedPluginModal, {
      props: { open: true },
      global: {
        stubs: {
          Dialog: dialogStub,
          DialogContent: dialogStub,
          DialogDescription: dialogStub,
          DialogHeader: dialogStub,
          DialogTitle: dialogStub,
          DialogFooter: dialogStub,
          ScrollArea: dialogStub,
          VueDraggable: dialogStub,
        },
      },
    });

    const fileInput = wrapper.find('input[type="file"]');
    const file = new File(["zip"], "bundle.zip", { type: "application/zip" });
    Object.defineProperty(fileInput.element, "files", {
      value: [file],
      configurable: true,
    });
    await fileInput.trigger("change");
    await flushPromises();

    expect(wrapper.text()).toContain("bundle.zip");

    const uploadButtons = wrapper
      .findAll("button")
      .filter((button) => button.text() === "新增");
    const uploadButton = uploadButtons.at(-1);
    expect(uploadButton).toBeDefined();
    await uploadButton!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("上傳失敗");

    await wrapper.setProps({ open: false });
    await flushPromises();

    expect(wrapper.text()).not.toContain("上傳失敗");
    expect(wrapper.text()).not.toContain("bundle.zip");
  });
});
