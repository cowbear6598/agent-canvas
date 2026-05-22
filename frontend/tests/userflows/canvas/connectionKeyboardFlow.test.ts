import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
  resetMockWebSocket,
} from "@tests/helpers/mockWebSocket";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import { createMockConnection, createMockPod } from "@tests/helpers/factories";
import CanvasContainer from "@/components/canvas/CanvasContainer.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { usePodStore } from "@/stores/pod/podStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

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

function pressKey(key: "Delete" | "Backspace"): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function mountConnectionKeyboardFlow() {
  const app = await mountUserFlowApp({
    component: CanvasContainer,
    attachTo: document.body,
    global: {
      stubs: {
        CanvasViewport: CanvasViewportStub,
        CanvasPod: true,
        PodTypeMenu: true,
        RemoteCursorLayer: true,
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
  const connectionStore = useConnectionStore();
  canvasStore.activeCanvasId = "canvas-keyboard-flow";
  podStore.pods = [
    createMockPod({ id: "pod-source", x: 100, y: 100 }),
    createMockPod({ id: "pod-target", x: 360, y: 100 }),
  ];
  connectionStore.connections = [
    createMockConnection({
      id: "conn-keyboard",
      sourcePodId: "pod-source",
      targetPodId: "pod-target",
    }),
  ];
  await nextTick();

  return { ...app, connectionStore };
}

describe("connection keyboard userflow", () => {
  beforeEach(() => {
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  it("selects a connection line and deletes it with Delete", async () => {
    const { wrapper, unmount, connectionStore } =
      await mountConnectionKeyboardFlow();
    await wrapper.find(".connection-line").trigger("click");
    mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

    pressKey("Delete");

    expect(connectionStore.selectedConnectionId).toBe("conn-keyboard");
    expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestEvent: "connection:delete",
        payload: expect.objectContaining({ connectionId: "conn-keyboard" }),
      }),
    );
    unmount();
  });

  it("keeps a selected connection when Backspace is used while editing text", async () => {
    const { wrapper, unmount, connectionStore } =
      await mountConnectionKeyboardFlow();
    await wrapper.find(".connection-line").trigger("click");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressKey("Backspace");

    expect(connectionStore.selectedConnectionId).toBe("conn-keyboard");
    expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    input.remove();
    unmount();
  });
});
