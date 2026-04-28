/**
 * CanvasPod MCP 整合測試
 * 覆蓋 popover 開關 + props 傳遞
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { ref, computed } from "vue";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import type { Pod } from "@/types";

// ── 可動態調整的 mock 狀態 ───────────────────────────────────────────────
const mockSelectedPodIds = ref<string[]>([]);
const mockIsDragging = ref(false);
const mockIsBatchDragging = ref(false);

// ── spy 實例 ──────────────────────────────────────────────────────────────
const mockUpdatePodProviderConfigModel = vi.fn();
const mockSendCanvasAction = vi.fn();
const mockToast = vi.fn();

// ── McpPopover stub ────────────────────────────────────────────────────────
vi.mock("@/components/pod/McpPopover.vue", () => ({
  default: {
    name: "McpPopover",
    template:
      "<div class='mcp-popover-stub' :data-pod-id='podId' :data-busy='busy' :data-provider='provider' @click=\"$emit('close')\"></div>",
    props: ["podId", "anchorRect", "busy", "provider"],
    emits: ["close"],
  },
}));

// ── PluginPopover stub ─────────────────────────────────────────────────────
vi.mock("@/components/pod/PluginPopover.vue", () => ({
  default: {
    name: "PluginPopover",
    template:
      "<div class='plugin-popover-stub' @click=\"$emit('close')\"></div>",
    props: ["podId", "anchorRect", "busy", "provider"],
    emits: ["close"],
  },
}));

// ── 子元件 stubs ──────────────────────────────────────────────────────────
vi.mock("@/components/pod/PodHeader.vue", () => ({
  default: {
    name: "PodHeader",
    template: "<div class='pod-header-stub'></div>",
    props: ["name", "isEditing"],
  },
}));

vi.mock("@/components/pod/PodMiniScreen.vue", () => ({
  default: {
    name: "PodMiniScreen",
    template: "<div class='pod-mini-screen-stub'></div>",
    props: ["output"],
  },
}));

// PodSlots stub：加上 emit mcp-clicked 供測試觸發
vi.mock("@/components/pod/PodSlots.vue", () => ({
  default: {
    name: "PodSlots",
    // data-testid 讓測試可直接 trigger mcp-clicked
    template:
      "<div class='pod-slots-stub' data-testid='pod-slots' @click.self=\"$emit('mcp-clicked', $event)\"><button class='mcp-trigger' @click=\"$emit('mcp-clicked', $event)\"></button><button class='plugin-trigger' @click=\"$emit('plugin-clicked', $event)\"></button></div>",
    props: [
      "podId",
      "podRotation",
      "pluginActiveCount",
      "mcpActiveCount",
      "provider",
      "boundRepositoryNote",
      "boundCommandNote",
    ],
    emits: [
      "mcp-clicked",
      "plugin-clicked",
      "repository-dropped",
      "repository-removed",
      "command-dropped",
      "command-removed",
    ],
  },
}));

vi.mock("@/components/pod/PodAnchors.vue", () => ({
  default: {
    name: "PodAnchors",
    template: "<div></div>",
    props: ["podId"],
  },
}));

vi.mock("@/components/pod/PodActions.vue", () => ({
  default: {
    name: "PodActions",
    template: "<div></div>",
    props: [
      "podId",
      "podName",
      "isSourcePod",
      "showScheduleButton",
      "isMultiInstanceEnabled",
      "isLoadingDownstream",
      "isClearing",
      "downstreamPods",
      "showClearDialog",
      "showDeleteDialog",
      "hasSchedule",
      "scheduleEnabled",
      "scheduleTooltip",
      "isScheduleFiredAnimating",
      "isWorkflowRunning",
    ],
  },
}));

vi.mock("@/components/pod/PodModelSelector.vue", () => ({
  default: {
    name: "PodModelSelector",
    template: "<div class='model-selector-stub'></div>",
    props: ["podId", "provider", "currentModel"],
    emits: ["update:model"],
  },
}));

vi.mock("@/components/integration/IntegrationStatusIcon.vue", () => ({
  default: {
    name: "IntegrationStatusIcon",
    template: "<div></div>",
    props: ["bindings"],
  },
}));

vi.mock("@/components/canvas/ScheduleModal.vue", () => ({
  default: {
    name: "ScheduleModal",
    template: "<div></div>",
    props: ["open", "podId", "existingSchedule"],
  },
}));

// ── composables mocks ─────────────────────────────────────────────────────
vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    podStore: {
      activePodId: null,
      setActivePod: vi.fn(),
      updatePodProviderConfigModel: mockUpdatePodProviderConfigModel,
      setMultiInstanceWithBackend: vi.fn(),
    },
    viewportStore: {},
    selectionStore: {
      get selectedPodIds() {
        return mockSelectedPodIds.value;
      },
      isElementSelected: (type: string, id: string) =>
        type === "pod" && mockSelectedPodIds.value.includes(id),
      toggleElement: vi.fn(),
    },
    repositoryStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    commandStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    connectionStore: {
      isSourcePod: vi.fn().mockReturnValue(false),
      hasUpstreamConnections: vi.fn().mockReturnValue(false),
      isWorkflowRunning: vi.fn().mockReturnValue(false),
      selectConnection: vi.fn(),
    },
    clipboardStore: {},
    chatStore: {},
    canvasStore: {},
    integrationStore: {},
  }),
}));

vi.mock("@/composables/canvas", () => ({
  useBatchDrag: () => ({
    startBatchDrag: vi.fn().mockReturnValue(false),
    isElementSelected: vi.fn().mockReturnValue(false),
    get isBatchDragging() {
      return mockIsBatchDragging;
    },
  }),
}));

vi.mock("@/composables/useSendCanvasAction", () => ({
  useSendCanvasAction: () => ({
    sendCanvasAction: mockSendCanvasAction,
  }),
}));

vi.mock("@/composables/pod/usePodDrag", () => ({
  usePodDrag: () => ({
    get isDragging() {
      return mockIsDragging;
    },
    startSingleDrag: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/usePodNoteBinding", () => ({
  usePodNoteBinding: () => ({
    handleNoteDrop: vi.fn(),
    handleNoteRemove: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/useWorkflowClear", () => ({
  useWorkflowClear: () => ({
    showClearDialog: ref(false),
    downstreamPods: ref([]),
    isLoadingDownstream: ref(false),
    isClearing: ref(false),
    handleClearWorkflow: vi.fn(),
    handleConfirmClear: vi.fn(),
    handleCancelClear: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/usePodSchedule", () => ({
  usePodSchedule: () => ({
    showScheduleModal: ref(false),
    hasSchedule: computed(() => false),
    scheduleEnabled: computed(() => false),
    scheduleTooltip: computed(() => ""),
    isScheduleFiredAnimating: ref(false),
    handleOpenScheduleModal: vi.fn(),
    handleScheduleConfirm: vi.fn(),
    handleScheduleDelete: vi.fn(),
    handleScheduleToggle: vi.fn(),
    handleClearScheduleFiredAnimation: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/usePodAnchorDrag", () => ({
  usePodAnchorDrag: () => ({
    handleAnchorDragStart: vi.fn(),
    handleAnchorDragMove: vi.fn(),
    handleAnchorDragEnd: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/usePodCapabilities", () => ({
  usePodCapabilities: () => ({
    capabilities: computed(() => ({})),
    isCodex: computed(() => false),
    isPluginEnabled: computed(() => false),
    isRepositoryEnabled: computed(() => false),
    isCommandEnabled: computed(() => false),
    isMcpEnabled: computed(() => false),
    isIntegrationEnabled: computed(() => false),
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/utils/multiInstanceGuard", () => ({
  isMultiInstanceChainPod: vi.fn().mockReturnValue(false),
  isMultiInstanceSourcePod: vi.fn().mockReturnValue(false),
}));

vi.mock("@/services/websocket", () => ({
  WebSocketRequestEvents: { POD_SET_MODEL: "pod:set_model" },
  WebSocketResponseEvents: { POD_MODEL_SET: "pod:model_set" },
}));

// ── 輔助函式 ──────────────────────────────────────────────────────────────

function createMockPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Test Pod",
    x: 0,
    y: 0,
    output: [],
    rotation: 0,
    multiInstance: false,
    provider: "claude",
    providerConfig: { model: "claude-sonnet-4-5" },
    mcpServerNames: [],
    pluginIds: [],
    ...overrides,
  };
}

function mountCanvasPod(pod: Pod) {
  return mount(CanvasPod, {
    props: { pod },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: true })],
    },
    attachTo: document.body,
  });
}

// ── 測試 ──────────────────────────────────────────────────────────────────

describe("CanvasPod MCP popover 整合測試", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  // ── popover 開關 ─────────────────────────────────────────────────────────

  describe("popover 開關", () => {
    it("初始狀態：McpPopover 不應渲染", () => {
      const pod = createMockPod();
      const wrapper = mountCanvasPod(pod);

      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(false);

      wrapper.unmount();
    });

    it("PodSlots emit mcp-clicked 後：McpPopover 應渲染", async () => {
      const pod = createMockPod();
      const wrapper = mountCanvasPod(pod);

      // 觸發 mcp-clicked（模擬點擊 MCP notch）
      const mcpTrigger = wrapper.find(".mcp-trigger");
      expect(mcpTrigger.exists()).toBe(true);
      await mcpTrigger.trigger("click");

      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);

      wrapper.unmount();
    });

    it("McpPopover emit close 後：popover 應消失", async () => {
      const pod = createMockPod();
      const wrapper = mountCanvasPod(pod);

      // 開啟 popover
      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");
      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);

      // 點擊 stub 觸發 close emit
      const popoverStub = wrapper.find(".mcp-popover-stub");
      await popoverStub.trigger("click");

      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(false);

      wrapper.unmount();
    });
  });

  // ── props 傳遞 ───────────────────────────────────────────────────────────

  describe("props 傳遞", () => {
    it("McpPopover 應接收正確的 podId", async () => {
      const pod = createMockPod({ id: "pod-mcp-test" });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");

      const popoverStub = wrapper.find(".mcp-popover-stub");
      expect(popoverStub.exists()).toBe(true);
      expect(popoverStub.attributes("data-pod-id")).toBe("pod-mcp-test");

      wrapper.unmount();
    });

    it("Claude pod：McpPopover provider 應為 claude", async () => {
      const pod = createMockPod({ provider: "claude" });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");

      const popoverStub = wrapper.find(".mcp-popover-stub");
      expect(popoverStub.attributes("data-provider")).toBe("claude");

      wrapper.unmount();
    });

    it("Codex pod：McpPopover provider 應為 codex", async () => {
      const pod = createMockPod({
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");

      const popoverStub = wrapper.find(".mcp-popover-stub");
      expect(popoverStub.attributes("data-provider")).toBe("codex");

      wrapper.unmount();
    });

    it("Pod idle 狀態：McpPopover busy 應為 false", async () => {
      const pod = createMockPod({ status: "idle" as any });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");

      const popoverStub = wrapper.find(".mcp-popover-stub");
      // busy=false 時 data-busy 為 "false"
      expect(popoverStub.attributes("data-busy")).toBe("false");

      wrapper.unmount();
    });

    it("Pod chatting 狀態：McpPopover busy 應為 true", async () => {
      const pod = createMockPod({ status: "chatting" as any });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");

      const popoverStub = wrapper.find(".mcp-popover-stub");
      expect(popoverStub.attributes("data-busy")).toBe("true");

      wrapper.unmount();
    });

    it("Pod summarizing 狀態：McpPopover busy 應為 true", async () => {
      const pod = createMockPod({ status: "summarizing" as any });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");

      const popoverStub = wrapper.find(".mcp-popover-stub");
      expect(popoverStub.attributes("data-busy")).toBe("true");

      wrapper.unmount();
    });
  });

  // ── plugin popover 不互相干擾 ────────────────────────────────────────────

  describe("MCP popover 與 Plugin popover 不互相干擾", () => {
    it("開啟 MCP popover 時，Plugin popover 不應渲染", async () => {
      const pod = createMockPod();
      const wrapper = mountCanvasPod(pod);

      await wrapper.find(".mcp-trigger").trigger("click");

      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);
      expect(wrapper.find(".plugin-popover-stub").exists()).toBe(false);

      wrapper.unmount();
    });

    it("開啟 Plugin popover 時，MCP popover 不應渲染", async () => {
      const pod = createMockPod();
      const wrapper = mountCanvasPod(pod);

      await wrapper.find(".plugin-trigger").trigger("click");

      expect(wrapper.find(".plugin-popover-stub").exists()).toBe(true);
      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(false);

      wrapper.unmount();
    });
  });

  // ── provider 切換後 popover 行為 ─────────────────────────────────────────

  describe("provider 切換後 popover 行為", () => {
    it("開啟 MCP popover 後，pod.provider 改為 codex，popover 仍保持開著但 data-provider 更新為 codex", async () => {
      // 初始為 claude pod，開啟 popover
      const pod = createMockPod({ provider: "claude" });
      const wrapper = mountCanvasPod(pod);

      const mcpTrigger = wrapper.find(".mcp-trigger");
      await mcpTrigger.trigger("click");
      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);

      // 更新 props（模擬 provider 從 claude 切換到 codex）
      await wrapper.setProps({ pod: createMockPod({ provider: "codex" }) });
      await wrapper.vm.$nextTick();

      // 實作沒有自動關閉邏輯，popover 仍開著
      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);
      // provider prop 已更新為 codex（唯讀模式）
      expect(
        wrapper.find(".mcp-popover-stub").attributes("data-provider"),
      ).toBe("codex");

      wrapper.unmount();
    });
  });

  // ── mcp-trigger 連按兩次 toggle 行為 ─────────────────────────────────────

  describe("mcp-trigger 連按兩次 toggle 行為", () => {
    it("第二次點擊 mcp-trigger 會關閉 popover（toggle 行為）", async () => {
      const pod = createMockPod();
      const wrapper = mountCanvasPod(pod);

      // 第一次點擊：開啟
      await wrapper.find(".mcp-trigger").trigger("click");
      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);

      // 第二次點擊：toggle close，popover 應關閉
      await wrapper.find(".mcp-trigger").trigger("click");
      expect(wrapper.find(".mcp-popover-stub").exists()).toBe(false);

      wrapper.unmount();
    });
  });

  // ── PodSlots mcpActiveCount 傳遞 ─────────────────────────────────────────

  describe("PodSlots mcpActiveCount 傳遞", () => {
    it("pod.mcpServerNames 有 2 個時，PodSlots 應收到 mcpActiveCount=2", () => {
      const pod = createMockPod({
        mcpServerNames: ["server-a", "server-b"],
      });
      const wrapper = mountCanvasPod(pod);

      const podSlots = wrapper.find(".pod-slots-stub");
      expect(podSlots.exists()).toBe(true);

      // PodSlots stub 不傳 data attr，改透過 vue wrapper 取 props
      // 找到 PodSlots component wrapper
      const slotsWrapper = wrapper.findComponent({ name: "PodSlots" });
      expect(slotsWrapper.exists()).toBe(true);
      expect(slotsWrapper.props("mcpActiveCount")).toBe(2);

      wrapper.unmount();
    });

    it.each([
      { mcpServerNames: [] as string[] | undefined },
      { mcpServerNames: undefined },
    ])(
      "pod.mcpServerNames 為空或 undefined 時，PodSlots 應收到 mcpActiveCount=0",
      ({ mcpServerNames }) => {
        const pod = createMockPod({ mcpServerNames });
        const wrapper = mountCanvasPod(pod);

        const slotsWrapper = wrapper.findComponent({ name: "PodSlots" });
        expect(slotsWrapper.exists()).toBe(true);
        expect(slotsWrapper.props("mcpActiveCount")).toBe(0);

        wrapper.unmount();
      },
    );
  });
});
