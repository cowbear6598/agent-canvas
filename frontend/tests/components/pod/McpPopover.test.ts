import { describe, it, expect, vi, afterEach } from "vitest";
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

// ── listMcpServers / updatePodMcpServers：外部 service 邊界，保留 mock ─
const mockListMcpServers = vi.fn();
const mockUpdatePodMcpServersApi = vi.fn();
vi.mock("@/services/mcpApi", () => ({
  listMcpServers: (...args: unknown[]) => mockListMcpServers(...args),
  updatePodMcpServers: (...args: unknown[]) =>
    mockUpdatePodMcpServersApi(...args),
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

const MOCK_MCP_SERVER: McpListItem = { name: "test-mcp-server" };
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

function bodyQuery(selector: string): Element | null {
  return document.body.querySelector(selector);
}

/** 初始化 pod store，讓 getPodById 可找到 pod-1 */
function setupPod(mcpServerNames: string[] = []) {
  const podStore = usePodStore();
  podStore.pods = [
    {
      id: "pod-1",
      name: "Pod 1",
      x: 0,
      y: 0,
      rotation: 0,
      status: "idle",
      output: [],
      repositoryId: null,
      commandId: null,
      schedule: null,
      mcpServerNames,
      pluginIds: [],
      multiInstance: false,
      provider: "claude",
      providerConfig: { model: "opus" },
    },
  ];
}

describe("McpPopover", () => {
  setupStoreTest(() => {
    mockListMcpServers.mockResolvedValue([]);
    mockUpdatePodMcpServersApi.mockResolvedValue(undefined);
    mockGetActiveCanvasIdOrWarn.mockReturnValue("canvas-1");
    setupPod();
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
  });

  // ── Claude pod popover 顯示本機 MCP 列表 ──────────────────────

  describe("Claude pod popover", () => {
    it("掛載後應呼叫 listMcpServers 帶 claude 參數，並顯示 server name 與 Switch", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mountPopover({ provider: "claude" });
      await flushPromises();

      expect(mockListMcpServers).toHaveBeenCalledWith("claude");
      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("test-mcp-server");
      expect(bodyQuery(".switch-stub")).not.toBeNull();
    });
  });

  // ── toggle 啟用 / 關閉 MCP server ────────────────────────────

  describe("toggle MCP server", () => {
    it("點 Toggle 立即更新 podStore.updatePodMcpServers（樂觀更新），並呼叫 API", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      setupPod([]);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover();
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await nextTick();

      expect(spy).toHaveBeenCalledWith("pod-1", ["test-mcp-server"]);

      await flushPromises();
      expect(mockUpdatePodMcpServersApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-1",
        ["test-mcp-server"],
      );
    });

    it("已啟用的 server 點 Toggle 後應從清單移除", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      setupPod(["test-mcp-server"]);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      expect(switchBtn.getAttribute("data-checked")).toBe("true");

      switchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      expect(spy).toHaveBeenCalledWith("pod-1", []);
    });
  });

  // ── 空狀態 ────────────────────────────────────────────────────

  describe("空狀態", () => {
    it("Claude 空狀態顯示 mcpEmpty 與 mcpClaudeEmptyHint，不顯示 Switch", async () => {
      mountPopover({ provider: "claude" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("pod.slot.mcpEmpty");
      expect(popover!.textContent).toContain("pod.slot.mcpClaudeEmptyHint");
      expect(bodyQuery(".switch-stub")).toBeNull();
    });

    it("Codex 空狀態顯示 mcpEmpty 與 mcpCodexEmptyHint，不顯示 Switch", async () => {
      mountPopover({ provider: "codex" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("pod.slot.mcpEmpty");
      expect(popover!.textContent).toContain("pod.slot.mcpCodexEmptyHint");
      expect(bodyQuery(".switch-stub")).toBeNull();
    });
  });

  // ── 外部移除已啟用 server 後 Switch 失效 ─────────────────────

  describe("外部移除已啟用 server", () => {
    it("後端清單不含先前啟用的 server 時，Switch 應存在但 data-checked=false", async () => {
      // pod 啟用了 ghost-server，但後端清單只有 test-mcp-server
      setupPod(["ghost-server"]);
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);

      mountPopover({ provider: "claude" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      expect(switchBtn).not.toBeNull();
      expect(switchBtn.getAttribute("data-checked")).toBe("false");
    });
  });

  // ── busy 狀態 ─────────────────────────────────────────────────

  describe("busy 狀態", () => {
    it("busy=true 時 Switch disabled，並顯示 mcpBusyTooltip", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mountPopover({ busy: true });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn!.hasAttribute("disabled")).toBe(true);

      const popover = bodyQuery(".fixed.z-50");
      expect(
        popover!.querySelector("[title='pod.slot.mcpBusyTooltip']"),
      ).not.toBeNull();
    });

    it("busy=true 時 click 不觸發 updatePodMcpServersApi", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mountPopover({ busy: true });
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushPromises();

      expect(mockUpdatePodMcpServersApi).not.toHaveBeenCalled();
    });
  });

  // ── Codex 唯讀模式 ────────────────────────────────────────────

  describe("Codex 唯讀模式", () => {
    it("不渲染 Switch，顯示 name、type、mcpCodexHint", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_CODEX_MCP_SERVER]);
      mountPopover({ provider: "codex" });
      await flushPromises();

      expect(bodyQuery(".switch-stub")).toBeNull();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("codex-mcp-server");
      expect(popover!.textContent).toContain("stdio");
      expect(popover!.textContent).toContain("pod.slot.mcpCodexHint");
    });
  });

  // ── listMcpServers 失敗 ────────────────────────────────────────

  describe("listMcpServers 失敗", () => {
    it("reject 時顯示 mcpLoadFailed，不顯示 mcpEmpty，不顯示 Switch", async () => {
      mockListMcpServers.mockRejectedValue(new Error("Network error"));
      mountPopover({ provider: "claude" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("pod.slot.mcpLoadFailed");
      expect(bodyQuery(".switch-stub")).toBeNull();
    });
  });

  // ── getActiveCanvasIdOrWarn 回傳 undefined ────────────────────

  describe("canvasId 取不到", () => {
    it("toggle 不呼叫 store 也不呼叫 API", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockGetActiveCanvasIdOrWarn.mockReturnValue(undefined);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover();
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await nextTick();

      expect(spy).not.toHaveBeenCalled();
      expect(mockUpdatePodMcpServersApi).not.toHaveBeenCalled();
    });
  });

  // ── toggle 失敗回滾 ────────────────────────────────────────────

  describe("toggle 失敗後回滾", () => {
    it("API 失敗時 podStore 回滾到空陣列，toast description fallback 到 i18n key", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockUpdatePodMcpServersApi.mockRejectedValue(new Error("Network error"));
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover();
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushPromises();

      expect(spy).toHaveBeenLastCalledWith("pod-1", []);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: "pod.slot.mcpToggleFailed",
        }),
      );
    });

    it("err 非 Error 物件時 toast description 仍 fallback 到 i18n key", async () => {
      mockListMcpServers.mockResolvedValue([MOCK_MCP_SERVER]);
      mockUpdatePodMcpServersApi.mockRejectedValue("unknown");

      mountPopover();
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "pod.slot.mcpToggleFailed" }),
      );
    });
  });

  // ── 搜尋功能 ──────────────────────────────────────────────────

  describe("搜尋功能", () => {
    const SERVERS: McpListItem[] = [
      { name: "github" },
      { name: "gitlab" },
      { name: "slack" },
    ];

    async function setInputValue(input: HTMLInputElement, value: string) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();
    }

    it("輸入搜尋字串後列表只顯示符合的 server", async () => {
      mockListMcpServers.mockResolvedValue(SERVERS);
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
      mockListMcpServers.mockResolvedValue(SERVERS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "GIT");

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("github");
      expect(popover!.textContent).toContain("gitlab");
      expect(popover!.textContent).not.toContain("slack");
    });

    it("清空搜尋框後恢復顯示全量 server", async () => {
      mockListMcpServers.mockResolvedValue(SERVERS);
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

    it("搜尋無結果時顯示 pod.slot.mcpSearchEmpty", async () => {
      mockListMcpServers.mockResolvedValue(SERVERS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "xxx");

      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "pod.slot.mcpSearchEmpty",
      );
    });

    it("掛載後搜尋框已渲染", async () => {
      mockListMcpServers.mockResolvedValue(SERVERS);
      mountPopover({ provider: "claude" });
      await flushPromises();

      expect(bodyQuery(".pod-popover-search")).not.toBeNull();
    });
  });

  // ── 點擊外部 ─────────────────────────────────────────────────────
  // ESC 通用行為由 useEscapeClose.test.ts 統一覆蓋

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

  // ── Gemini pod popover ────────────────────────────────────────

  /** 含 stdio / sse / http 三種 type 的 Gemini MCP fixture */
  const GEMINI_MCP_SERVERS: McpListItem[] = [
    { name: "gemini-stdio-server", type: "stdio" },
    { name: "gemini-sse-server", type: "sse" },
    { name: "gemini-http-server", type: "http" },
  ];

  describe("Gemini pod popover", () => {
    // B8：掛載後呼叫 listMcpServers("gemini")
    it("B8：掛載後應呼叫 listMcpServers 帶 gemini 參數", async () => {
      mockListMcpServers.mockResolvedValue(GEMINI_MCP_SERVERS);
      mountPopover({ provider: "gemini" });
      await flushPromises();

      expect(mockListMcpServers).toHaveBeenCalledWith("gemini");
    });

    // B1：Gemini pod 打開 popover 顯示 name + type chip + Switch 三段式 row
    it("B1：顯示 name + type chip + Switch 三段式 row", async () => {
      mockListMcpServers.mockResolvedValue(GEMINI_MCP_SERVERS);
      mountPopover({ provider: "gemini" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      // 三個 server name 都顯示
      expect(popover!.textContent).toContain("gemini-stdio-server");
      expect(popover!.textContent).toContain("gemini-sse-server");
      expect(popover!.textContent).toContain("gemini-http-server");
      // type chip 顯示
      expect(popover!.textContent).toContain("stdio");
      expect(popover!.textContent).toContain("sse");
      expect(popover!.textContent).toContain("http");
      // Switch 存在（可 toggle）
      expect(bodyQuery(".switch-stub")).not.toBeNull();
    });

    // B2：Gemini popover 空狀態顯示 mcpEmpty + mcpGeminiEmptyHint
    it("B2：空狀態顯示 mcpEmpty 與 mcpGeminiEmptyHint，不顯示 Switch", async () => {
      mockListMcpServers.mockResolvedValue([]);
      mountPopover({ provider: "gemini" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("pod.slot.mcpEmpty");
      expect(popover!.textContent).toContain("pod.slot.mcpGeminiEmptyHint");
      expect(bodyQuery(".switch-stub")).toBeNull();
    });

    // B3：Gemini popover 搜尋過濾，無結果時顯示 mcpSearchEmpty
    it("B3：搜尋輸入後即時過濾，無結果時顯示 mcpSearchEmpty", async () => {
      mockListMcpServers.mockResolvedValue(GEMINI_MCP_SERVERS);
      mountPopover({ provider: "gemini" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      input.value = "zzz-not-exist";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();

      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "pod.slot.mcpSearchEmpty",
      );
    });

    // B4：Gemini popover busy=true 時 Switch disabled，row title 顯示 busy tooltip
    it("B4：busy=true 時 Switch disabled，row title 顯示 mcpBusyTooltip", async () => {
      mockListMcpServers.mockResolvedValue(GEMINI_MCP_SERVERS);
      mountPopover({ provider: "gemini", busy: true });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub");
      expect(switchBtn!.hasAttribute("disabled")).toBe(true);

      const popover = bodyQuery(".fixed.z-50");
      expect(
        popover!.querySelector("[title='pod.slot.mcpBusyTooltip']"),
      ).not.toBeNull();
    });

    // B5：Gemini popover 點擊 Switch 開：呼叫 updatePodMcpServers 並更新 podStore
    it("B5：點擊 Switch 開：呼叫 API 帶新 server 名稱，podStore 更新", async () => {
      mockListMcpServers.mockResolvedValue([GEMINI_MCP_SERVERS[0]]);
      setupPod([]);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover({ provider: "gemini" });
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await nextTick();

      expect(spy).toHaveBeenCalledWith("pod-1", ["gemini-stdio-server"]);

      await flushPromises();
      expect(mockUpdatePodMcpServersApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-1",
        ["gemini-stdio-server"],
      );
    });

    // B6：Gemini popover 點擊 Switch 關：呼叫 API 帶少掉該 server 的清單
    it("B6：點擊 Switch 關：呼叫 API 帶少掉該 server 的清單", async () => {
      mockListMcpServers.mockResolvedValue([GEMINI_MCP_SERVERS[0]]);
      setupPod(["gemini-stdio-server"]);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover({ provider: "gemini" });
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      // 目前應為 checked
      expect(switchBtn.getAttribute("data-checked")).toBe("true");

      switchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await nextTick();

      expect(spy).toHaveBeenCalledWith("pod-1", []);
    });

    // B7：Gemini popover 取消所有勾選後呼叫 API 帶 []，podStore 本地 list 為空
    it("B7：取消所有勾選後 API 帶 []，podStore 更新為空陣列", async () => {
      mockListMcpServers.mockResolvedValue([GEMINI_MCP_SERVERS[0]]);
      setupPod(["gemini-stdio-server"]);
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      mountPopover({ provider: "gemini" });
      await flushPromises();

      bodyQuery(".switch-stub")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushPromises();

      expect(spy).toHaveBeenCalledWith("pod-1", []);
      expect(mockUpdatePodMcpServersApi).toHaveBeenCalledWith(
        "canvas-1",
        "pod-1",
        [],
      );
    });
  });
});
