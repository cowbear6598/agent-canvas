import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginPopover from "@/components/pod/PluginPopover.vue";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import { usePodStore } from "@/stores/pod";
import type { InstalledPlugin } from "@/types/plugin";
import type { Pod } from "@/types";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const {
  mockUpdatePodPluginsApi,
  mockListPodCodexSkills,
  mockUpdatePodCodexSkills,
} = vi.hoisted(() => ({
  mockUpdatePodPluginsApi: vi.fn(),
  mockListPodCodexSkills: vi.fn(),
  mockUpdatePodCodexSkills: vi.fn(),
}));

vi.mock("@/services/podPluginApi", () => ({
  updatePodPlugins: mockUpdatePodPluginsApi,
}));

vi.mock("@/services/podCodexSkillApi", () => ({
  listPodCodexSkills: mockListPodCodexSkills,
  updatePodCodexSkills: mockUpdatePodCodexSkills,
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
    source: {
      type: "github",
      ref: "owner/plugin-a",
    },
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

describe("pod plugin popover userflow", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
    mockListPodCodexSkills.mockResolvedValue({
      success: true,
      canvasId: "canvas-1",
      podId: "pod-1",
      items: [],
      selectedKeys: [],
    });
    mockUpdatePodCodexSkills.mockResolvedValue({
      success: true,
      canvasId: "canvas-1",
    });
  });

  it("已有 plugin 快取時不顯示阻塞 loading，仍在背景 refresh", async () => {
    const managedPluginStore = useManagedPluginStore();
    const plugin = makePlugin({ id: "plugin-a" });
    managedPluginStore.plugins = [plugin];
    managedPluginStore.loaded = true;
    managedPluginStore.loading = true;
    vi.spyOn(managedPluginStore, "refresh").mockResolvedValue(undefined);

    const podStore = usePodStore();
    podStore.pods = [makePod({ id: "pod-1" })];

    const wrapper = mount(PluginPopover, {
      attachTo: document.body,
      props: {
        podId: "pod-1",
        anchorRect: new DOMRect(100, 100, 20, 20),
        provider: "claude",
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
        provider: "claude",
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

    expect(podStore.getPodById("pod-1")?.pluginIds).toEqual(["plugin-a"]);

    await managedPluginStore.refresh();
    await flushPromises();

    expect(podStore.getPodById("pod-1")?.pluginIds).toEqual(["plugin-a"]);

    resolveToggle();
    await flushPromises();
  });

  it("Codex Pod 優先顯示使用者 Plugin，並將同一 Plugin 的 Skills 合併切換", async () => {
    const managedPluginStore = useManagedPluginStore();
    managedPluginStore.plugins = [makePlugin({ id: "plugin-a" })];
    managedPluginStore.loaded = true;
    vi.spyOn(managedPluginStore, "refresh").mockResolvedValue(undefined);
    mockListPodCodexSkills.mockResolvedValueOnce({
      success: true,
      canvasId: "canvas-1",
      podId: "pod-1",
      items: [
        {
          key: "system:review",
          name: "review",
          description: "Review current changes",
          scope: "system",
          origin: "official",
          globallyEnabled: true,
        },
        {
          key: "user:soap-toolkit:sentry",
          name: "soap-toolkit:sentry",
          description: "Inspect Sentry issues",
          scope: "user",
          origin: "custom",
          globallyEnabled: true,
        },
        {
          key: "user:soap-toolkit:simplify",
          name: "soap-toolkit:simplify",
          description: "Simplify code",
          scope: "user",
          origin: "custom",
          globallyEnabled: true,
        },
      ],
      selectedKeys: [],
    });

    const podStore = usePodStore();
    podStore.pods = [
      makePod({ id: "pod-1", provider: "codex", codexSkillKeys: [] }),
    ];

    const wrapper = mount(PluginPopover, {
      attachTo: document.body,
      props: {
        podId: "pod-1",
        anchorRect: new DOMRect(100, 100, 20, 20),
        provider: "codex",
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

    const renderedText = wrapper.text();
    expect(renderedText).toContain("Plugin A");
    expect(renderedText).toContain("由 Canvas 安裝");
    expect(renderedText).toContain("review");
    expect(renderedText).toContain("soap-toolkit");
    expect(renderedText).not.toContain("soap-toolkit:sentry");
    expect(renderedText).not.toContain("soap-toolkit:simplify");
    expect(wrapper.find('[data-testid="plugin-skill-group-divider"]').exists()).toBe(
      true,
    );
    expect(podStore.getPodById("pod-1")?.codexSkillKeys).toEqual([]);
    expect(wrapper.find(".space-y-1").classes()).toContain("pr-3");
    expect(wrapper.find('[data-testid="skill-origin-official"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="skill-origin-custom"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="skill-origin-group-divider"]').exists(),
    ).toBe(true);
    expect(renderedText.indexOf("使用者安裝")).toBeLessThan(
      renderedText.indexOf("Codex 官方"),
    );
    expect(renderedText.indexOf("由 Canvas 安裝")).toBeLessThan(
      renderedText.indexOf("使用者安裝"),
    );

    const resources = wrapper.findAll(
      '[data-testid="codex-skill-resource"]',
    );
    expect(resources).toHaveLength(2);
    expect(resources.map((resource) => resource.text())).toEqual([
      "soap-toolkit",
      "review",
    ]);

    const switches = wrapper.findAll(".switch-stub");
    await switches[1]!.trigger("click");
    await flushPromises();

    expect(mockUpdatePodCodexSkills).toHaveBeenCalledWith(
      "canvas-1",
      "pod-1",
      ["user:soap-toolkit:sentry", "user:soap-toolkit:simplify"],
    );
  });
});
