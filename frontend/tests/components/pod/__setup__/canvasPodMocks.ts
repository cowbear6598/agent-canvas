/**
 * CanvasPod 測試共用 mock 工廠與狀態
 *
 * 使用方式：
 *   import { createCanvasContextMock, createUsePodScheduleMock, ... } from "./__setup__/canvasPodMocks";
 *
 * 注意：vi.mock() 必須在各測試檔案頂層呼叫（vitest 會 hoist），
 *   本檔案只提供工廠函式供 vi.mock 的 factory callback 呼叫，
 *   共用 spy 實例由各測試檔案透過 makeSharedSpies() 建立後傳入。
 */
import { ref, computed } from "vue";
import { vi } from "vitest";
import type { Pod } from "@/types";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import CanvasPod from "@/components/pod/CanvasPod.vue";

// ---- 共用 mock 工廠 ----

/** 建立 useCanvasContext mock 回傳值（各 test 可傳入 spies 覆蓋）*/
export function createCanvasContextMock(spies: {
  mockUpdatePodProviderConfigModel?: ReturnType<typeof vi.fn>;
  mockSelectedPodIds?: { value: string[] };
  mockSendMessage?: ReturnType<typeof vi.fn>;
}) {
  const {
    mockUpdatePodProviderConfigModel = vi.fn(),
    mockSelectedPodIds = ref<string[]>([]),
    mockSendMessage = vi.fn(),
  } = spies;

  return {
    podStore: {
      activePodId: null,
      setActivePod: vi.fn(),
      updatePodProviderConfigModel: mockUpdatePodProviderConfigModel,
      setMultiInstanceWithBackend: vi.fn(),
      updatePodStatus: vi.fn(),
    },
    viewportStore: { zoom: 1 },
    selectionStore: {
      get selectedPodIds() {
        return mockSelectedPodIds.value;
      },
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
    chatStore: {
      sendMessage: mockSendMessage,
    },
    canvasStore: {},
    integrationStore: {},
  };
}

/** 建立 usePodSchedule mock 回傳值 */
export function createUsePodScheduleMock() {
  return {
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
  };
}

/** 建立 useWorkflowClear mock 回傳值 */
export function createUseWorkflowClearMock() {
  return {
    showClearDialog: ref(false),
    downstreamPods: ref([]),
    isLoadingDownstream: ref(false),
    isClearing: ref(false),
    handleClearWorkflow: vi.fn(),
    handleConfirmClear: vi.fn(),
    handleCancelClear: vi.fn(),
  };
}

/** 建立 usePodCapabilities mock 回傳值 */
export function createUsePodCapabilitiesMock() {
  return {
    capabilities: computed(() => ({})),
    isCodex: computed(() => false),
    isPluginEnabled: computed(() => false),
    isRepositoryEnabled: computed(() => false),
    isCommandEnabled: computed(() => false),
    isMcpEnabled: computed(() => false),
    isIntegrationEnabled: computed(() => false),
  };
}

/** 建立 usePodAnchorDrag mock 回傳值 */
export function createUsePodAnchorDragMock() {
  return {
    handleAnchorDragStart: vi.fn(),
    handleAnchorDragMove: vi.fn(),
    handleAnchorDragEnd: vi.fn(),
  };
}

/** 建立 usePodNoteBinding mock 回傳值 */
export function createUsePodNoteBindingMock() {
  return {
    handleNoteDrop: vi.fn(),
    handleNoteRemove: vi.fn(),
  };
}

/**
 * useI18n mock：t = (key) => key，讓測試斷言以 key 為依據，
 * 不依賴具體翻譯字串，避免翻譯變更導致測試脆弱。
 */
export function createUseI18nMock() {
  return {
    t: (key: string) => key,
    locale: ref("zh-TW"),
  };
}

// ---- 共用 Pod 工廠 ----

/** 建立測試用 Pod 資料 */
export function createMockPod(overrides: Partial<Pod> = {}): Pod {
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
    ...overrides,
  };
}

/** 掛載 CanvasPod 的共用函式 */
export function mountCanvasPod(pod: Pod) {
  return mount(CanvasPod, {
    props: { pod },
    global: {
      plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: true })],
    },
    attachTo: document.body,
  });
}
