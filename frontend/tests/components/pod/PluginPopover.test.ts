import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

// ── mock vue-i18n ────────────────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// ── mock listPlugins ─────────────────────────────────────────────────────────
const mockListPlugins = vi.fn();
vi.mock("@/services/pluginApi", () => ({
  listPlugins: (...args: unknown[]) => mockListPlugins(...args),
}));

// ── mock updatePodPluginsApi ─────────────────────────────────────────────────
const mockUpdatePodPluginsApi = vi.fn();
vi.mock("@/services/podPluginApi", () => ({
  updatePodPlugins: (...args: unknown[]) => mockUpdatePodPluginsApi(...args),
}));

// ── mock getActiveCanvasIdOrWarn ──────────────────────────────────────────────
const mockGetActiveCanvasIdOrWarn = vi.fn().mockReturnValue("canvas-1");
vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: (...args: unknown[]) =>
    mockGetActiveCanvasIdOrWarn(...args),
}));

// ── mock useToast ────────────────────────────────────────────────────────────
const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

// ── mock usePodStore ──────────────────────────────────────────────────────────
const mockUpdatePodPlugins = vi.fn();
const mockGetPodById = vi.fn();
vi.mock("@/stores/pod", () => ({
  usePodStore: () => ({
    getPodById: mockGetPodById,
    updatePodPlugins: mockUpdatePodPlugins,
  }),
}));

// ── mock Switch component ─────────────────────────────────────────────────────
vi.mock("@/components/ui/switch", () => ({
  Switch: {
    name: "Switch",
    template:
      '<button class="switch-stub" :disabled="disabled || undefined" :data-checked="modelValue" @click.stop="$emit(\'update:modelValue\', !modelValue)"></button>',
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

/** Teleport 將內容渲染至 body，需透過 document.body.querySelector 搜尋 */
function bodyQuery(selector: string): Element | null {
  return document.body.querySelector(selector);
}

function bodyQueryAll(selector: string): NodeListOf<Element> {
  return document.body.querySelectorAll(selector);
}

function bodyText(): string {
  return document.body.innerText ?? document.body.textContent ?? "";
}

describe("PluginPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wrappers = [];
    // 預設：getPodById 回傳有 pluginIds 的 pod
    mockGetPodById.mockReturnValue({ id: "pod-1", pluginIds: [] });
    // 預設：listPlugins 成功回傳空陣列（各 case 再覆蓋）
    mockListPlugins.mockResolvedValue([]);
    mockUpdatePodPluginsApi.mockResolvedValue({ pluginIds: [] });
  });

  afterEach(() => {
    for (const w of wrappers) {
      w.unmount();
    }
    wrappers = [];
  });

  // ── onMounted 呼叫 listPlugins ────────────────────────────────────────────

  describe("onMounted", () => {
    it("應呼叫 listPlugins 並帶 provider 參數", async () => {
      mountPopover({ provider: "claude" });
      await flushPromises();

      expect(mockListPlugins).toHaveBeenCalledOnce();
      expect(mockListPlugins).toHaveBeenCalledWith("claude");
    });

    it("codex provider 時應呼叫 listPlugins('codex')", async () => {
      mountPopover({ provider: "codex" });
      await flushPromises();

      expect(mockListPlugins).toHaveBeenCalledWith("codex");
    });
  });

  // ── ESC 鍵 emit close ────────────────────────────────────────────────────

  describe("ESC 鍵", () => {
    it("按下 ESC 應 emit 'close'", async () => {
      const wrapper = mountPopover();
      await flushPromises();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("按下其他鍵不應 emit 'close'", async () => {
      const wrapper = mountPopover();
      await flushPromises();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await nextTick();

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  // ── 點擊外部 emit close ──────────────────────────────────────────────────

  describe("點擊外部", () => {
    it("點擊 popover 外部應 emit 'close'", async () => {
      const wrapper = mountPopover();
      await flushPromises();

      // 建立外部元素，觸發 capture mousedown
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

  // ── 樂觀更新 ────────────────────────────────────────────────────────────

  describe("樂觀更新", () => {
    it("點 Toggle 立即更新 localPluginIds 與 podStore", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mockGetPodById.mockReturnValue({ id: "pod-1", pluginIds: [] });

      mountPopover();
      await flushPromises();

      // Teleport 將內容渲染到 document.body — 需用 body.querySelector
      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      // updatePodPlugins store 應已被呼叫（樂觀更新）
      expect(mockUpdatePodPlugins).toHaveBeenCalledWith("pod-1", ["plugin-1"]);
    });
  });

  // ── 失敗回滾 ────────────────────────────────────────────────────────────

  describe("失敗回滾", () => {
    it("API 失敗時 localPluginIds 與 podStore 還原，並顯示 toast", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mockGetPodById.mockReturnValue({ id: "pod-1", pluginIds: [] });
      mockUpdatePodPluginsApi.mockRejectedValue(new Error("Network error"));

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      // 應回滾到空陣列
      expect(mockUpdatePodPlugins).toHaveBeenLastCalledWith("pod-1", []);
      // 應顯示 toast
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });
  });

  // ── busy = true 時 Toggle disabled ───────────────────────────────────────

  describe("busy = true", () => {
    it("Switch 應為 disabled 狀態", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);

      mountPopover({ busy: true });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
      expect(switchBtn!.hasAttribute("disabled")).toBe(true);
    });
  });

  // ── 空狀態 ───────────────────────────────────────────────────────────────

  describe("空狀態（installedPlugins 為空）", () => {
    it("claude provider 顯示 pluginsEmpty 的 i18n key", async () => {
      mockListPlugins.mockResolvedValue([]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      // Teleport 內容在 body，用 textContent 確認
      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.pluginsEmpty");
    });

    it("codex provider 顯示 pluginsEmpty 的 i18n key", async () => {
      mockListPlugins.mockResolvedValue([]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.pluginsEmpty");
    });
  });

  // ── Codex 唯讀模式 ────────────────────────────────────────────────────────

  describe("Codex 唯讀模式", () => {
    it("不應渲染 Switch（Toggle）", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).toBeNull();
    });

    it("應顯示 name vX.Y.Z 格式", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("Test Plugin v1.0.0");
    });

    it("應顯示 pluginsCodexHint 的 i18n key", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.pluginsCodexHint");
    });

    it("不應呼叫 updatePodPluginsApi（即便觸發 handleToggle）", async () => {
      mockListPlugins.mockResolvedValue([MOCK_PLUGIN]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      // Codex 模式下沒有 Switch，故不可能觸發 — 確認 api 不曾被呼叫
      expect(mockUpdatePodPluginsApi).not.toHaveBeenCalled();
    });
  });
});
