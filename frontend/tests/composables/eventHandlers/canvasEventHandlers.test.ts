import { describe, it, expect, vi } from "vitest";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useCommandStore } from "@/stores/note/commandStore";
// TODO Phase 4: useMcpServerStore 重構後補回
import { getCanvasEventListeners } from "@/composables/eventHandlers/canvasEventHandlers";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: vi.fn().mockReturnValue(false),
  createWebSocketRequest: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("canvasEventHandlers", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  function findHandler(event: string) {
    const listeners = getCanvasEventListeners();
    return listeners.find((l) => l.event === event)!.handler;
  }

  describe("getCanvasEventListeners", () => {
    it("應回傳 6 個 listener", () => {
      const result = getCanvasEventListeners();
      expect(result).toHaveLength(6);
    });
  });

  describe("handleCanvasCreated（skipCanvasCheck: true）", () => {
    it("收到事件時應呼叫 addCanvasFromEvent", () => {
      const canvasStore = useCanvasStore();
      const spy = vi.spyOn(canvasStore, "addCanvasFromEvent");
      const canvas = { id: "canvas-new", name: "新畫布" };

      findHandler("canvas:created")({ canvas });

      expect(spy).toHaveBeenCalledWith(canvas);
    });

    it("即使 canvasId 不匹配也應執行（skipCanvasCheck）", () => {
      const canvasStore = useCanvasStore();
      const spy = vi.spyOn(canvasStore, "addCanvasFromEvent");
      const canvas = { id: "canvas-new", name: "新畫布" };

      findHandler("canvas:created")({ canvasId: "other-canvas", canvas });

      expect(spy).toHaveBeenCalledWith(canvas);
    });
  });

  describe("handleCanvasPasted", () => {
    it("canvasId 不匹配時不應執行", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "addPodFromEvent");

      findHandler("canvas:paste:result")({
        canvasId: "other-canvas",
        createdPods: [{ id: "pod-1", name: "Pod 1", x: 0, y: 0 }],
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("canvasId 匹配時應將所有建立的項目加入各 store", () => {
      const podStore = usePodStore();
      const connectionStore = useConnectionStore();
      const repositoryStore = useRepositoryStore();
      const commandStore = useCommandStore();
      // TODO Phase 4: mcpServerStore spy 重構後補回

      const podSpy = vi.spyOn(podStore, "addPodFromEvent");
      const connSpy = vi.spyOn(connectionStore, "addConnectionFromEvent");
      const repoSpy = vi.spyOn(repositoryStore, "addNoteFromEvent");
      const commandSpy = vi.spyOn(commandStore, "addNoteFromEvent");

      const pod = { id: "pod-1", name: "Pod 1", x: 0, y: 0 };
      const connection = {
        id: "conn-1",
        sourcePodId: "pod-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-2",
        targetAnchor: "top",
        triggerMode: "auto",
      };

      findHandler("canvas:paste:result")({
        canvasId: "canvas-1",
        createdPods: [pod],
        createdConnections: [connection],
        createdRepositoryNotes: [{ id: "rp-1" }],
        createdCommandNotes: [{ id: "cmd-1" }],
        // TODO Phase 4: createdMcpServerNotes 重構後補回
      });

      expect(podSpy).toHaveBeenCalledWith(pod);
      expect(connSpy).toHaveBeenCalledWith(connection);
      expect(repoSpy).toHaveBeenCalledWith({ id: "rp-1" });
      expect(commandSpy).toHaveBeenCalledWith({ id: "cmd-1" });
    });
  });
});
