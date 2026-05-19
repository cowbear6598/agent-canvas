import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setupStoreTest } from "../../helpers/testSetup";
import {
  resetMockWebSocket,
  webSocketMockFactory,
} from "../../helpers/mockWebSocket";
import { usePodStore } from "@/stores/pod";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mockListPodMcpAvailability = vi.fn();
vi.mock("@/services/managedMcpApi", () => ({
  listPodMcpAvailability: (...args: unknown[]) =>
    mockListPodMcpAvailability(...args),
}));

const mockUpdatePodMcpServersApi = vi.fn();
vi.mock("@/services/mcpApi", () => ({
  updatePodMcpServers: (...args: unknown[]) =>
    mockUpdatePodMcpServersApi(...args),
}));

const mockGetActiveCanvasIdOrWarn = vi.fn().mockReturnValue("canvas-1");
vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: (...args: unknown[]) =>
    mockGetActiveCanvasIdOrWarn(...args),
}));

const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

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
import type { PodMcpAvailabilityItem } from "@/types/mcp";
import type { Pod, PodProvider } from "@/types/pod";

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
  provider: "claude" as PodProvider,
};

const GOAL = {
  todos: [{ id: "goal-1", text: "Ship it" }],
};

const GOAL_RUNTIME_ITEM: PodMcpAvailabilityItem = {
  name: "agent_canvas_goal",
  transport: "stdio",
  status: "running",
  system: true,
  locked: true,
  selected: true,
  selectable: false,
  disabledReason: null,
  activeTodoId: "goal-1",
  activeTodoText: "Ship it",
  completedTodoIds: [],
  completedCount: 0,
  totalCount: 1,
};

const EMPTY_GOAL_RUNTIME_ITEM: PodMcpAvailabilityItem = {
  name: "agent_canvas_goal",
  transport: "stdio",
  status: "completed",
  system: true,
  locked: true,
  selected: true,
  selectable: false,
  disabledReason: null,
  activeTodoId: null,
  activeTodoText: null,
  completedTodoIds: [],
  completedCount: 0,
  totalCount: 0,
};

const MOCK_MCP_SERVER: PodMcpAvailabilityItem = {
  name: "test-mcp-server",
  transport: "stdio",
  status: "healthy",
  selected: false,
  selectable: true,
  disabledReason: null,
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

function bodyQueryAll(selector: string): Element[] {
  return Array.from(document.body.querySelectorAll(selector));
}

function setupPod({
  mcpServerNames = [],
  goal = null,
  provider = "claude",
}: {
  mcpServerNames?: string[];
  goal?: Pod["goal"];
  provider?: PodProvider;
} = {}) {
  const podStore = usePodStore();
  podStore.pods = [
    {
      id: "pod-1",
      name: "Pod 1",
      x: 0,
      y: 0,
      rotation: 0,
      repositoryId: null,
      schedule: null,
      mcpServerNames,
      pluginIds: [],
      goal,
      provider,
      providerConfig: { model: "opus" },
    },
  ];
}

describe("McpPopover", () => {
  setupStoreTest(() => {
    mockListPodMcpAvailability.mockReset();
    mockUpdatePodMcpServersApi.mockReset();
    mockGetActiveCanvasIdOrWarn.mockReset();
    mockToast.mockReset();
    mockListPodMcpAvailability.mockResolvedValue([]);
    mockUpdatePodMcpServersApi.mockResolvedValue(undefined);
    mockGetActiveCanvasIdOrWarn.mockReturnValue("canvas-1");
    setupPod();
  });

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount();
    wrappers = [];
    resetMockWebSocket();
  });

  it("掛載後應呼叫 listPodMcpAvailability 帶 claude 參數，並顯示 server name 與 Switch", async () => {
    mockListPodMcpAvailability.mockResolvedValue([MOCK_MCP_SERVER]);

    mountPopover({ provider: "claude" });
    await flushPromises();

    expect(mockListPodMcpAvailability).toHaveBeenCalledWith("pod-1", "claude");
    expect(bodyQuery(".fixed.z-50")!.textContent).toContain("test-mcp-server");
    expect(bodyQuery(".switch-stub")).not.toBeNull();
  });

  it("有 Goal 時應顯示 Goal Runtime 與 user MCP，但只保留 user MCP 的 Switch", async () => {
    setupPod({ goal: GOAL });
    mockListPodMcpAvailability.mockResolvedValue([
      GOAL_RUNTIME_ITEM,
      MOCK_MCP_SERVER,
    ]);

    mountPopover({ provider: "claude" });
    await flushPromises();

    const popover = bodyQuery(".fixed.z-50");
    expect(popover!.textContent).toContain("pod.slot.goalMcpLabel");
    expect(popover!.textContent).toContain("pod.slot.builtinBadge");
    expect(popover!.textContent).toContain("test-mcp-server");
    expect(document.body.querySelectorAll(".switch-stub")).toHaveLength(1);
    // 內建與使用者 MCP 同時存在時應出現 divider
    expect(bodyQuery('[data-testid="mcp-group-divider"]')).not.toBeNull();
    // status chip 已從 popover 移除（不再以 probe 結果作為 toggle 旁的訊號）
    expect(bodyQuery('[data-testid="mcp-status-badge"]')).toBeNull();
  });

  it("只有使用者 MCP 時不應顯示 divider", async () => {
    mockListPodMcpAvailability.mockResolvedValue([MOCK_MCP_SERVER]);

    mountPopover({ provider: "claude" });
    await flushPromises();

    expect(bodyQuery(".fixed.z-50")!.textContent).toContain("test-mcp-server");
    expect(bodyQuery('[data-testid="mcp-group-divider"]')).toBeNull();
  });

  describe("toggle MCP server", () => {
    it("點 Toggle 立即更新 podStore.updatePodMcpServers（樂觀更新），並呼叫 API", async () => {
      mockListPodMcpAvailability.mockResolvedValue([MOCK_MCP_SERVER]);
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
      mockListPodMcpAvailability.mockResolvedValue([
        { ...MOCK_MCP_SERVER, selected: true },
      ]);
      setupPod({ mcpServerNames: ["test-mcp-server"] });
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

  describe("availability row", () => {
    it("availability row 顯示 selected 與 disabledReason", async () => {
      const disabledRow: PodMcpAvailabilityItem = {
        name: "remote-docs",
        transport: "sse",
        status: "starting",
        selected: true,
        selectable: false,
        disabledReason: "provider mismatch",
      };
      setupPod({ mcpServerNames: ["remote-docs"] });
      mockListPodMcpAvailability.mockResolvedValue([disabledRow]);

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      expect(switchBtn.getAttribute("data-checked")).toBe("true");
      expect(switchBtn.hasAttribute("disabled")).toBe(true);
      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "provider mismatch",
      );
      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "managedMcp.transport.sse",
      );
      // status chip 已移除：popover 不該再渲染 status 文字
      expect(bodyQuery('[data-testid="mcp-status-badge"]')).toBeNull();
    });

    it("全域 registry 改動後重新開啟 popover 會看到新狀態", async () => {
      mockListPodMcpAvailability
        .mockResolvedValueOnce([MOCK_MCP_SERVER])
        .mockResolvedValueOnce([
          {
            ...MOCK_MCP_SERVER,
            status: "starting",
            disabledReason: "registry updated",
            selectable: false,
          },
        ]);

      const firstWrapper = mountPopover();
      await flushPromises();
      // 第一次開啟：healthy MCP 可勾選、Switch 啟用
      const firstSwitch = bodyQuery(".switch-stub") as HTMLElement;
      expect(firstSwitch.hasAttribute("disabled")).toBe(false);

      firstWrapper.unmount();
      wrappers = wrappers.filter((wrapper) => wrapper !== firstWrapper);

      mountPopover();
      await flushPromises();

      // 第二次開啟：registry 已更新，selectable=false → Switch 變 disabled、顯示 reason
      const secondSwitch = bodyQuery(".switch-stub") as HTMLElement;
      expect(secondSwitch.hasAttribute("disabled")).toBe(true);
      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "registry updated",
      );
    });

    it("無效 name 不再被當成可切換 user MCP", async () => {
      const staleRow: PodMcpAvailabilityItem = {
        name: "ghost-server",
        transport: "stdio",
        status: "error",
        selected: true,
        selectable: false,
        disabledReason: "registry entry removed",
        lastError: "registry entry removed",
      };
      setupPod({ mcpServerNames: ["ghost-server"] });
      mockListPodMcpAvailability.mockResolvedValue([staleRow]);

      mountPopover();
      await flushPromises();

      const switchBtn = bodyQuery(".switch-stub") as HTMLElement;
      expect(switchBtn.getAttribute("data-checked")).toBe("true");
      expect(switchBtn.hasAttribute("disabled")).toBe(true);

      switchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();

      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "registry entry removed",
      );
      expect(mockUpdatePodMcpServersApi).not.toHaveBeenCalled();
    });
  });

  describe("空狀態", () => {
    it("只有 Goal Runtime 時只顯示內建列，不再出現 user empty 提示文案與 divider", async () => {
      mockListPodMcpAvailability.mockResolvedValue([EMPTY_GOAL_RUNTIME_ITEM]);

      mountPopover({ provider: "claude" });
      await flushPromises();

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("pod.slot.goalMcpLabel");
      expect(popover!.textContent).toContain("pod.slot.builtinBadge");
      expect(popover!.textContent).not.toContain("pod.slot.mcpUserEmpty");
      expect(popover!.textContent).not.toContain("pod.slot.mcpManagedHint");
      expect(bodyQuery('[data-testid="mcp-group-divider"]')).toBeNull();
      expect(bodyQuery(".switch-stub")).toBeNull();
    });
  });

  it("Codex 改用 managed availability，只有不支援的 transport 會 disabled", async () => {
    setupPod({ provider: "codex" });
    mockListPodMcpAvailability.mockResolvedValue([
      GOAL_RUNTIME_ITEM,
      {
        name: "docs-http",
        transport: "http",
        status: "healthy",
        selected: false,
        selectable: true,
        disabledReason: null,
      },
      {
        name: "docs-sse",
        transport: "sse",
        status: "starting",
        selected: false,
        selectable: false,
        disabledReason: "codex does not support sse transport",
      },
    ]);
    const podStore = usePodStore();
    const spy = vi.spyOn(podStore, "updatePodMcpServers");

    mountPopover({ provider: "codex" });
    await flushPromises();

    const switches = bodyQueryAll(".switch-stub") as HTMLElement[];
    expect(switches).toHaveLength(2);
    expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
      "codex does not support sse transport",
    );
    expect(switches[1]?.hasAttribute("disabled")).toBe(true);

    switches[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();

    expect(spy).toHaveBeenCalledWith("pod-1", ["docs-http"]);
  });

  it("listPodMcpAvailability 失敗時顯示 mcpLoadFailed，不顯示 Switch", async () => {
    mockListPodMcpAvailability.mockRejectedValue(new Error("Network error"));

    mountPopover({ provider: "claude" });
    await flushPromises();

    expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
      "pod.slot.mcpLoadFailed",
    );
    expect(bodyQuery(".switch-stub")).toBeNull();
  });

  it("canvasId 取不到時 toggle 不呼叫 store 也不呼叫 API", async () => {
    mockListPodMcpAvailability.mockResolvedValue([MOCK_MCP_SERVER]);
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

  describe("toggle 失敗後回滾", () => {
    it("API 失敗時 podStore 回滾到空陣列，toast description fallback 到 i18n key", async () => {
      mockListPodMcpAvailability.mockResolvedValue([MOCK_MCP_SERVER]);
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
  });

  describe("搜尋功能", () => {
    const SERVERS: PodMcpAvailabilityItem[] = [
      { name: "github", transport: "stdio", selectable: true },
      { name: "gitlab", transport: "stdio", selectable: true },
      { name: "slack", transport: "http", selectable: true },
    ];

    async function setInputValue(input: HTMLInputElement, value: string) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await nextTick();
    }

    it("輸入搜尋字串後列表只顯示符合的 server", async () => {
      mockListPodMcpAvailability.mockResolvedValue(SERVERS);

      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "git");

      const popover = bodyQuery(".fixed.z-50");
      expect(popover!.textContent).toContain("github");
      expect(popover!.textContent).toContain("gitlab");
      expect(popover!.textContent).not.toContain("slack");
    });

    it("搜尋無結果時顯示 pod.slot.mcpSearchEmpty", async () => {
      mockListPodMcpAvailability.mockResolvedValue(SERVERS);

      mountPopover({ provider: "claude" });
      await flushPromises();

      const input = bodyQuery(".pod-popover-search") as HTMLInputElement;
      await setInputValue(input, "xxx");

      expect(bodyQuery(".fixed.z-50")!.textContent).toContain(
        "pod.slot.mcpSearchEmpty",
      );
    });
  });

  it("點擊 popover 外部應 emit close", async () => {
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
