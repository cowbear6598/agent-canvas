import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { ref, computed } from "vue";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import type { Pod } from "@/types";

// 可在測試中動態調整的 mock 狀態
const mockSelectedPodIds = ref<string[]>([]);
const mockIsDragging = ref(false);
const mockIsBatchDragging = ref(false);

// Mock 子元件，避免各子元件自行引入複雜依賴
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

vi.mock("@/components/pod/PodSlots.vue", () => ({
  default: {
    name: "PodSlots",
    template: "<div></div>",
    props: [
      "podId",
      "podRotation",
      "boundOutputStyleNote",
      "boundSkillNotes",
      "boundSubAgentNotes",
      "boundRepositoryNote",
      "boundCommandNote",
      "boundMcpServerNotes",
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
      "isRunModeEnabled",
    ],
  },
}));

vi.mock("@/components/pod/PodModelSelector.vue", () => ({
  default: {
    name: "PodModelSelector",
    template: "<div></div>",
    props: ["podId", "provider", "currentModel"],
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

// Mock composables
vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    podStore: {
      activePodId: null,
      setActivePod: vi.fn(),
      updatePodProviderConfigModel: vi.fn(),
      setMultiInstanceWithBackend: vi.fn(),
    },
    viewportStore: {},
    selectionStore: {
      // selectedPodIds 讀取 mockSelectedPodIds.value，讓各測試可動態調整（供測試直接檢查陣列用）
      get selectedPodIds() {
        return mockSelectedPodIds.value;
      },
      // isElementSelected 使用 mockSelectedPodIds 做 O(1) 查找（與 CanvasPod 實際邏輯一致）
      isElementSelected: (type: string, id: string) =>
        type === "pod" && mockSelectedPodIds.value.includes(id),
      toggleElement: vi.fn(),
    },
    outputStyleStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    skillStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    subAgentStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    repositoryStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    commandStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
    mcpServerStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
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
    // isBatchDragging 讀取 mockIsBatchDragging，讓各測試可動態調整
    get isBatchDragging() {
      return mockIsBatchDragging;
    },
  }),
}));

vi.mock("@/composables/useSendCanvasAction", () => ({
  useSendCanvasAction: () => ({
    sendCanvasAction: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/usePodDrag", () => ({
  usePodDrag: () => ({
    // isDragging 讀取 mockIsDragging，讓各測試可動態調整
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
    isRunModeEnabled: computed(() => false),
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
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

function createMockPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Test Pod",
    x: 0,
    y: 0,
    output: [],
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "claude-sonnet-4-5" },
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

// -----------------------------------------------------------------------
// 項目 13：podStatusClass 白名單驗證
// -----------------------------------------------------------------------

describe("CanvasPod podStatusClass 白名單驗證", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  const statusCases: Array<{
    status: string | undefined;
    expectedClass: string | null;
  }> = [
    { status: "chatting", expectedClass: "pod-status-chatting" },
    { status: "summarizing", expectedClass: "pod-status-summarizing" },
    { status: "error", expectedClass: "pod-status-error" },
    { status: "idle", expectedClass: "pod-status-idle" },
    { status: undefined, expectedClass: null },
  ];

  it.each(statusCases)(
    'pod.status === "$status"：.pod-glow-layer class 驗證',
    ({ status, expectedClass }) => {
      const pod = createMockPod({ status: status as any });
      const wrapper = mountCanvasPod(pod);

      const glowLayer = wrapper.find(".pod-glow-layer");
      expect(glowLayer.exists()).toBe(true);

      if (expectedClass) {
        expect(glowLayer.classes()).toContain(expectedClass);
      } else {
        // status 為 undefined：不應含任何 pod-status-* class
        expect(
          glowLayer.classes().some((c) => c.startsWith("pod-status-")),
        ).toBe(false);
      }

      wrapper.unmount();
    },
  );

  it("未知 status 值應 fallback 為不套用任何 pod-status-* class", () => {
    // 型別斷言模擬外部傳入未知 status
    const pod = createMockPod({ status: "unknown-status" as any });
    const wrapper = mountCanvasPod(pod);

    const glowLayer = wrapper.find(".pod-glow-layer");
    expect(glowLayer.exists()).toBe(true);
    expect(glowLayer.classes().some((c) => c.startsWith("pod-status-"))).toBe(
      false,
    );

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 項目 14：pod-glow-selected 選取狀態
// -----------------------------------------------------------------------

describe("CanvasPod pod-glow-selected class 選取狀態", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  it("selectedPodIds 不含 pod.id 時，.pod-glow-layer 不含 pod-glow-selected", () => {
    mockSelectedPodIds.value = [];
    const pod = createMockPod({ id: "pod-1" });
    const wrapper = mountCanvasPod(pod);

    const glowLayer = wrapper.find(".pod-glow-layer");
    expect(glowLayer.exists()).toBe(true);
    expect(glowLayer.classes()).not.toContain("pod-glow-selected");

    wrapper.unmount();
  });

  it("selectedPodIds 包含 pod.id 時，.pod-glow-layer 含 pod-glow-selected", () => {
    const pod = createMockPod({ id: "pod-selected" });
    // 設定 mockSelectedPodIds 讓 useCanvasContext mock 的 getter 回傳含 pod.id 的陣列
    mockSelectedPodIds.value = ["pod-selected"];
    const wrapper = mountCanvasPod(pod);

    const glowLayer = wrapper.find(".pod-glow-layer");
    expect(glowLayer.exists()).toBe(true);
    expect(glowLayer.classes()).toContain("pod-glow-selected");

    wrapper.unmount();
  });
});

// -----------------------------------------------------------------------
// 項目 15：dragging class 拖曳狀態
// -----------------------------------------------------------------------

describe("CanvasPod dragging class 拖曳狀態", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  it("isDragging=false & isBatchDragging=false：pod-with-notch 與 pod-doodle 不含 dragging class", () => {
    const pod = createMockPod();
    const wrapper = mountCanvasPod(pod);

    const podWithNotch = wrapper.find(".pod-with-notch");
    const podDoodle = wrapper.find(".pod-doodle");

    expect(podWithNotch.classes()).not.toContain("dragging");
    expect(podDoodle.classes()).not.toContain("dragging");

    wrapper.unmount();
  });

  it("isDragging=true：pod-with-notch 與 pod-doodle 含 dragging class", () => {
    // 更新 mockIsDragging，usePodDrag mock 的 getter 會讀取此值
    mockIsDragging.value = true;
    const pod = createMockPod();
    const wrapper = mountCanvasPod(pod);

    const podWithNotch = wrapper.find(".pod-with-notch");
    const podDoodle = wrapper.find(".pod-doodle");

    expect(podWithNotch.classes()).toContain("dragging");
    expect(podDoodle.classes()).toContain("dragging");

    wrapper.unmount();
  });

  it("isBatchDragging=true：pod-with-notch 與 pod-doodle 含 dragging class", () => {
    // 更新 mockIsBatchDragging，useBatchDrag mock 的 getter 會讀取此值
    mockIsBatchDragging.value = true;
    const pod = createMockPod();
    const wrapper = mountCanvasPod(pod);

    const podWithNotch = wrapper.find(".pod-with-notch");
    const podDoodle = wrapper.find(".pod-doodle");

    expect(podWithNotch.classes()).toContain("dragging");
    expect(podDoodle.classes()).toContain("dragging");

    wrapper.unmount();
  });
});

describe("CanvasPod Provider Pod 漸層 class 綁定", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  it('當 pod.provider === "claude" 時，.pod-doodle 元素套用 pod-provider-claude class，不含 pod-provider-codex', () => {
    const pod = createMockPod({ provider: "claude" });
    const wrapper = mountCanvasPod(pod);

    const podDoodle = wrapper.find(".pod-doodle");
    expect(podDoodle.exists()).toBe(true);
    expect(podDoodle.classes()).toContain("pod-provider-claude");
    expect(podDoodle.classes()).not.toContain("pod-provider-codex");

    wrapper.unmount();
  });

  it('當 pod.provider === "codex" 時，.pod-doodle 元素套用 pod-provider-codex class，不含 pod-provider-claude', () => {
    const pod = createMockPod({ provider: "codex" });
    const wrapper = mountCanvasPod(pod);

    const podDoodle = wrapper.find(".pod-doodle");
    expect(podDoodle.exists()).toBe(true);
    expect(podDoodle.classes()).toContain("pod-provider-codex");
    expect(podDoodle.classes()).not.toContain("pod-provider-claude");

    wrapper.unmount();
  });

  it("Mini screen stub 區塊不含 pod-provider-* class", () => {
    const pod = createMockPod({ provider: "claude" });
    const wrapper = mountCanvasPod(pod);

    const miniScreen = wrapper.find(".pod-mini-screen-stub");
    expect(miniScreen.exists()).toBe(true);
    expect(miniScreen.classes()).not.toContain("pod-provider-claude");
    expect(miniScreen.classes()).not.toContain("pod-provider-codex");

    wrapper.unmount();
  });
});
