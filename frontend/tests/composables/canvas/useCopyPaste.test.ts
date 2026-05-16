import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import {
  createMockPod,
  createMockNote,
  createMockConnection,
} from "../../helpers/factories";
import { useCopyPaste } from "@/composables/canvas/useCopyPaste";
import { usePodStore, useViewportStore, useSelectionStore } from "@/stores/pod";
import { useRepositoryStore } from "@/stores/note";
import { useConnectionStore } from "@/stores/connectionStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type {
  SelectableElement,
  CanvasPasteResultPayload,
  RepositoryNote,
} from "@/types";
import type { CopiedConnection } from "@/types/clipboard";

const {
  mockShowSuccessToast,
  mockShowErrorToast,
  mockIsEditingElement,
  mockHasTextSelection,
  mockIsModifierKeyPressed,
  mockWrapWebSocketRequest,
} = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
  mockIsEditingElement: vi.fn(() => false),
  mockHasTextSelection: vi.fn(() => false),
  mockIsModifierKeyPressed: vi.fn(() => true),
  mockWrapWebSocketRequest: vi.fn(),
}));

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

vi.mock("@/utils/domHelpers", () => ({
  isEditingElement: mockIsEditingElement,
  hasTextSelection: mockHasTextSelection,
  isModifierKeyPressed: mockIsModifierKeyPressed,
  getPlatformModifierKey: () => "ctrlKey" as const,
}));

vi.mock("@/composables/useWebSocketErrorHandler", () => ({
  useWebSocketErrorHandler: () => ({
    wrapWebSocketRequest: mockWrapWebSocketRequest,
  }),
}));

vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    podStore: usePodStore(),
    viewportStore: useViewportStore(),
    selectionStore: useSelectionStore(),
    repositoryStore: useRepositoryStore(),
    connectionStore: useConnectionStore(),
    clipboardStore: useClipboardStore(),
    canvasStore: useCanvasStore(),
  }),
}));

const TestComponent = defineComponent({
  setup() {
    useCopyPaste();
    return () => h("div");
  },
});

describe("useCopyPaste", () => {
  let wrapper: ReturnType<typeof mount>;
  let podStore: ReturnType<typeof usePodStore>;
  let viewportStore: ReturnType<typeof useViewportStore>;
  let selectionStore: ReturnType<typeof useSelectionStore>;
  let repositoryStore: ReturnType<typeof useRepositoryStore>;
  let connectionStore: ReturnType<typeof useConnectionStore>;
  let clipboardStore: ReturnType<typeof useClipboardStore>;
  let canvasStore: ReturnType<typeof useCanvasStore>;

  setupStoreTest(() => {
    mockIsEditingElement.mockReturnValue(false);
    mockHasTextSelection.mockReturnValue(false);
    mockIsModifierKeyPressed.mockReturnValue(true);
  });

  beforeEach(() => {
    podStore = usePodStore();
    viewportStore = useViewportStore();
    selectionStore = useSelectionStore();
    repositoryStore = useRepositoryStore();
    connectionStore = useConnectionStore();
    clipboardStore = useClipboardStore();
    canvasStore = useCanvasStore();

    canvasStore.activeCanvasId = "canvas-1";
    (viewportStore as any).screenToCanvas = vi.fn(
      (screenX: number, screenY: number) => ({
        x: screenX,
        y: screenY,
      }),
    );

    wrapper = mount(TestComponent);
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("複製選中 pod 與 connection", () => {
    const pod1 = createMockPod({ id: "pod-1", x: 100, y: 100 });
    const pod2 = createMockPod({ id: "pod-2", x: 200, y: 200 });
    const conn = createMockConnection({
      id: "conn-1",
      sourcePodId: "pod-1",
      targetPodId: "pod-2",
    });
    podStore.pods = [pod1, pod2];
    connectionStore.connections = [conn];
    selectionStore.selectedElements = [
      { type: "pod", id: "pod-1" },
      { type: "pod", id: "pod-2" },
    ] as SelectableElement[];

    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });
    document.dispatchEvent(event);

    const copiedData = clipboardStore.getCopiedData();
    expect(copiedData.pods).toHaveLength(2);
    expect(copiedData.connections).toEqual([
      expect.objectContaining({
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
      }),
    ]);
  });

  it("複製選中 pod 時會一起收集綁定與未綁定 repository note", () => {
    const pod = createMockPod({ id: "pod-1" });
    const boundNote = createMockNote("repository", {
      id: "note-1",
      boundToPodId: "pod-1",
      x: 10,
      y: 10,
    }) as RepositoryNote;
    const unboundNote = createMockNote("repository", {
      id: "note-2",
      boundToPodId: null,
      x: 100,
      y: 120,
    }) as RepositoryNote;
    podStore.pods = [pod];
    repositoryStore.notes = [boundNote, unboundNote] as any[];
    selectionStore.selectedElements = [
      { type: "pod", id: "pod-1" },
      { type: "repositoryNote", id: "note-2" },
    ];

    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });
    document.dispatchEvent(event);

    const copiedData = clipboardStore.getCopiedData();
    expect(copiedData.repositoryNotes).toHaveLength(2);
    expect(copiedData.repositoryNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ repositoryId: boundNote.repositoryId }),
        expect.objectContaining({ repositoryId: unboundNote.repositoryId }),
      ]),
    );
  });

  it("copy 時 setCopy 只帶 pods/repositoryNotes/connections 三段資料", () => {
    const pod = createMockPod({ id: "pod-1" });
    podStore.pods = [pod];
    selectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];
    const setCopySpy = vi.spyOn(clipboardStore, "setCopy");

    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });
    document.dispatchEvent(event);

    expect(setCopySpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("貼上時只送出 pods/repositoryNotes/connections payload", async () => {
    const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
    clipboardStore.setCopy([pod], [], []);
    mockWrapWebSocketRequest.mockResolvedValue({
      createdPods: [],
      createdRepositoryNotes: [],
      createdConnections: [],
      podIdMapping: {},
      errors: [],
      success: true,
      requestId: "req-1",
    } satisfies CanvasPasteResultPayload);

    const event = new KeyboardEvent("keydown", { key: "v", ctrlKey: true });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });
    document.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockCreateWebSocketRequest).toHaveBeenCalledWith({
      requestEvent: WebSocketRequestEvents.CANVAS_PASTE,
      responseEvent: WebSocketResponseEvents.CANVAS_PASTE_RESULT,
      payload: expect.objectContaining({
        canvasId: "canvas-1",
        pods: expect.any(Array),
        repositoryNotes: expect.any(Array),
        connections: expect.any(Array),
      }),
      timeout: 10000,
    });
  });

  it("貼上成功後選中新建立的 pod 與未綁定 repository note", async () => {
    const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
    clipboardStore.setCopy([pod], [], []);
    mockWrapWebSocketRequest.mockResolvedValue({
      requestId: "",
      success: true,
      podIdMapping: {},
      errors: [],
      createdPods: [{ ...pod, id: "new-pod-1" }],
      createdRepositoryNotes: [
        {
          id: "new-note-1",
          repositoryId: "repo-1",
          name: "Repo 1",
          x: 0,
          y: 0,
          boundToPodId: null,
          originalPosition: null,
        },
      ],
      createdConnections: [],
    } satisfies CanvasPasteResultPayload);

    const setSelectedElementsSpy = vi.spyOn(
      selectionStore,
      "setSelectedElements",
    );

    const event = new KeyboardEvent("keydown", { key: "v", ctrlKey: true });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });
    document.dispatchEvent(event);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setSelectedElementsSpy).toHaveBeenCalledWith([
      { type: "pod", id: "new-pod-1" },
      { type: "repositoryNote", id: "new-note-1" },
    ]);
  });

  it("clipboard 為空時不貼上", async () => {
    clipboardStore.clear();

    const event = new KeyboardEvent("keydown", { key: "v", ctrlKey: true });
    document.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWrapWebSocketRequest).not.toHaveBeenCalled();
  });

  it("有文字選取時不觸發 copy", () => {
    mockHasTextSelection.mockReturnValue(true);
    const setCopySpy = vi.spyOn(clipboardStore, "setCopy");

    const pod = createMockPod({ id: "pod-1" });
    podStore.pods = [pod];
    selectionStore.selectedElements = [{ type: "pod", id: "pod-1" }];

    const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true });
    document.dispatchEvent(event);

    expect(setCopySpy).not.toHaveBeenCalled();
  });

  it("非 modifier 鍵時不觸發貼上", async () => {
    mockIsModifierKeyPressed.mockReturnValue(false);
    const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
    clipboardStore.setCopy([pod], [], []);

    const event = new KeyboardEvent("keydown", { key: "v" });
    document.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWrapWebSocketRequest).not.toHaveBeenCalled();
  });

  it("保留 copied connection 的 provider-independent 結構", () => {
    const copiedConnection: CopiedConnection = {
      sourcePodId: "pod-1",
      sourceAnchor: "bottom",
      targetPodId: "pod-2",
      targetAnchor: "top",
    };

    clipboardStore.setCopy([], [], [copiedConnection]);

    expect(clipboardStore.getCopiedData().connections).toEqual([
      copiedConnection,
    ]);
  });
});
