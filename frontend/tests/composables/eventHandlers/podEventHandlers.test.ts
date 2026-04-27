import { describe, it, expect, vi } from "vitest";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useChatStore } from "@/stores/chat/chatStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useCommandStore } from "@/stores/note/commandStore";
import {
  getPodEventListeners,
  getStandalonePodListeners,
  removeDeletedNotes,
} from "@/composables/eventHandlers/podEventHandlers";

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

describe("podEventHandlers", () => {
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  function findHandler(event: string) {
    const listeners = getPodEventListeners();
    return listeners.find((l) => l.event === event)!.handler;
  }

  describe("getPodEventListeners", () => {
    it("應回傳正確數量的 listener", () => {
      const result = getPodEventListeners();
      expect(result.length).toBe(14);
    });

    it("應包含主要的 pod 事件", () => {
      const result = getPodEventListeners();
      const events = result.map((l) => l.event);
      expect(events).toContain("pod:created");
      expect(events).toContain("pod:moved");
      expect(events).toContain("pod:renamed");
      expect(events).toContain("pod:deleted");
    });
  });

  describe("handlePodCreated", () => {
    it("canvasId 匹配且 pod 存在時應呼叫 addPodFromEvent", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "addPodFromEvent");
      const pod = { id: "pod-1", name: "Pod 1", x: 0, y: 0 };

      findHandler("pod:created")({ canvasId: "canvas-1", pod });

      expect(spy).toHaveBeenCalledWith(pod);
    });

    it("canvasId 不匹配時不應執行", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "addPodFromEvent");

      findHandler("pod:created")({
        canvasId: "other-canvas",
        pod: { id: "pod-1" },
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodMoved", () => {
    it("canvasId 匹配且 pod 存在時應呼叫 updatePodPosition", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPosition");
      const pod = { id: "pod-1", x: 100, y: 200 };

      findHandler("pod:moved")({ canvasId: "canvas-1", pod });

      expect(spy).toHaveBeenCalledWith("pod-1", 100, 200);
    });

    it("canvasId 不匹配時不應執行", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPosition");

      findHandler("pod:moved")({
        canvasId: "other-canvas",
        pod: { id: "pod-1", x: 100, y: 200 },
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodRenamed", () => {
    it("canvasId 匹配時應呼叫 updatePodName", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodName");

      findHandler("pod:renamed")({
        canvasId: "canvas-1",
        podId: "pod-1",
        name: "新名稱",
      });

      expect(spy).toHaveBeenCalledWith("pod-1", "新名稱");
    });

    it("canvasId 不匹配時不應執行", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodName");

      findHandler("pod:renamed")({
        canvasId: "other-canvas",
        podId: "pod-1",
        name: "新名稱",
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodDeleted", () => {
    it("canvasId 匹配時應呼叫 removePod", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "removePod");

      findHandler("pod:deleted")({ canvasId: "canvas-1", podId: "pod-1" });

      expect(spy).toHaveBeenCalledWith("pod-1");
    });

    it("canvasId 不匹配時不應執行", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "removePod");

      findHandler("pod:deleted")({ canvasId: "other-canvas", podId: "pod-1" });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handleWorkflowClearResult", () => {
    it("canvasId 匹配且有 clearedPodIds 時應清空對應訊息與輸出", () => {
      const chatStore = useChatStore();
      const podStore = usePodStore();
      const chatSpy = vi.spyOn(chatStore, "clearMessagesByPodIds");
      const podSpy = vi.spyOn(podStore, "clearPodOutputsByIds");

      findHandler("workflow:clear:result")({
        canvasId: "canvas-1",
        clearedPodIds: ["pod-1", "pod-2"],
      });

      expect(chatSpy).toHaveBeenCalledWith(["pod-1", "pod-2"]);
      expect(podSpy).toHaveBeenCalledWith(["pod-1", "pod-2"]);
    });

    it("canvasId 不匹配時不應執行", () => {
      const chatStore = useChatStore();
      const chatSpy = vi.spyOn(chatStore, "clearMessagesByPodIds");

      findHandler("workflow:clear:result")({
        canvasId: "other-canvas",
        clearedPodIds: ["pod-1"],
      });

      expect(chatSpy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodChatUserMessage（standalone）", () => {
    it("應呼叫 chatStore.addRemoteUserMessage", () => {
      const chatStore = useChatStore();
      const spy = vi.spyOn(chatStore, "addRemoteUserMessage");

      const standaloneListeners = getStandalonePodListeners();
      const handler = standaloneListeners.find(
        (l) => l.event === "pod:chat:user-message",
      )!.handler;

      handler({
        podId: "pod-1",
        messageId: "msg-1",
        content: "使用者訊息",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(spy).toHaveBeenCalledWith(
        "pod-1",
        "msg-1",
        "使用者訊息",
        "2024-01-01T00:00:00Z",
      );
    });
  });

  describe("removeDeletedNotes", () => {
    it("deletedNoteIds 為 undefined 時不應拋錯", () => {
      expect(() => removeDeletedNotes(undefined)).not.toThrow();
    });

    it("repositoryNote ids 存在時應呼叫 repositoryStore.removeNoteFromEvent", () => {
      const repositoryStore = useRepositoryStore();
      const spy = vi.spyOn(repositoryStore, "removeNoteFromEvent");

      removeDeletedNotes({ repositoryNote: ["repo-note-1", "repo-note-2"] });

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith("repo-note-1");
      expect(spy).toHaveBeenCalledWith("repo-note-2");
    });

    it("commandNote ids 存在時應呼叫 commandStore.removeNoteFromEvent", () => {
      const commandStore = useCommandStore();
      const spy = vi.spyOn(commandStore, "removeNoteFromEvent");

      removeDeletedNotes({ commandNote: ["cmd-note-1"] });

      expect(spy).toHaveBeenCalledWith("cmd-note-1");
    });

    it("ids 為空陣列時不應呼叫 removeNoteFromEvent", () => {
      const repositoryStore = useRepositoryStore();
      const commandStore = useCommandStore();
      const repoSpy = vi.spyOn(repositoryStore, "removeNoteFromEvent");
      const cmdSpy = vi.spyOn(commandStore, "removeNoteFromEvent");

      removeDeletedNotes({ repositoryNote: [], commandNote: [] });

      expect(repoSpy).not.toHaveBeenCalled();
      expect(cmdSpy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodPluginsSet", () => {
    it("success=true 且 payload 完整時應呼叫 updatePodPlugins", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      findHandler("pod:plugins:set")({
        canvasId: "canvas-1",
        success: true,
        pod: { id: "pod-1", pluginIds: ["plugin-a", "plugin-b"] },
      });

      expect(spy).toHaveBeenCalledWith("pod-1", ["plugin-a", "plugin-b"]);
    });

    it("success=false 時不應呼叫 updatePodPlugins", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      findHandler("pod:plugins:set")({
        canvasId: "canvas-1",
        success: false,
        pod: { id: "pod-1", pluginIds: ["plugin-a"] },
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("pluginIds 含非字串元素時不應呼叫 updatePodPlugins", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      findHandler("pod:plugins:set")({
        canvasId: "canvas-1",
        success: true,
        pod: { id: "pod-1", pluginIds: [123, "plugin-b"] },
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("canvasId 不匹配時不應呼叫 updatePodPlugins", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      findHandler("pod:plugins:set")({
        canvasId: "other-canvas",
        success: true,
        pod: { id: "pod-1", pluginIds: ["plugin-a"] },
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodMcpServerNamesUpdated", () => {
    it("成功路徑應呼叫 updatePodMcpServers", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      findHandler("pod:mcp-server-names:updated")({
        canvasId: "canvas-1",
        podId: "pod-1",
        mcpServerNames: ["server-a", "server-b"],
      });

      expect(spy).toHaveBeenCalledWith("pod-1", ["server-a", "server-b"]);
    });

    it("podId 缺失時不應呼叫 updatePodMcpServers", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      findHandler("pod:mcp-server-names:updated")({
        canvasId: "canvas-1",
        mcpServerNames: ["server-a"],
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("mcpServerNames 含非字串元素時不應呼叫 updatePodMcpServers", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      findHandler("pod:mcp-server-names:updated")({
        canvasId: "canvas-1",
        podId: "pod-1",
        mcpServerNames: [123, "server-b"],
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodScheduleSet", () => {
    it("canvasId 匹配且 pod 存在時應呼叫 updatePod", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePod");
      const pod = {
        id: "pod-1",
        name: "Pod 1",
        x: 0,
        y: 0,
        output: [],
        rotation: 0,
        status: "idle",
        repositoryId: null,
        multiInstance: false,
        commandId: null,
        schedule: { frequency: "every-day", enabled: true } as any,
        mcpServerNames: [],
        pluginIds: [],
        provider: "claude",
        providerConfig: { model: "opus" },
      };

      findHandler("pod:schedule:set")({ canvasId: "canvas-1", pod });

      expect(spy).toHaveBeenCalledWith(pod);
    });

    it("canvasId 不匹配時不應呼叫 updatePod", () => {
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePod");

      findHandler("pod:schedule:set")({
        canvasId: "other-canvas",
        pod: { id: "pod-1" },
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("handlePodDeleted 含 deletedNoteIds", () => {
    it("payload 含 deletedNoteIds 時應同時刪除 pod 及對應 notes", () => {
      const podStore = usePodStore();
      const repositoryStore = useRepositoryStore();
      const commandStore = useCommandStore();
      const removePodSpy = vi.spyOn(podStore, "removePod");
      const removeRepoNoteSpy = vi.spyOn(
        repositoryStore,
        "removeNoteFromEvent",
      );
      const removeCmdNoteSpy = vi.spyOn(commandStore, "removeNoteFromEvent");

      findHandler("pod:deleted")({
        canvasId: "canvas-1",
        podId: "pod-1",
        deletedNoteIds: {
          repositoryNote: ["repo-note-1"],
          commandNote: ["cmd-note-1"],
        },
      });

      expect(removePodSpy).toHaveBeenCalledWith("pod-1");
      expect(removeRepoNoteSpy).toHaveBeenCalledWith("repo-note-1");
      expect(removeCmdNoteSpy).toHaveBeenCalledWith("cmd-note-1");
    });
  });
});
