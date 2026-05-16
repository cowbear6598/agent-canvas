import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { setupStoreTest } from "../../helpers/testSetup";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { usePodStore } from "@/stores/pod";

// ── WS 邊界 mock ───────────────────────────────────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── vue-i18n ───────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// ── listPlugins：外部 service 邊界，保留 mock ─────────────────
const mockListPlugins = vi.fn();
vi.mock("@/services/pluginApi", () => ({
  listPlugins: (...args: unknown[]) => mockListPlugins(...args),
}));

// ── updatePodPlugins API：外部 service 邊界，保留 mock ─────────
const mockUpdatePodPluginsApi = vi.fn();
vi.mock("@/services/podPluginApi", () => ({
  updatePodPlugins: (...args: unknown[]) => mockUpdatePodPluginsApi(...args),
}));

// ── getActiveCanvasIdOrWarn ─────────────────────────────────────
const mockGetActiveCanvasIdOrWarn = vi.fn().mockReturnValue("canvas-1");
vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: (...args: unknown[]) =>
    mockGetActiveCanvasIdOrWarn(...args),
}));

// ── useToast ───────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// ── Switch：Teleport 位置計算無法在 jsdom 中重現，保留 stub。
//    disabled 時不 emit update:modelValue，與真實 Switch 行為一致。
vi.mock("@/components/ui/switch", () => ({
  Switch: {
    name: "Switch",
    template:
      '<button class="switch-stub" :disabled="disabled || undefined" :data-checked="modelValue" @click.stop="!disabled && $emit(\'update:modelValue\', !modelValue)"></button>',
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
  },
}));

import PluginPopover from "@/components/pod/PluginPopover.vue";
import type { InstalledPlugin } from "@/types/plugin";

const ANCHOR_RECT = {
  top: 100,
  left: 50,
  right: 150,
  bottom: 120,
  width: 100,
  height: 20,
  x: 50,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

const DEFAULT_PROPS = {
  podId: "pod-1",
  anchorRect: ANCHOR_RECT,
  busy: false,
  provider: "claude" as string,
};

const MOCK_PLUGIN: InstalledPlugin = {
  id: "plugin-1",
  name: "Test Plugin",
  version: "1.0.0",
  description: "A test plugin",
  repo: "https://github.com/test/plugin",
  compatibleProviders: ["claude", "codex"],
};

let wrappers: ReturnType<typeof mount>[] = [];

function mountPopover(overrides: Partial<typeof DEFAULT_PROPS> = {}) {
  const wrapper = mount(PluginPopover, {
    props: { ...DEFAULT_PROPS, ...overrides },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  return wrapper;
}

function bodyQuery(selector: string): Element | null {
  return document.body.querySelector(selector);
}

describe("PluginPopover", () => {
  setupStoreTest(() => {
    mockListPlugins.mockResolvedValue([]);
    mockUpdatePodPluginsApi.mockResolvedValue({ pluginIds: [] });
    mockGetActiveCanvasIdOrWarn.mockReturnValue("canvas-1");

    // 真實 store：預設 pod-1 無 plugins
    const podStore = usePodStore();
    podStore.pods = [
      {
        id: "pod-1",
        name: "Pod 1",
        x: 0,
        y: 0,
        rotation: 0,
        output: [],
        repositoryId: null,
        commandId: null,
        schedule: null,
        mcpServerNames: [],
        pluginIds: [],
        provider: "claude",
        providerConfig: { model: "opus" },
      },
    ];
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
  });

  // ── onMounted 呼叫 listPlugins ────────────────────────────────

  describe("onMounted", () => {
    it.each([["claude"], ["codex"]])(
      "應呼叫 listPlugins 帶 %s provider",
      async (provider) => {
        mountPopover({ provider });
        await flushPromises();
        expect(mockListPlugins).toHaveBeenCalledWith(provider);
      },
    );
  });

  // ESC 通用行為由 useEscapeClose.test.ts 統一覆蓋

  // ── 點擊外部 emit close ────────────────────────────────────────

  describe("點擊外部", () => {
    it("點擊 popover 外部應 emit 'close'", async () => {
      const wrapper = mountPopover();
      await flushPromises();

      const outsideEl = document.createElement("div");
      document.body.appendChild(outsideEl);
      outsideEl.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
      outsideEl.remove();
    });
  });

  // ── 樂觀更新 ──────────────────────────────────────────────────

  describe("樂觀更新", () => {
    it("點 Toggle 立即更新 podStore.updatePodPlugins", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      expect(spy).toHaveBeenCalledWith("pod-1", ["plugin-1"]);
    });
  });

  // ── 失敗回滾 ──────────────────────────────────────────────────

  describe("失敗回滾", () => {
    it("API 失敗時 podStore 回滾到原始陣列，並顯示 toast", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mockUpdatePodPluginsApi.mockRejectedValue(new Error("Network error"));
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      // 最後一次呼叫應回滾到空陣列
      expect(spy).toHaveBeenLastCalledWith("pod-1", []);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });

  // ── 空狀態 ────────────────────────────────────────────────────

  describe("空狀態（installedPlugins 為空）", () => {
    it.each([["claude"], ["codex"]])(
      "%s provider 顯示 pluginsEmpty 的 i18n key",
      async (provider) => {
        mockListPlugins.mockResolvedValue([]);
        mountPopover({ provider });
        await flushPromises();

        const popover = bodyQuery(".fixed.z-50");
        expect(popover).not.toBeNull();
        expect(popover!.textContent).toContain("pod.slot.pluginsEmpty");
      },
    );
  });

  // ── 搜尋功能 ──────────────────────────────────────────────────

  describe("搜尋功能", () => {
    const PLUGINS: InstalledPlugin[] = [
      {
        id: "plugin-github",
        name: "github",
        version: "1.0.0",
        description: "",
        repo: "",
        compatibleProviders: ["claude"],
      },
      {
        id: "plugin-gitlab",
        name: "gitlab",
        version: "1.0.0",
        description: "",
        repo: "",
        compatibleProviders: ["claude"],
      },
      {
        id: "plugin-slack",
        name: "slack",
        version: "1.0.0",
        description: "",
        repo: "",
        compatibleProviders: ["claude"],
      },
    ];

    async function setInputValue(input: HTMLInputElement, value: string) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();
    }

    it("輸入搜尋字串後列表只顯示符合的 plugin", async () => {
      mockListPlugins.mockResolvedValue(PLUGINS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      expect(input).not.toBeNull();
      await setInputValue(input, "git");

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("github");
      expect(popover!.textContent).toContain("gitlab");
      expect(popover!.textContent).not.toContain("slack");
    });

    it("搜尋不分大小寫", async () => {
      mockListPlugins.mockResolvedValue(PLUGINS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "GIT");

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("github");
      expect(popover!.textContent).toContain("gitlab");
      expect(popover!.textContent).not.toContain("slack");
    });

    it("清空搜尋框後恢復顯示全量 plugin", async () => {
      mockListPlugins.mockResolvedValue(PLUGINS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "git");
      await setInputValue(input, "");

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("github");
      expect(popover!.textContent).toContain("gitlab");
      expect(popover!.textContent).toContain("slack");
    });

    it("搜尋無結果時顯示 pod.slot.pluginsSearchEmpty", async () => {
      mockListPlugins.mockResolvedValue(PLUGINS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "xxx");

      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "pod.slot.pluginsSearchEmpty",
      );
    });

    it("掛載後搜尋框已渲染", async () => {
      mockListPlugins.mockResolvedValue(PLUGINS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      expect(bodyQuery(".pod-popover-search")).not.toBeNull();
    });
  });

  // ── Codex 唯讀模式 ────────────────────────────────────────────

  describe("Codex 唯讀模式", () => {
    it("不渲染 Switch、顯示 name vX.Y.Z 格式與 pluginsCodexHint", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      expect(bodyQuery(".switch-stub")).toBeNull();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("Test Plugin v1.0.0");
      expect(popover!.textContent).toContain("pod.slot.pluginsCodexHint");
    });

    it("不應呼叫 updatePodPluginsApi（Codex 無 Switch）", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      expect(mockUpdatePodPluginsApi).not.toHaveBeenCalled();
    });
  });

  // ── Gemini provider ────────────────────────────────────────────────────────

  describe("Gemini provider", () => {
    const GEMINI_PLUGIN: InstalledPlugin = {
      id: "gemini-plugin-1",
      name: "Gemini Plugin",
      version: "2.1.0",
      description: "A gemini plugin",
      repo: "https://github.com/test/gemini-plugin",
      compatibleProviders: ["gemini"],
    };

    // T-P1：Gemini + 有 extension 清單：顯示 name 與 v{version}，每筆有可操作的 Switch
    it("T-P1：顯示每筆 plugin 的 name 與 v{version}，且渲染可操作的 Switch", async () => {
      mockListPlugins.mockResolvedValue([GEMINI_PLUGIN]);
      mountPopover({ provider: "gemini" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("Gemini Plugin");
      expect(popover!.textContent).toContain("v2.1.0");

      // 應渲染 Switch（不是 codex 唯讀分支）
      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
    });

    // T-P2：Gemini + localPluginIds 含某 id → 對應 Switch data-checked = true
    it("T-P2：localPluginIds 含 plugin id 時，對應 Switch data-checked = true", async () => {
      mockListPlugins.mockResolvedValue([GEMINI_PLUGIN]);

      // 設定 pod-1 已啟用 gemini-plugin-1
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-1",
          name: "Pod 1",
          x: 0,
          y: 0,
          rotation: 0,
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: ["gemini-plugin-1"],
          provider: "gemini",
          providerConfig: { model: "gemini-2.5-pro" },
        },
      ];

      mountPopover({ provider: "gemini" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
      expect(switchBtn!.getAttribute("data-checked")).toBe("true");
    });

    // T-P3：Gemini 點 Switch 啟用 → 呼叫 updatePodPlugins(canvasId, podId, [...prev, id])
    it("T-P3：點 Switch 啟用：呼叫 updatePodPluginsApi(canvasId, podId, [...prev, id])", async () => {
      mockListPlugins.mockResolvedValue([GEMINI_PLUGIN]);
      mockUpdatePodPluginsApi.mockResolvedValue({
        pluginIds: ["gemini-plugin-1"],
      });

      mountPopover({ provider: "gemini" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
      // 初始 data-checked = false → 點擊後應啟用
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      expect(mockUpdatePodPluginsApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-1",
        ["gemini-plugin-1"],
      );
    });

    // T-P4：Gemini 點 Switch 取消 → 呼叫 updatePodPlugins(canvasId, podId, prev.filter)
    it("T-P4：點 Switch 取消：呼叫 updatePodPluginsApi(canvasId, podId, prev.filter)", async () => {
      mockListPlugins.mockResolvedValue([GEMINI_PLUGIN]);
      mockUpdatePodPluginsApi.mockResolvedValue({ pluginIds: [] });

      // 設定 pod-1 已啟用 gemini-plugin-1
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-1",
          name: "Pod 1",
          x: 0,
          y: 0,
          rotation: 0,
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: ["gemini-plugin-1"],
          provider: "gemini",
          providerConfig: { model: "gemini-2.5-pro" },
        },
      ];

      mountPopover({ provider: "gemini" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
      // data-checked = true → 點擊後應取消
      expect(switchBtn!.getAttribute("data-checked")).toBe("true");
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      expect(mockUpdatePodPluginsApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-1",
        [],
      );
    });

    // T-P5：Gemini + installedPlugins = [] → 顯示 pluginsEmpty 空狀態
    it("T-P5：installedPlugins = [] 時顯示 pod.slot.pluginsEmpty 空狀態", async () => {
      mockListPlugins.mockResolvedValue([]);
      mountPopover({ provider: "gemini" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.pluginsEmpty");
    });

    // T-P7：Gemini + listPlugins reject → 顯示 pluginsEmpty 空狀態
    it("T-P7：listPlugins 載入失敗時顯示 pod.slot.pluginsEmpty 空狀態", async () => {
      mockListPlugins.mockRejectedValue(new Error("Network error"));
      mountPopover({ provider: "gemini" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.pluginsEmpty");
    });
  });
});
