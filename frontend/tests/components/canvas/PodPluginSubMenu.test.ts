import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import PodPluginSubMenu from "@/components/canvas/PodPluginSubMenu.vue";

const {
  mockListPlugins,
  mockUpdatePodPluginsApi,
  mockToast,
  mockGetActiveCanvasIdOrWarn,
  mockGetPodById,
  mockUpdatePodPlugins,
} = vi.hoisted(() => ({
  mockListPlugins: vi.fn(),
  mockUpdatePodPluginsApi: vi.fn(),
  mockToast: vi.fn(),
  mockGetActiveCanvasIdOrWarn: vi.fn(),
  mockGetPodById: vi.fn().mockReturnValue(null),
  mockUpdatePodPlugins: vi.fn(),
}));

vi.mock("@/services/pluginApi", () => ({
  listPlugins: mockListPlugins,
}));

vi.mock("@/services/podPluginApi", () => ({
  updatePodPlugins: mockUpdatePodPluginsApi,
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: (...args: unknown[]) =>
    mockGetActiveCanvasIdOrWarn(...args),
}));

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  return {
    ...actual,
    usePodStore: () => ({
      getPodById: mockGetPodById,
      updatePodPlugins: mockUpdatePodPlugins,
    }),
  };
});

vi.mock("@/components/ui/switch", () => ({
  Switch: {
    name: "Switch",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<button class="switch-mock" :data-checked="modelValue" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: {
    name: "ScrollArea",
    template: "<div><slot /></div>",
  },
}));

const defaultProps = {
  podId: "pod-123",
  position: { x: 100, y: 200 },
};

function mountMenu(props = {}) {
  return mount(PodPluginSubMenu, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

describe("PodPluginSubMenu", () => {
  setupStoreTest(() => {
    mockGetActiveCanvasIdOrWarn.mockReturnValue("canvas-1");
    mockListPlugins.mockResolvedValue([]);
    mockUpdatePodPluginsApi.mockResolvedValue({ success: true });
  });

  describe("初始化", () => {
    it("掛載時應從 podStore 讀取現有 pluginIds 並初始化", async () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        pluginIds: ["plugin-a", "plugin-b"],
      });
      mockListPlugins.mockResolvedValue([
        { id: "plugin-a", name: "Plugin A", version: "1.0.0" },
        { id: "plugin-b", name: "Plugin B", version: "2.0.0" },
      ]);

      const wrapper = mountMenu();
      await flushPromises();

      // 確認 switch 狀態對應已初始化的 pluginIds
      const switches = wrapper.findAll(".switch-mock");
      expect(switches[0]!.attributes("data-checked")).toBe("true");
      expect(switches[1]!.attributes("data-checked")).toBe("true");

      wrapper.unmount();
    });

    it("掛載時應呼叫 listPlugins 載入 Plugin 列表", async () => {
      mockListPlugins.mockResolvedValue([]);

      const wrapper = mountMenu();
      await flushPromises();

      expect(mockListPlugins).toHaveBeenCalledTimes(1);

      wrapper.unmount();
    });
  });

  describe("Plugin 列表渲染", () => {
    it("無已安裝 Plugin 時應顯示「尚未安裝任何 Plugin」", async () => {
      mockListPlugins.mockResolvedValue([]);

      const wrapper = mountMenu();
      await flushPromises();

      expect(wrapper.text()).toContain("尚未安裝任何 Plugin");

      wrapper.unmount();
    });

    it("有已安裝 Plugin 時應顯示 Plugin 名稱和版本", async () => {
      mockListPlugins.mockResolvedValue([
        { id: "plugin-1", name: "My Plugin", version: "1.2.3" },
        { id: "plugin-2", name: "Another Plugin", version: "0.9.0" },
      ]);

      const wrapper = mountMenu();
      await flushPromises();

      expect(wrapper.text()).toContain("My Plugin");
      expect(wrapper.text()).toContain("v1.2.3");
      expect(wrapper.text()).toContain("Another Plugin");
      expect(wrapper.text()).toContain("v0.9.0");

      wrapper.unmount();
    });
  });

  describe("切換 Switch", () => {
    it("切換 Switch 開啟時應更新 podStore 並呼叫 API", async () => {
      mockGetPodById.mockReturnValue({ id: "pod-123", pluginIds: [] });
      mockListPlugins.mockResolvedValue([
        { id: "plugin-1", name: "Plugin One", version: "1.0.0" },
      ]);

      const wrapper = mountMenu();
      await flushPromises();

      const switchBtn = wrapper.find(".switch-mock");
      await switchBtn.trigger("click");
      await flushPromises();

      expect(mockUpdatePodPlugins).toHaveBeenCalledWith("pod-123", [
        "plugin-1",
      ]);
      expect(mockUpdatePodPluginsApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-123",
        ["plugin-1"],
      );

      wrapper.unmount();
    });

    it("切換 Switch 關閉時應移除對應 pluginId", async () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        pluginIds: ["plugin-1"],
      });
      mockListPlugins.mockResolvedValue([
        { id: "plugin-1", name: "Plugin One", version: "1.0.0" },
      ]);

      const wrapper = mountMenu();
      await flushPromises();

      const switchBtn = wrapper.find(".switch-mock");
      // 目前為開啟狀態（data-checked=true），點擊後關閉
      await switchBtn.trigger("click");
      await flushPromises();

      expect(mockUpdatePodPlugins).toHaveBeenCalledWith("pod-123", []);
      expect(mockUpdatePodPluginsApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-123",
        [],
      );

      wrapper.unmount();
    });

    it("API 呼叫失敗時應回滾並顯示錯誤 toast", async () => {
      mockGetPodById.mockReturnValue({ id: "pod-123", pluginIds: [] });
      mockListPlugins.mockResolvedValue([
        { id: "plugin-1", name: "Plugin One", version: "1.0.0" },
      ]);
      mockUpdatePodPluginsApi.mockRejectedValue(new Error("API 錯誤"));

      const wrapper = mountMenu();
      await flushPromises();

      const switchBtn = wrapper.find(".switch-mock");
      await switchBtn.trigger("click");
      await flushPromises();

      // 回滾：應呼叫 updatePodPlugins 回到原始值 []
      const calls = mockUpdatePodPlugins.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toEqual(["pod-123", []]);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Plugin 設定失敗",
          variant: "destructive",
        }),
      );

      wrapper.unmount();
    });

    it("canvasId 取得失敗時應回滾不呼叫 API", async () => {
      mockGetActiveCanvasIdOrWarn.mockReturnValue(null);
      mockGetPodById.mockReturnValue({ id: "pod-123", pluginIds: [] });
      mockListPlugins.mockResolvedValue([
        { id: "plugin-1", name: "Plugin One", version: "1.0.0" },
      ]);

      const wrapper = mountMenu();
      await flushPromises();

      const switchBtn = wrapper.find(".switch-mock");
      await switchBtn.trigger("click");
      await flushPromises();

      expect(mockUpdatePodPluginsApi).not.toHaveBeenCalled();

      // 回滾：應呼叫 updatePodPlugins 回到原始值 []
      const calls = mockUpdatePodPlugins.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toEqual(["pod-123", []]);

      wrapper.unmount();
    });

    it("點擊整列 plugin row 應觸發 toggle", async () => {
      mockGetPodById.mockReturnValue({ id: "pod-123", pluginIds: [] });
      mockListPlugins.mockResolvedValue([
        { id: "plugin-1", name: "Plugin One", version: "1.0.0" },
      ]);

      const wrapper = mountMenu();
      await flushPromises();

      // 直接點擊 plugin row 的整列 div，而非 switch
      const pluginRow = wrapper.find(".flex.items-center");
      await pluginRow.trigger("click");
      await flushPromises();

      expect(mockUpdatePodPlugins).toHaveBeenCalledWith("pod-123", [
        "plugin-1",
      ]);
      expect(mockUpdatePodPluginsApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-123",
        ["plugin-1"],
      );

      wrapper.unmount();
    });
  });

  describe("載入失敗", () => {
    it("listPlugins 失敗時應顯示錯誤 toast 並帶有「載入 Plugin 列表失敗」訊息", async () => {
      mockListPlugins.mockRejectedValue(new Error("網路錯誤"));

      const wrapper = mountMenu();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "載入 Plugin 列表失敗",
          variant: "destructive",
        }),
      );

      wrapper.unmount();
    });
  });
});
