import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

// ── mock vue-i18n ────────────────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// ── mock listMcpServers ──────────────────────────────────────────────────────
const mockListMcpServers = vi.fn();

// ── mock updatePodMcpServersApi ──────────────────────────────────────────────
const mockUpdatePodMcpServersApi = vi.fn();

vi.mock("@/services/mcpApi", () => ({
  listMcpServers: (...args: unknown[]) => mockListMcpServers(...args),
  updatePodMcpServers: (...args: unknown[]) =>
    mockUpdatePodMcpServersApi(...args),
}));

// ── mock getActiveCanvasIdOrWarn ─────────────────────────────────────────────
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
const mockUpdatePodMcpServers = vi.fn();
const mockGetPodById = vi.fn();
vi.mock("@/stores/pod", () => ({
  usePodStore: () => ({
    getPodById: mockGetPodById,
    updatePodMcpServers: mockUpdatePodMcpServers,
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

import McpPopover from "@/components/pod/McpPopover.vue";
import type { McpListItem } from "@/types/mcp";
import type { PodProvider } from "@/types/pod";

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
  provider: "claude" as PodProvider,
};

const MOCK_MCP_SERVER: McpListItem = {
  name: "test-mcp-server",
};

const MOCK_CODEX_MCP_SERVER: McpListItem = {
  name: "codex-mcp-server",
  type: "stdio",
};

let wrappers: ReturnType<typeof mount>[] = [];

function mountPopover(overrides: Partial<typeof DEFAULT_PROPS> = {}) {
  const wrapper = mount(McpPopover, {
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

describe("McpPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wrappers = [];
    // 預設：getPodById 回傳有 mcpServerNames 的 pod
    mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });
    // 預設：listMcpServers 成功回傳空陣列（各 case 再覆蓋）
    mockListMcpServers.mockResolvedValue([]);
    mockUpdatePodMcpServersApi.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const w of wrappers) {
      w.unmount();
    }
    wrappers = [];
  });

  // ── 案例 1：Claude pod popover 顯示本機 MCP 列表 ─────────────────────────

  describe("案例 1：Claude pod popover 顯示本機 MCP 列表", () => {
    it("掛載後應呼叫 listMcpServers 並帶 claude provider 參數", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ provider: "claude" });
      await flushPromises();

      expect(mockListMcpServers).toHaveBeenCalledOnce();
      expect(mockListMcpServers).toHaveBeenCalledWith("claude");
    });

    it("server name 應顯示在 popover 中", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ provider: "claude" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("test-mcp-server");
    });

    it("Claude 模式應顯示 Switch 元件（可 toggle）", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ provider: "claude" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
    });
  });

  // ── 案例 2：Claude pod toggle 啟用某個 MCP server ────────────────────────

  describe("案例 2：Claude pod toggle 啟用某個 MCP server", () => {
    it("點 Toggle 立即更新 localMcpServerNames 與 podStore（樂觀更新）", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      // updatePodMcpServers store 應已被呼叫（樂觀更新）
      expect(mockUpdatePodMcpServers).toHaveBeenCalledWith("pod-1", [
        "test-mcp-server",
      ]);
    });

    it("樂觀更新後應呼叫 updatePodMcpServersApi", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      expect(mockUpdatePodMcpServersApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-1",
        ["test-mcp-server"],
      );
    });
  });

  // ── 案例 3：Claude pod toggle 關閉已啟用的 MCP server ───────────────────

  describe("案例 3：Claude pod toggle 關閉已啟用的 MCP server", () => {
    it("已啟用的 server 點 Toggle 後應從 localMcpServerNames 移除", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      // Pod 一開始已啟用 test-mcp-server
      mockGetPodById.mockReturnValue({
        id: "pod-1",
        mcpServerNames: ["test-mcp-server"],
      });

      mountPopover();
      await flushPromises();

      // Switch 的 data-checked 應為 true（已啟用）
      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      expect(switchBtn).not.toBeNull();
      expect(switchBtn.getAttribute("data-checked")).toBe("true");

      switchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      // 關閉後 store 應更新為空陣列
      expect(mockUpdatePodMcpServers).toHaveBeenCalledWith("pod-1", []);
    });
  });

  // ── 案例 4：Claude pod 本機沒有 MCP server 時顯示空狀態提示 ───────────

  describe("案例 4：本機沒有 MCP server 時顯示空狀態提示", () => {
    it("installedMcpServers 為空時應顯示 pod.slot.mcpEmpty", async () => {
      mockListMcpServers.mockResolvedValue([]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.mcpEmpty");
    });

    it("Claude 空狀態應顯示 pod.slot.mcpClaudeEmptyHint", async () => {
      mockListMcpServers.mockResolvedValue([]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.mcpClaudeEmptyHint");
    });

    it("空狀態時不應顯示 Switch 元件", async () => {
      mockListMcpServers.mockResolvedValue([]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).toBeNull();
    });
  });

  // ── 案例 5：外部移除已啟用的 MCP server 後 popover 自動失效顯示 ─────────

  describe("案例 5：外部移除已啟用的 MCP server 後 popover 自動失效", () => {
    it("後端清單不含先前啟用的 server 時，Switch 仍存在但 data-checked 為 false", async () => {
      // Pod 啟用了 ghost-server，但後端清單已不含它
      mockGetPodById.mockReturnValue({
        id: "pod-1",
        mcpServerNames: ["ghost-server"],
      });
      // 後端清單只有 test-mcp-server，沒有 ghost-server
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ provider: "claude" });
      await flushPromises();

      // ghost-server 已不在清單中，test-mcp-server 的 Switch 應為 false
      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      expect(switchBtn).not.toBeNull();
      expect(switchBtn.getAttribute("data-checked")).toBe("false");
    });
  });

  // ── 案例 6：Claude pod busy 狀態下 toggle 不可操作並顯示 busy 提示 ──────

  describe("案例 6：Claude pod busy 狀態下 toggle 不可操作", () => {
    it("busy=true 時 Switch 應為 disabled 狀態", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ busy: true });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
      expect(switchBtn!.hasAttribute("disabled")).toBe(true);
    });

    it("busy=true 時應顯示 pod.slot.mcpBusyTooltip 作為 title", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ busy: true });
      await flushPromises();

      // 容器 div 應有 title 屬性顯示 busy tooltip
      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      const serverRow = popover!.querySelector(
        "[title='pod.slot.mcpBusyTooltip']",
      );
      expect(serverRow).not.toBeNull();
    });
  });

  // ── 案例 10：Pod 從 Claude 切到 Codex 後 popover 變唯讀 ─────────────────

  describe("案例 10：Codex provider 下 popover 為唯讀模式", () => {
    it("Codex provider 不應渲染 Switch（唯讀）", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_CODEX_MCP_SERVER]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).toBeNull();
    });

    it("Codex provider 應顯示 server name", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_CODEX_MCP_SERVER]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("codex-mcp-server");
    });

    it("Codex provider 應顯示 type 標籤", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_CODEX_MCP_SERVER]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      // type 標籤應包含 "stdio"
      expect(popover!.textContent).toContain("stdio");
    });

    it("Codex provider 應顯示 pod.slot.mcpCodexHint", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_CODEX_MCP_SERVER]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain("pod.slot.mcpCodexHint");
    });
  });

  // ── 案例 11：Pod 從 Codex 切回 Claude 後 popover 恢復可 toggle ───────────

  describe("案例 11：Claude provider 下 popover 可 toggle", () => {
    it("Claude provider 應顯示 Switch（可互動）", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();
      // Switch 不應為 disabled（非 busy 狀態）
      expect(switchBtn!.hasAttribute("disabled")).toBe(false);
    });

    it("listMcpServers 應以 claude 為 provider 呼叫", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      expect(mockListMcpServers).toHaveBeenCalledWith("claude");
    });
  });

  // ── 案例 13：toggle 失敗（後端錯誤）回滾本地狀態 ────────────────────────

  describe("案例 13：toggle 失敗後回滾本地狀態", () => {
    it("API 失敗時 podStore.updatePodMcpServers 回滾到空陣列，並顯示 toast", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });
      mockUpdatePodMcpServersApi.mockRejectedValue(new Error("Network error"));

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      // 應回滾到空陣列
      expect(mockUpdatePodMcpServers).toHaveBeenLastCalledWith("pod-1", []);
      // 應顯示 toast（destructive variant）
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    it("API 失敗時 toast description 應使用 err.message", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });
      const errMsg = "MCP server toggle 發生錯誤";
      mockUpdatePodMcpServersApi.mockRejectedValue(new Error(errMsg));

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: errMsg }),
      );
    });

    it("API 失敗且 err 不是 Error 時 toast description 應 fallback 到 i18n key", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });
      // 丟出非 Error 物件
      mockUpdatePodMcpServersApi.mockRejectedValue("unknown");

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "pod.slot.mcpToggleFailed",
        }),
      );
    });
  });

  // ── 案例 7：listMcpServers 失敗時顯示空狀態（loadFailed=true）────────────

  describe("案例 7：listMcpServers 失敗時顯示空狀態", () => {
    it("listMcpServers reject 時 loadFailed 應為 true，並顯示空狀態 UI", async () => {
      // mock listMcpServers reject
      mockListMcpServers.mockRejectedValue(new Error("Network error"));

      const wrapper = mountPopover({ provider: "claude" });
      await flushPromises();

      // 透過存取 component expose 取得 loadFailed ref 或斷言 UI
      // 因 loadFailed 未 expose，改斷言空狀態文字（與 installedMcpServers.length === 0 同 UI）
      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      // 空狀態時顯示 mcpEmpty
      expect(popover!.textContent).toContain("pod.slot.mcpEmpty");
      // Switch 不應出現
      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).toBeNull();
    });
  });

  // ── 案例 8：getActiveCanvasIdOrWarn 回傳 undefined 時不執行 toggle ──────────

  describe("案例 8：getActiveCanvasIdOrWarn 回傳 undefined 時不執行 toggle", () => {
    it("canvasId 取不到時不執行 toggle（store 不被呼叫）", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });
      // mock getActiveCanvasIdOrWarn 回傳 undefined
      mockGetActiveCanvasIdOrWarn.mockReturnValue(undefined);

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      // 點擊 toggle 觸發啟用
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      // canvasId 取不到時在樂觀更新前就 early return，podStore 不應被呼叫
      expect(mockUpdatePodMcpServers).not.toHaveBeenCalled();

      // API 不應被呼叫（canvasId 不存在，直接 return）
      expect(mockUpdatePodMcpServersApi).not.toHaveBeenCalled();
    });
  });

  // ── 案例 9：busy=true 時強行觸發 toggle 不應呼叫 API ────────────────────

  describe("案例 9：busy=true 時強行觸發 toggle 不呼叫 updatePodMcpServersApi", () => {
    it("busy=true 時直接呼叫 toggle handler，updatePodMcpServersApi 不應被呼叫", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetPodById.mockReturnValue({ id: "pod-1", mcpServerNames: [] });

      const wrapper = mountPopover({ busy: true });
      await flushPromises();

      // 找到 Switch stub（disabled 狀態）
      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).not.toBeNull();

      // 強行觸發 click（即使 disabled，仍能用 dispatchEvent 送出事件）
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      // busy=true 時 handleToggle 有 early return，API 不應被呼叫
      expect(mockUpdatePodMcpServersApi).not.toHaveBeenCalled();
    });
  });

  // ── 案例 15：Codex provider 空狀態顯示 mcpCodexEmptyHint ─────────────────

  describe("案例 15：Codex provider 空狀態顯示 mcpCodexEmptyHint", () => {
    it("Codex provider + listMcpServers 回空陣列時應顯示 pod.slot.mcpCodexEmptyHint", async () => {
      mockListMcpServers.mockResolvedValue([]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover).not.toBeNull();
      // 空狀態提示
      expect(popover!.textContent).toContain("pod.slot.mcpEmpty");
      // Codex 專屬空狀態 hint
      expect(popover!.textContent).toContain("pod.slot.mcpCodexEmptyHint");
    });

    it("Codex provider 空狀態時不應顯示 Switch（唯讀）", async () => {
      mockListMcpServers.mockResolvedValue([]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn).toBeNull();
    });
  });

  // ── 案例 14：ESC 與點擊外部可關閉 ────────────────────────────────────────

  describe("案例 14：ESC 鍵與點擊外部可關閉 popover", () => {
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
});
