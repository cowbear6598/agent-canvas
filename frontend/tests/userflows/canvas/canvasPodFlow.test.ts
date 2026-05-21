import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, type PropType } from "vue";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import { mockErrorSanitizerFactory } from "@tests/helpers/testSetup";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import { createMockPod } from "@tests/helpers/factories";
import CanvasContainer from "@/components/canvas/CanvasContainer.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore, useSelectionStore, useViewportStore } from "@/stores/pod";
import {
  registerUnifiedListeners,
  unregisterUnifiedListeners,
} from "@/composables/useUnifiedEventListeners";
import type { Pod, PodTypeConfig } from "@/types";
import type { PodProvider, ProviderConfig } from "@/types/pod";

vi.mock("@/services/websocket", () => webSocketMockFactory());
vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  createWebSocketRequest: (...args: unknown[]) =>
    mockCreateWebSocketRequest(...args),
  tryResolvePendingRequest: () => false,
}));

const { mockShowSuccessToast, mockShowErrorToast, mockToast } = vi.hoisted(
  () => ({
    mockShowSuccessToast: vi.fn(),
    mockShowErrorToast: vi.fn(),
    mockToast: vi.fn(),
  }),
);

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

vi.mock("@/utils/errorSanitizer", () => mockErrorSanitizerFactory());

const CanvasViewportStub = defineComponent({
  name: "CanvasViewport",
  emits: ["contextmenu", "click"],
  setup(_props, { emit, slots }) {
    return () =>
      h(
        "div",
        {
          class: "test-viewport viewport",
          onContextmenu: (event: MouseEvent) => emit("contextmenu", event),
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.(),
      );
  },
});

const PodTypeMenuStub = defineComponent({
  name: "PodTypeMenu",
  props: {
    position: {
      type: Object as PropType<{ x: number; y: number }>,
      required: true,
    },
  },
  emits: ["select", "close"],
  setup(_props, { emit }) {
    const createClaudePod = () => {
      emit(
        "select",
        {} satisfies Partial<PodTypeConfig>,
        "claude" satisfies PodProvider,
        { model: "opus" } satisfies ProviderConfig,
      );
    };

    return () =>
      h(
        "button",
        {
          class: "test-create-pod",
          type: "button",
          onClick: createClaudePod,
        },
        "Create Claude Pod",
      );
  },
});

const CanvasPodStub = defineComponent({
  name: "CanvasPod",
  props: {
    pod: {
      type: Object as PropType<Pod>,
      required: true,
    },
  },
  emits: ["select", "drag-end", "drag-complete", "update"],
  setup(props, { emit }) {
    const stopAndRun = (event: MouseEvent, action: () => void): void => {
      event.stopPropagation();
      action();
    };

    return () =>
      h("article", { class: "test-pod", "data-pod-id": props.pod.id }, [
        h(
          "button",
          {
            class: "test-select-pod",
            type: "button",
            onClick: (event: MouseEvent) =>
              stopAndRun(event, () => emit("select", props.pod.id)),
          },
          props.pod.name,
        ),
        h(
          "button",
          {
            class: "test-drag-pod",
            type: "button",
            onClick: (event: MouseEvent) =>
              stopAndRun(event, () =>
                emit("drag-end", { id: props.pod.id, x: 380, y: 420 }),
              ),
          },
          "Move",
        ),
        h(
          "button",
          {
            class: "test-sync-pod",
            type: "button",
            onClick: (event: MouseEvent) =>
              stopAndRun(event, () =>
                emit("drag-complete", { id: props.pod.id }),
              ),
          },
          "Sync",
        ),
        h(
          "button",
          {
            class: "test-rename-pod",
            type: "button",
            onClick: (event: MouseEvent) =>
              stopAndRun(event, () =>
                emit("update", { ...props.pod, name: "Renamed Pod" }),
              ),
          },
          "Rename",
        ),
      ]);
  },
});

async function mountCanvasPodUserFlow() {
  const app = await mountUserFlowApp({
    component: CanvasContainer,
    attachTo: document.body,
    global: {
      stubs: {
        CanvasViewport: CanvasViewportStub,
        CanvasPod: CanvasPodStub,
        PodTypeMenu: PodTypeMenuStub,
        RemoteCursorLayer: true,
        ConnectionLayer: true,
        SelectionBox: true,
        GenericNote: true,
        EmptyState: true,
        ProgressNote: true,
        TrashZone: true,
        PodContextMenu: true,
        RepositoryContextMenu: true,
        ConnectionContextMenu: true,
        CreateRepositoryModal: true,
        CloneRepositoryModal: true,
        ConfirmDeleteModal: true,
        BranchEditModal: true,
        IntegrationConnectModal: true,
      },
    },
  });

  const canvasStore = useCanvasStore();
  const podStore = usePodStore();
  const selectionStore = useSelectionStore();
  const viewportStore = useViewportStore();
  canvasStore.activeCanvasId = "canvas-flow";
  viewportStore.setOffset(0, 0);
  viewportStore.zoom = 1;

  return { ...app, canvasStore, podStore, selectionStore, viewportStore };
}

async function flushUserFlowPromises() {
  await Promise.resolve();
  await nextTick();
}

describe("canvas pod userflow", () => {
  beforeEach(() => {
    unregisterUnifiedListeners();
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  it("creates a pod from the canvas menu, receives the backend event, selects it, moves it, and syncs the store position", async () => {
    const { wrapper, unmount, podStore, selectionStore } =
      await mountCanvasPodUserFlow();
    registerUnifiedListeners();

    const createdPod = createMockPod({
      id: "pod-created",
      name: "Pod 1",
      x: 148,
      y: 170,
      rotation: 0,
      provider: "claude",
      providerConfig: { model: "opus" },
    });
    mockCreateWebSocketRequest.mockResolvedValueOnce({
      requestId: "req-create-pod",
      success: true,
      pod: createdPod,
    });

    await wrapper.find(".test-viewport").trigger("contextmenu", {
      clientX: 260,
      clientY: 220,
      button: 2,
    });
    expect(podStore.typeMenu.visible).toBe(true);

    await wrapper.find(".test-create-pod").trigger("click");
    await flushUserFlowPromises();
    expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestEvent: "pod:create",
        responseEvent: "pod:created",
        payload: expect.objectContaining({
          canvasId: "canvas-flow",
          name: "Pod 1",
          x: 148,
          y: 170,
          provider: "claude",
          providerConfig: { model: "opus" },
        }),
      }),
    );
    expect(podStore.typeMenu.visible).toBe(false);

    simulateEvent("pod:created", {
      requestId: "req-create-pod",
      canvasId: "canvas-flow",
      pod: createdPod,
    });
    await nextTick();

    expect(podStore.pods).toHaveLength(1);
    expect(podStore.getPodById("pod-created")).toMatchObject({
      name: "Pod 1",
      x: 148,
      y: 170,
      providerConfig: { model: "opus" },
    });

    await wrapper.find(".test-select-pod").trigger("click");
    expect(podStore.selectedPodId).toBe("pod-created");
    expect(podStore.selectedPod?.name).toBe("Pod 1");

    selectionStore.setSelectedElements([{ type: "pod", id: "pod-created" }]);
    await wrapper.find(".test-drag-pod").trigger("click");
    expect(podStore.getPodById("pod-created")).toMatchObject({
      x: 380,
      y: 420,
    });
    expect(selectionStore.selectedPodIds).toEqual(["pod-created"]);

    await wrapper.find(".test-sync-pod").trigger("click");
    expect(mockWebSocketClient.emit).toHaveBeenCalledWith("pod:move", {
      requestId: expect.any(String),
      canvasId: "canvas-flow",
      podId: "pod-created",
      x: 380,
      y: 420,
    });

    unmount();
    unregisterUnifiedListeners();
  });
});
