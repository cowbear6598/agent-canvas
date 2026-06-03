import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  resetMockWebSocket,
  simulateEvent,
  webSocketMockFactory,
} from "@tests/helpers/mockWebSocket";
import {
  createMockConnection,
  createMockWorkflowRun,
} from "@tests/helpers/factories";
import { createAppEventWiring } from "@/composables/eventHandlers/appEventWiring";
import { useCanvasStore } from "@/stores/canvasStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useRunStore } from "@/stores/run/runStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

describe("appEventWiring", () => {
  afterEach(() => {
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  it("應透過前端 WebSocket wrapper 將事件分派到對應 store reducer 與 action", () => {
    setActivePinia(createPinia());

    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";

    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        id: "conn-1",
        sourcePodId: "pod-a",
        targetPodId: "pod-b",
        status: "idle",
        triggerMode: "direct",
      }),
    ];

    const runStore = useRunStore();
    runStore.runsById = new Map();

    const addRunSpy = vi.spyOn(runStore, "addRun");
    const setConnectionStatusSpy = vi.spyOn(connectionStore, "setConnectionStatus");

    const wiring = createAppEventWiring();
    wiring.register();

    const createdRun = createMockWorkflowRun({
      id: "run-created",
      status: "running",
    });
    simulateEvent("run:created", {
      canvasId: "canvas-1",
      run: createdRun,
    });
    simulateEvent("workflow:direct-triggered", {
      canvasId: "canvas-1",
      connectionId: "conn-1",
    });

    expect(addRunSpy).toHaveBeenCalledWith(createdRun);
    expect(setConnectionStatusSpy).toHaveBeenCalledWith("conn-1", "active");
    expect(connectionStore.findConnectionById("conn-1")?.status).toBe("active");
    expect(runStore.getRunById("run-created")).toEqual(createdRun);

    wiring.unregister();
  });
});
