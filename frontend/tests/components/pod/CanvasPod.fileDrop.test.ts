/**
 * CanvasPod 拖曳上傳整合測試
 *
 * 涵蓋計畫書測試案例 8–10、13–15、18：
 * 8:  串行 Pod idle 拖入有效檔案 → 呼叫 chatStore.sendMessage 帶 attachments
 * 9:  multi-instance source pod 允許 drop，成功後呼叫 runStore.openHistoryPanel()
 * 10: 拖入時套用高亮 class，dragleave 後移除
 * 13: 串行 Pod chatting / summarizing 時 isFileDropDisabled = true
 * 14: 下游 multi-instance pod 時 isFileDropDisabled = true
 * 15: unknown provider 時 isFileDropDisabled = true
 * 18: generic 送出失敗（websocket emit 拋例外）→ toast podDropSendFailed
 *
 * 注意：案例 16/17（後端 pod:error 附件錯誤路徑）因測試環境無法重現完整
 *   WebSocket → chatStore 路徑，已移除（原先為空殼測試，無法驗證元件行為）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, nextTick } from "vue";
import type { PodChatAttachment } from "@/types/websocket/requests";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import {
  createUsePodScheduleMock,
  createUseWorkflowClearMock,
  createUsePodCapabilitiesMock,
  createUsePodAnchorDragMock,
  createUsePodNoteBindingMock,
  createMockPod,
  mountCanvasPod,
} from "./__setup__/canvasPodMocks";

// ---- 動態 mock 狀態 ----

const mockSelectedPodIds = ref<string[]>([]);
const mockIsDragging = ref(false);
const mockIsBatchDragging = ref(false);

// 可在各 test 中換掉的 mock 函式
const mockSendMessage = vi.fn();
const mockOpenHistoryPanel = vi.fn();
const mockToast = vi.fn();
const mockUpdatePodProviderConfigModel = vi.fn();
const mockSendCanvasAction = vi.fn();

// 控制 multi-instance 行為
const mockIsMultiInstanceSourcePod = vi.fn().mockReturnValue(false);
const mockIsMultiInstanceChainPod = vi.fn().mockReturnValue(false);

// ---- 子元件 Mock ----

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
      "pluginActiveCount",
      "mcpActiveCount",
      "provider",
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

vi.mock("@/components/pod/PluginPopover.vue", () => ({
  default: {
    name: "PluginPopover",
    template: "<div></div>",
    props: ["podId", "anchorRect", "busy", "provider"],
  },
}));

vi.mock("@/components/pod/McpPopover.vue", () => ({
  default: {
    name: "McpPopover",
    template: "<div></div>",
    props: ["podId", "anchorRect", "busy", "provider"],
  },
}));

// ---- Composable Mock ----

vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
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
    // chatStore mock：sendMessage 可被測試控制
    chatStore: {
      sendMessage: mockSendMessage,
    },
    canvasStore: {},
    integrationStore: {},
  }),
}));

vi.mock("@/stores/run/runStore", () => ({
  useRunStore: () => ({
    openHistoryPanel: mockOpenHistoryPanel,
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
  usePodNoteBinding: () => createUsePodNoteBindingMock(),
}));

vi.mock("@/composables/pod/useWorkflowClear", () => ({
  useWorkflowClear: () => createUseWorkflowClearMock(),
}));

vi.mock("@/composables/pod/usePodSchedule", () => ({
  usePodSchedule: () => createUsePodScheduleMock(),
}));

vi.mock("@/composables/pod/usePodAnchorDrag", () => ({
  usePodAnchorDrag: () => createUsePodAnchorDragMock(),
}));

vi.mock("@/composables/pod/usePodCapabilities", () => ({
  usePodCapabilities: () => createUsePodCapabilitiesMock(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/utils/multiInstanceGuard", () => ({
  isMultiInstanceChainPod: (...args: unknown[]) =>
    mockIsMultiInstanceChainPod(...args),
  isMultiInstanceSourcePod: (...args: unknown[]) =>
    mockIsMultiInstanceSourcePod(...args),
}));

vi.mock("@/services/websocket", () => ({
  WebSocketRequestEvents: { POD_SET_MODEL: "pod:set_model" },
  WebSocketResponseEvents: { POD_MODEL_SET: "pod:model_set" },
}));

// ---- 工具函式 ----
// createMockPod / mountCanvasPod 已由 __setup__/canvasPodMocks 提供，此處複用匯入版本

/**
 * 建構符合 FileList 介面的物件（jsdom 不支援直接建立 FileList）。
 */
function makeFileList(files: File[]): FileList {
  const fileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  };
  for (let i = 0; i < files.length; i++) {
    (fileList as Record<string | number, unknown>)[i] = files[i];
  }
  return fileList as unknown as FileList;
}

/**
 * 建構含 files/items 的 DataTransfer mock 物件（注入至 DragEvent）。
 */
function makeDataTransfer(files: File[]): DataTransfer {
  const items = files.map(() => ({
    webkitGetAsEntry: vi.fn().mockReturnValue({ isDirectory: false }),
  }));
  return {
    files: makeFileList(files),
    items: {
      length: items.length,
      [Symbol.iterator]: function* () {
        for (const item of items) yield item;
      },
    },
    dropEffect: "copy",
  } as unknown as DataTransfer;
}

/**
 * 建立合法 DragEvent，帶有指定的 File 陣列。
 * 使用 Object.defineProperty 注入 dataTransfer，避免 jsdom 限制。
 */
function createDropEvent(files: File[]): DragEvent {
  const event = new Event("drop", {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: makeDataTransfer(files),
    writable: true,
    configurable: true,
  });

  return event;
}

/**
 * 建立 dragenter 用的 DragEvent。
 */
function createDragEnterEvent(): DragEvent {
  return new Event("dragenter", {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
}

/**
 * 建立 dragleave 用的 DragEvent，可指定 currentTarget 與 relatedTarget。
 */
function createDragLeaveEvent(options: {
  currentTarget: HTMLElement;
  relatedTarget: Node | null;
}): DragEvent {
  const event = new Event("dragleave", {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, "currentTarget", {
    value: options.currentTarget,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(event, "relatedTarget", {
    value: options.relatedTarget,
    writable: true,
    configurable: true,
  });
  return event;
}

/**
 * 替換全域 FileReader 為成功讀取模式。
 */
function mockFileReaderSuccess(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).FileReader = class MockFileReader {
    onload: ((e: ProgressEvent) => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(file: File): void {
      queueMicrotask(() => {
        const fakeBase64 = `data:${file.type};base64,ZmFrZWJhc2U2NA==`;
        this.onload?.({
          target: { result: fakeBase64 },
        } as unknown as ProgressEvent);
      });
    }
  };
}

/**
 * 等待所有 Promise microtask 完成（用於 FileReader 非同步模擬）。
 */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

/**
 * 設定 providerCapabilityStore 使 claude 為已知 provider。
 */
function setKnownProvider(
  store: ReturnType<typeof useProviderCapabilityStore>,
): void {
  store.loaded = true;
  store.capabilitiesByProvider = {
    claude: { chat: true },
  } as unknown as typeof store.capabilitiesByProvider;
}

// ---- 測試 ----

describe("CanvasPod 拖曳上傳整合", () => {
  // 保存原始 FileReader，避免直接屬性賦值汙染後續測試環境
  // vi.restoreAllMocks() 無法還原此類替換，需手動還原
  let originalFileReader: typeof window.FileReader;

  beforeEach(() => {
    originalFileReader = (window as any).FileReader;
    vi.clearAllMocks();
    mockSelectedPodIds.value = [];
    mockIsDragging.value = false;
    mockIsBatchDragging.value = false;
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
    mockIsMultiInstanceChainPod.mockReturnValue(false);
    mockSendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // 明確還原全域 FileReader，確保不汙染後續測試
    (window as any).FileReader = originalFileReader;
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 案例 8：串行 Pod idle 拖入有效檔案 → 呼叫 chatStore.sendMessage 帶 attachments
  // -----------------------------------------------------------------------
  it("案例 8：idle 串行 Pod 拖入有效檔案，chatStore.sendMessage 應帶入 attachments", async () => {
    mockFileReaderSuccess();

    const pod = createMockPod({ id: "pod-1", status: "idle" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "test.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);

    // 使用 dispatchEvent 直接觸發，避免 vue-test-utils trigger 的 isTrusted 問題
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    expect(mockSendMessage).toHaveBeenCalledWith(
      "pod-1",
      "",
      undefined,
      expect.arrayContaining([
        expect.objectContaining<Partial<PodChatAttachment>>({
          filename: "test.txt",
        }),
      ]),
    );

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 9：multi-instance source pod 即使有 run 在跑也允許 drop
  //         成功送出後呼叫 runStore.openHistoryPanel()
  // -----------------------------------------------------------------------
  it("案例 9：multi-instance source pod 拖入成功，應呼叫 openHistoryPanel", async () => {
    mockFileReaderSuccess();

    // multiInstance=true，isMultiInstanceSourcePod 回 true
    mockIsMultiInstanceSourcePod.mockReturnValue(true);
    // isMultiInstanceChainPod 回 false，表示不是純下游 pod
    mockIsMultiInstanceChainPod.mockReturnValue(false);

    const pod = createMockPod({
      id: "pod-source",
      status: "idle",
      multiInstance: true,
    });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "data.bin", {
        type: "application/octet-stream",
      }),
    ];
    const dropEvent = createDropEvent(files);

    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    // sendMessage 應被呼叫
    expect(mockSendMessage).toHaveBeenCalled();
    // 成功送出後應開啟 history panel
    expect(mockOpenHistoryPanel).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 10：拖入時套用高亮 class，dragleave 後移除
  // -----------------------------------------------------------------------
  it("案例 10：dragenter 時 pod-glow-layer 套用高亮，dragleave 後移除", async () => {
    const pod = createMockPod({ id: "pod-1", status: "idle" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    // dragenter → isDragOver 應為 true → pod-glow-drop-target 套用
    const dragEnterEvent = createDragEnterEvent();
    wrapper.element.dispatchEvent(dragEnterEvent);
    await nextTick();

    // pod-glow-drop-target 已移至 pod-inner-highlight（跟著 Pod 旋轉），非 pod-glow-layer
    const glowLayer = wrapper.find(".pod-inner-highlight");
    expect(glowLayer.classes()).toContain("pod-glow-drop-target");

    // dragleave 模擬完全離開容器（relatedTarget 在容器外）
    const rootEl = wrapper.element as HTMLElement;
    const outsideEl = document.createElement("span");
    // outsideEl 不在 rootEl 內，contains() 回傳 false
    const leaveEvent = createDragLeaveEvent({
      currentTarget: rootEl,
      relatedTarget: outsideEl,
    });
    rootEl.dispatchEvent(leaveEvent);
    await nextTick();

    // pod-glow-drop-target 應移除
    expect(glowLayer.classes()).not.toContain("pod-glow-drop-target");

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 13：串行 Pod chatting / summarizing 時 isFileDropDisabled = true
  // -----------------------------------------------------------------------
  it("案例 13a：pod status=chatting 時 drop 應被 disabled 忽略", async () => {
    mockFileReaderSuccess();

    const pod = createMockPod({ id: "pod-1", status: "chatting" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "test.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    // disabled 狀態下 sendMessage 不應被呼叫
    expect(mockSendMessage).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it("案例 13b：pod status=summarizing 時 drop 應被 disabled 忽略", async () => {
    mockFileReaderSuccess();

    const pod = createMockPod({ id: "pod-1", status: "summarizing" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "test.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    expect(mockSendMessage).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 14：下游 multi-instance pod 時 isFileDropDisabled = true
  // -----------------------------------------------------------------------
  it("案例 14：下游 multi-instance pod drop 應被 disabled 忽略", async () => {
    mockFileReaderSuccess();

    // 是 chain pod，且不是 source pod → 下游
    mockIsMultiInstanceChainPod.mockReturnValue(true);
    mockIsMultiInstanceSourcePod.mockReturnValue(false);

    const pod = createMockPod({ id: "pod-downstream", status: "idle" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "test.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    expect(mockSendMessage).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 15：unknown provider 時 isFileDropDisabled = true
  // -----------------------------------------------------------------------
  it("案例 15：未知 provider Pod drop 應被 disabled 忽略", async () => {
    mockFileReaderSuccess();

    const pod = createMockPod({
      id: "pod-unknown",
      provider: "deprecated-provider" as unknown as "claude",
      status: "idle",
    });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    // store 已載入，但 provider 不在已知清單 → isUnknownProvider = true
    const store = useProviderCapabilityStore();
    store.loaded = true;
    store.capabilitiesByProvider = {
      claude: { chat: true },
      // 不含 deprecated-provider
    } as unknown as typeof store.capabilitiesByProvider;
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "test.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    expect(mockSendMessage).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 33：providerCapabilityStore.loaded === false 時 drop 不被擋
  //         loaded=false 代表能力清單尚未載入，isUnknownProvider 應為 false，
  //         drop 不應被 isFileDropDisabled 攔截
  // -----------------------------------------------------------------------
  it("案例 33：providerCapabilityStore.loaded=false 時，drop 應正常送出", async () => {
    mockFileReaderSuccess();

    const pod = createMockPod({ id: "pod-1", status: "idle" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    // 明確設定 loaded=false（尚未載入能力清單）
    const store = useProviderCapabilityStore();
    store.loaded = false;
    store.capabilitiesByProvider = {} as typeof store.capabilitiesByProvider;
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "test.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    // loaded=false 時不視為 unknown provider，drop 應通過，sendMessage 被呼叫
    expect(mockSendMessage).toHaveBeenCalled();

    wrapper.unmount();
  });

  // -----------------------------------------------------------------------
  // 案例 18：generic 送出失敗（websocket emit 拋例外）→ usePodFileDrop catch
  //          → toast composable.chat.podDropSendFailed
  //
  // 觸發路徑：sendMessage 拋例外 → usePodFileDrop.handleDrop() catch →
  //   toast({ title: t("composable.chat.podDropSendFailed") })
  //
  // 此路徑與 case 16/17 不同：
  //   - 16/17：後端 pod:error push → chatStore.handleError → 具體附件錯誤訊息
  //   - 18：前端 onDrop callback 拋例外 → usePodFileDrop catch → 通用送出失敗訊息
  // -----------------------------------------------------------------------
  it("案例 18：sendMessage 拋出一般例外，usePodFileDrop catch 顯示 podDropSendFailed toast", async () => {
    mockFileReaderSuccess();

    mockSendMessage.mockRejectedValueOnce(new Error("WebSocket 尚未連線"));

    const pod = createMockPod({ id: "pod-1", status: "idle" });
    const wrapper = mountCanvasPod(pod);
    await nextTick();

    const store = useProviderCapabilityStore();
    setKnownProvider(store);
    await nextTick();

    const files = [
      new File([new Uint8Array(100)], "file.txt", { type: "text/plain" }),
    ];
    const dropEvent = createDropEvent(files);
    wrapper.element.dispatchEvent(dropEvent);
    await flushAsync();

    // usePodFileDrop 的 try/catch 包住 onDrop 例外，顯示 podDropSendFailed
    // zh-TW 翻譯：composable.chat.podDropSendFailed
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );

    wrapper.unmount();
  });
});
