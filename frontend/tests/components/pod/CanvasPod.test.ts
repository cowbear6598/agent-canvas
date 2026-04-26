import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { ref, computed } from "vue";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import type { Pod } from "@/types";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

// 可在測試中動態調整的 mock 狀態
const mockSelectedPodIds = ref<string[]>([]);
const mockIsDragging = ref(false);
const mockIsBatchDragging = ref(false);

// 可在測試中查驗與控制的 spy 實例
const mockUpdatePodProviderConfigModel = vi.fn();
const mockSendCanvasAction = vi.fn();
const mockToast = vi.fn();

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
      "boundSkillNotes",
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
    template:
      "<div class='model-selector-stub' @click=\"$emit('update:model', 'sonnet')\"></div>",
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

// Mock composables
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
      // selectedPodIds 讀取 mockSelectedPodIds.value，讓各測試可動態調整（供測試直接檢查陣列用）
      get selectedPodIds() {
        return mockSelectedPodIds.value;
      },
      // isElementSelected 使用 mockSelectedPodIds 做 O(1) 查找（與 CanvasPod 實際邏輯一致）
      isElementSelected: (type: string, id: string) =>
        type === "pod" && mockSelectedPodIds.value.includes(id),
      toggleElement: vi.fn(),
    },
    skillStore: { getNotesByPodId: vi.fn().mockReturnValue([]) },
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
    sendCanvasAction: mockSendCanvasAction,
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

  it("isDragging=false & isBatchDragging=false：pod-wrapper 與 pod-doodle 不含 dragging class", () => {
    const pod = createMockPod();
    const wrapper = mountCanvasPod(pod);

    const podWithNotch = wrapper.find(".pod-wrapper");
    const podDoodle = wrapper.find(".pod-doodle");

    expect(podWithNotch.classes()).not.toContain("dragging");
    expect(podDoodle.classes()).not.toContain("dragging");

    wrapper.unmount();
  });

  it("isDragging=true：pod-wrapper 與 pod-doodle 含 dragging class", () => {
    // 更新 mockIsDragging，usePodDrag mock 的 getter 會讀取此值
    mockIsDragging.value = true;
    const pod = createMockPod();
    const wrapper = mountCanvasPod(pod);

    const podWithNotch = wrapper.find(".pod-wrapper");
    const podDoodle = wrapper.find(".pod-doodle");

    expect(podWithNotch.classes()).toContain("dragging");
    expect(podDoodle.classes()).toContain("dragging");

    wrapper.unmount();
  });

  it("isBatchDragging=true：pod-wrapper 與 pod-doodle 含 dragging class", () => {
    // 更新 mockIsBatchDragging，useBatchDrag mock 的 getter 會讀取此值
    mockIsBatchDragging.value = true;
    const pod = createMockPod();
    const wrapper = mountCanvasPod(pod);

    const podWithNotch = wrapper.find(".pod-wrapper");
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

// -----------------------------------------------------------------------
// Phase 6 A：未知 Provider fallback UI
// -----------------------------------------------------------------------

/**
 * 掛載 CanvasPod 並直接設定 providerCapabilityStore 狀態，
 * 用於測試未知 provider 的 fallback UI 行為。
 *
 * @param pod 測試用 Pod
 * @param storeState providerCapabilityStore 的初始狀態
 */
function mountCanvasPodWithStoreState(
  pod: Pod,
  storeState: {
    loaded: boolean;
    capabilitiesByProvider: Record<string, object>;
  },
) {
  const wrapper = mount(CanvasPod, {
    props: { pod },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: true })],
    },
    attachTo: document.body,
  });

  // 直接設定 store state，驅動 isUnknownProvider computed
  const store = useProviderCapabilityStore();
  store.loaded = storeState.loaded;
  // 以 unknown 轉型繞過嚴格泛型型別，測試環境不需完整 ProviderCapabilities 結構
  store.capabilitiesByProvider =
    storeState.capabilitiesByProvider as unknown as typeof store.capabilitiesByProvider;

  return wrapper;
}

describe("CanvasPod Phase 6A：未知 Provider fallback UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  it("store 已載入且 provider 未知時，顯示 unknown-provider-badge", async () => {
    const pod = createMockPod({ provider: "deprecated-provider" });
    const wrapper = mountCanvasPodWithStoreState(pod, {
      loaded: true,
      capabilitiesByProvider: {
        // 只含 claude、codex，不含 deprecated-provider
        claude: { chat: true },
        codex: { chat: true },
      },
    });

    // 等待 Vue 重新渲染（狀態更新後）
    await wrapper.vm.$nextTick();

    const badge = wrapper.find("[data-testid='unknown-provider-badge']");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("此 Provider 已下線或尚未支援");

    wrapper.unmount();
  });

  it("store 已載入且 provider 已知（claude）時，不顯示 unknown-provider-badge", async () => {
    const pod = createMockPod({ provider: "claude" });
    const wrapper = mountCanvasPodWithStoreState(pod, {
      loaded: true,
      capabilitiesByProvider: {
        claude: { chat: true },
        codex: { chat: true },
      },
    });

    await wrapper.vm.$nextTick();

    const badge = wrapper.find("[data-testid='unknown-provider-badge']");
    expect(badge.exists()).toBe(false);

    wrapper.unmount();
  });

  it("store 已載入且 provider 已知（codex）時，不顯示 unknown-provider-badge", async () => {
    const pod = createMockPod({ provider: "codex" });
    const wrapper = mountCanvasPodWithStoreState(pod, {
      loaded: true,
      capabilitiesByProvider: {
        claude: { chat: true },
        codex: { chat: true },
      },
    });

    await wrapper.vm.$nextTick();

    const badge = wrapper.find("[data-testid='unknown-provider-badge']");
    expect(badge.exists()).toBe(false);

    wrapper.unmount();
  });

  it("store 尚未載入（loaded=false）時，即使 provider 不存在也不顯示 fallback badge（避免時序誤判）", async () => {
    const pod = createMockPod({ provider: "unknown-provider" });
    const wrapper = mountCanvasPodWithStoreState(pod, {
      loaded: false,
      capabilitiesByProvider: {},
    });

    await wrapper.vm.$nextTick();

    const badge = wrapper.find("[data-testid='unknown-provider-badge']");
    // loaded=false → 不觸發 fallback，badge 不應出現
    expect(badge.exists()).toBe(false);

    wrapper.unmount();
  });

  it("未知 provider Pod 仍顯示 output 歷史（PodMiniScreen 存在）", async () => {
    const pod = createMockPod({
      provider: "deprecated-provider",
      output: ["上次的回覆內容"],
    });
    const wrapper = mountCanvasPodWithStoreState(pod, {
      loaded: true,
      capabilitiesByProvider: { claude: { chat: true } },
    });

    await wrapper.vm.$nextTick();

    // fallback badge 出現
    expect(
      wrapper.find("[data-testid='unknown-provider-badge']").exists(),
    ).toBe(true);
    // PodMiniScreen 仍然存在（output 歷史可見）
    expect(wrapper.find(".pod-mini-screen-stub").exists()).toBe(true);

    wrapper.unmount();
  });

  it("多 Pod rendering：未知 provider Pod 顯示 badge，正常 Pod 不受影響", async () => {
    // 正常 Pod（claude）
    const knownPod = createMockPod({ id: "pod-known", provider: "claude" });
    const wrapperKnown = mountCanvasPodWithStoreState(knownPod, {
      loaded: true,
      capabilitiesByProvider: { claude: { chat: true } },
    });
    await wrapperKnown.vm.$nextTick();
    expect(
      wrapperKnown.find("[data-testid='unknown-provider-badge']").exists(),
    ).toBe(false);

    // 未知 provider Pod
    const unknownPod = createMockPod({
      id: "pod-unknown",
      provider: "gone-provider",
    });
    const wrapperUnknown = mountCanvasPodWithStoreState(unknownPod, {
      loaded: true,
      capabilitiesByProvider: { claude: { chat: true } },
    });
    await wrapperUnknown.vm.$nextTick();
    expect(
      wrapperUnknown.find("[data-testid='unknown-provider-badge']").exists(),
    ).toBe(true);

    wrapperKnown.unmount();
    wrapperUnknown.unmount();
  });
});

// -----------------------------------------------------------------------
// 項目 35：handleModelChange / 未知 Provider 雙擊守門
// -----------------------------------------------------------------------

describe("CanvasPod Phase 35：handleModelChange 與未知 Provider 守門", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
  });

  it("isUnknownProvider=true 時雙擊應顯示 toast 並阻止進入對話", async () => {
    const pod = createMockPod({ provider: "deprecated-provider" });
    const wrapper = mountCanvasPodWithStoreState(pod, {
      loaded: true,
      capabilitiesByProvider: { claude: { chat: true } },
    });

    await wrapper.vm.$nextTick();

    // 雙擊 .pod-doodle 觸發 handleDblClick
    const podDoodle = wrapper.find(".pod-doodle");
    expect(podDoodle.exists()).toBe(true);
    await podDoodle.trigger("dblclick");

    // 應顯示 toast（通知 provider 不可用）
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("無法開啟對話"),
      }),
    );

    wrapper.unmount();
  });

  it("handleModelChange()：後端回傳成功應更新 providerConfig.model", async () => {
    // 模擬 sendCanvasAction 回傳含 pod 的成功回應
    mockSendCanvasAction.mockResolvedValueOnce({
      pod: { providerConfig: { model: "haiku" } },
    });

    const pod = createMockPod({ provider: "claude" });
    const wrapper = mountCanvasPod(pod);
    await wrapper.vm.$nextTick();

    // 點擊 model-selector-stub 觸發 update:model emit
    const selector = wrapper.find(".model-selector-stub");
    if (selector.exists()) {
      await selector.trigger("click");
    }

    // 等待非同步更新
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // updatePodProviderConfigModel 應被呼叫
    expect(mockUpdatePodProviderConfigModel).toHaveBeenCalledWith(
      "pod-1",
      "haiku",
    );

    wrapper.unmount();
  });

  it("handleModelChange()：後端回傳 null 應靜默無副作用", async () => {
    // 模擬 sendCanvasAction 回傳 null（失敗情境）
    mockSendCanvasAction.mockResolvedValueOnce(null);

    const pod = createMockPod({ provider: "claude" });
    const wrapper = mountCanvasPod(pod);
    await wrapper.vm.$nextTick();

    const selector = wrapper.find(".model-selector-stub");
    if (selector.exists()) {
      await selector.trigger("click");
    }

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // response 為 null → 不呼叫 updatePodProviderConfigModel
    expect(mockUpdatePodProviderConfigModel).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("handleModelChange()：response.pod 為 undefined 應靜默無副作用", async () => {
    // 模擬 sendCanvasAction 回傳不含 pod 的回應
    mockSendCanvasAction.mockResolvedValueOnce({ pod: undefined });

    const pod = createMockPod({ provider: "claude" });
    const wrapper = mountCanvasPod(pod);
    await wrapper.vm.$nextTick();

    const selector = wrapper.find(".model-selector-stub");
    if (selector.exists()) {
      await selector.trigger("click");
    }

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // response.pod 為 undefined → 不呼叫 updatePodProviderConfigModel
    expect(mockUpdatePodProviderConfigModel).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("podProviderClass：未知 provider 應回空字串（不注入任意 class）", () => {
    // 未知 provider 不應出現在 pod-doodle class 中
    const pod = createMockPod({ provider: "gone-provider" });
    const wrapper = mountCanvasPod(pod);

    const podDoodle = wrapper.find(".pod-doodle");
    expect(podDoodle.exists()).toBe(true);

    // 不應有 pod-provider-gone-provider 或其他 pod-provider-* class
    const podProviderClasses = podDoodle
      .classes()
      .filter((c) => c.startsWith("pod-provider-"));
    expect(podProviderClasses).toHaveLength(0);

    wrapper.unmount();
  });
});
