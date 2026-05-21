import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginPopover from "@/components/pod/PluginPopover.vue";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import { usePodStore } from "@/stores/pod";
import type { InstalledPlugin } from "@/types/plugin";
import type { Pod } from "@/types";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const { mockUpdatePodPluginsApi } = vi.hoisted(() => ({
  mockUpdatePodPluginsApi: vi.fn(),
}));

vi.mock("@/services/podPluginApi", () => ({
  updatePodPlugins: mockUpdatePodPluginsApi,
}));

vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: vi.fn(() => "canvas-1"),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const switchStub = {
  name: "Switch",
  props: ["modelValue", "disabled"],
  emits: ["update:modelValue"],
  template: `<button class="switch-stub" :data-checked="String(modelValue)" :disabled="disabled" @click="$emit('update:modelValue', !modelValue)" />`,
};

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

function makePod(overrides: Partial<Pod>): Pod {
  return {
    id: "pod-1",
    name: "Pod 1",
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "sonnet" },
    pluginIds: [],
    ...overrides,
  };
}

describe("PluginPopover", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
  });

  it("已有 plugin 快取時不顯示阻塞 loading，仍在背景 refresh", async () => {
    const managedPluginStore = useManagedPluginStore();
    const plugin = makePlugin({ id: "plugin-a" });
    managedPluginStore.plugins = [plugin];
    managedPluginStore.loaded = true;
    managedPluginStore.loading = true;
    const refreshSpy = vi
      .spyOn(managedPluginStore, "refresh")
      .mockResolvedValue(undefined);

    const podStore = usePodStore();
    podStore.pods = [makePod({ id: "pod-1" })];

    const wrapper = mount(PluginPopover, {
      attachTo: document.body,
      props: {
        podId: "pod-1",
        anchorRect: new DOMRect(100, 100, 20, 20),
      },
      global: {
        stubs: {
          ScrollArea: { template: "<div><slot /></div>" },
          Switch: switchStub,
          Teleport: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("載入中");
    expect(wrapper.text()).toContain("Plugin A");
    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  it("背景 refresh 完成不應覆蓋切換中的本地 plugin draft", async () => {
    const managedPluginStore = useManagedPluginStore();
    const plugin = makePlugin({ id: "plugin-a" });
    managedPluginStore.plugins = [plugin];
    managedPluginStore.loaded = true;
    vi.spyOn(managedPluginStore, "refresh").mockImplementation(async () => {
      managedPluginStore.plugins = [makePlugin({ id: "plugin-a" })];
    });

    const podStore = usePodStore();
    podStore.pods = [makePod({ id: "pod-1", pluginIds: [] })];

    let resolveToggle!: () => void;
    mockUpdatePodPluginsApi.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveToggle = resolve;
      }),
    );

    const wrapper = mount(PluginPopover, {
      attachTo: document.body,
      props: {
        podId: "pod-1",
        anchorRect: new DOMRect(100, 100, 20, 20),
      },
      global: {
        stubs: {
          ScrollArea: { template: "<div><slot /></div>" },
          Switch: switchStub,
          Teleport: true,
        },
      },
    });
    await flushPromises();

    const pluginSwitch = wrapper.find(".switch-stub");
    await pluginSwitch.trigger("click");
    await flushPromises();

    expect(pluginSwitch.attributes("data-checked")).toBe("true");
    expect(podStore.getPodById("pod-1")?.pluginIds).toEqual(["plugin-a"]);

    await managedPluginStore.refresh();
    await flushPromises();

    expect(wrapper.find(".switch-stub").attributes("data-checked")).toBe(
      "true",
    );
    expect(podStore.getPodById("pod-1")?.pluginIds).toEqual(["plugin-a"]);

    resolveToggle();
    await flushPromises();
  });
});
