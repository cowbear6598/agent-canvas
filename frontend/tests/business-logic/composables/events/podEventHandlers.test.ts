import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { createMockPod } from "@tests/helpers/factories";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { getPodEventListeners } from "@/composables/eventHandlers/podEventHandlers";
import { WebSocketResponseEvents } from "@/services/websocket";

const { mockToast, mockTryResolvePendingRequest } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockTryResolvePendingRequest: vi.fn(),
}));

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: mockTryResolvePendingRequest,
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe("podEventHandlers", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
    mockToast.mockClear();
    mockTryResolvePendingRequest.mockReset();
    mockTryResolvePendingRequest.mockReturnValue(true);
  });

  it("自己的 pod created 事件只同步狀態，不額外顯示事件 Toast", () => {
    const podStore = usePodStore();
    const listener = getPodEventListeners().find(
      (item) => item.event === WebSocketResponseEvents.POD_CREATED,
    );

    listener?.handler({
      requestId: "req-1",
      canvasId: "canvas-1",
      pod: createMockPod({ id: "pod-1", name: "New Pod" }),
    });

    expect(podStore.pods).toHaveLength(1);
    expect(podStore.pods[0]?.id).toBe("pod-1");
    expect(mockTryResolvePendingRequest).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ canvasId: "canvas-1" }),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("自己的 pod deleted 事件只同步狀態，不額外顯示事件 Toast", () => {
    const podStore = usePodStore();
    podStore.pods = [createMockPod({ id: "pod-1", name: "Deleted Pod" })];
    const listener = getPodEventListeners().find(
      (item) => item.event === WebSocketResponseEvents.POD_DELETED,
    );

    listener?.handler({
      requestId: "req-2",
      canvasId: "canvas-1",
      podId: "pod-1",
    });

    expect(podStore.pods).toHaveLength(0);
    expect(mockTryResolvePendingRequest).toHaveBeenCalledWith(
      "req-2",
      expect.objectContaining({ podId: "pod-1" }),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });
});
