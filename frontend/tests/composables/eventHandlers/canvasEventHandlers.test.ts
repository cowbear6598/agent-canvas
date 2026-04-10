import { describe, it, expect, vi } from "vitest";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useOutputStyleStore } from "@/stores/note/outputStyleStore";
import { useSkillStore } from "@/stores/note/skillStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useSubAgentStore } from "@/stores/note/subAgentStore";
import { useCommandStore } from "@/stores/note/commandStore";
import { useMcpServerStore } from "@/stores/note/mcpServerStore";
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
    it("應回傳 5 個 listener", () => {
      const result = getCanvasEventListeners();
      expect(result).toHaveLength(5);
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

    it("canvas 為 undefined 時不應呼叫 addCanvasFromEvent", () => {
      const canvasStore = useCanvasStore();
      const spy = vi.spyOn(canvasStore, "addCanvasFromEvent");

      findHandler("canvas:created")({});

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handleCanvasRenamed（skipCanvasCheck: true）", () => {
    it("收到事件時應呼叫 renameCanvasFromEvent", () => {
      const canvasStore = useCanvasStore();
      const spy = vi.spyOn(canvasStore, "renameCanvasFromEvent");

      findHandler("canvas:renamed")({
        canvasId: "canvas-1",
        newName: "新名稱",
      });

      expect(spy).toHaveBeenCalledWith("canvas-1", "新名稱");
    });
  });

  describe("handleCanvasDeleted（skipCanvasCheck: true）", () => {
    it("收到事件時應呼叫 removeCanvasFromEvent", () => {
      const canvasStore = useCanvasStore();
      const spy = vi.spyOn(canvasStore, "removeCanvasFromEvent");

      findHandler("canvas:deleted")({ canvasId: "canvas-1" });

      expect(spy).toHaveBeenCalledWith("canvas-1");
    });
  });

  describe("handleCanvasReordered（skipCanvasCheck: true）", () => {
    it("收到事件時應呼叫 reorderCanvasesFromEvent", () => {
      const canvasStore = useCanvasStore();
      const spy = vi.spyOn(canvasStore, "reorderCanvasesFromEvent");
      const canvasIds = ["canvas-2", "canvas-1", "canvas-3"];

      findHandler("canvas:reordered")({ canvasIds });

      expect(spy).toHaveBeenCalledWith(canvasIds);
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
      const outputStyleStore = useOutputStyleStore();
      const skillStore = useSkillStore();
      const repositoryStore = useRepositoryStore();
      const subAgentStore = useSubAgentStore();
      const commandStore = useCommandStore();
      const mcpServerStore = useMcpServerStore();

      const podSpy = vi.spyOn(podStore, "addPodFromEvent");
      const connSpy = vi.spyOn(connectionStore, "addConnectionFromEvent");
      const outputSpy = vi.spyOn(outputStyleStore, "addNoteFromEvent");
      const skillSpy = vi.spyOn(skillStore, "addNoteFromEvent");
      const repoSpy = vi.spyOn(repositoryStore, "addNoteFromEvent");
      const subAgentSpy = vi.spyOn(subAgentStore, "addNoteFromEvent");
      const commandSpy = vi.spyOn(commandStore, "addNoteFromEvent");
      const mcpSpy = vi.spyOn(mcpServerStore, "addNoteFromEvent");

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
        createdOutputStyleNotes: [{ id: "os-1" }],
        createdSkillNotes: [{ id: "sk-1" }],
        createdRepositoryNotes: [{ id: "rp-1" }],
        createdSubAgentNotes: [{ id: "sa-1" }],
        createdCommandNotes: [{ id: "cmd-1" }],
        createdMcpServerNotes: [{ id: "mcp-1" }],
      });

      expect(podSpy).toHaveBeenCalledWith(pod);
      expect(connSpy).toHaveBeenCalledWith(connection);
      expect(outputSpy).toHaveBeenCalled();
      expect(skillSpy).toHaveBeenCalled();
      expect(repoSpy).toHaveBeenCalled();
      expect(subAgentSpy).toHaveBeenCalled();
      expect(commandSpy).toHaveBeenCalled();
      expect(mcpSpy).toHaveBeenCalled();
    });
  });
});
