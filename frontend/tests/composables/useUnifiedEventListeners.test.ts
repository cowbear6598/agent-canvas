import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "../helpers/mockWebSocket";
import { setupStoreTest } from "../helpers/testSetup";
import {
  createMockPod,
  createMockConnection,
  createMockNote,
  createMockCanvas,
} from "../helpers/factories";
import {
  useUnifiedEventListeners,
  listeners,
} from "@/composables/useUnifiedEventListeners";
import { resetChatActionsCache } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSkillStore } from "@/stores/note/skillStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useSubAgentStore } from "@/stores/note/subAgentStore";
import { useCommandStore } from "@/stores/note/commandStore";
import { useMcpServerStore } from "@/stores/note/mcpServerStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useChatStore } from "@/stores/chat/chatStore";
import { useIntegrationStore } from "@/stores/integrationStore";
import type {
  Pod,
  Connection,
  SkillNote,
  RepositoryNote,
  SubAgentNote,
  CommandNote,
  Canvas,
  McpServer,
  McpServerNote,
} from "@/types";
import type { IntegrationApp } from "@/types/integration";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: vi.fn().mockReturnValue(false),
  createWebSocketRequest: vi.fn(),
}));

const { sharedMockToast } = vi.hoisted(() => ({
  sharedMockToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: sharedMockToast,
  }),
}));

describe("useUnifiedEventListeners", () => {
  let mockTryResolvePendingRequest: ReturnType<typeof vi.fn>;

  setupStoreTest(() => {
    resetChatActionsCache();
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
  });

  beforeEach(async () => {
    const createWebSocketRequestModule =
      await import("@/services/websocket/createWebSocketRequest");
    mockTryResolvePendingRequest = vi.mocked(
      createWebSocketRequestModule.tryResolvePendingRequest,
    );
    mockTryResolvePendingRequest.mockReturnValue(false);
    sharedMockToast.mockClear();
  });

  afterEach(() => {
    const { unregisterUnifiedListeners } = useUnifiedEventListeners();
    unregisterUnifiedListeners();
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  describe("registerUnifiedListeners / unregisterUnifiedListeners", () => {
    it("應註冊所有事件監聽器", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();

      registerUnifiedListeners();

      expect(mockWebSocketClient.on).toHaveBeenCalled();
      const callCount = mockWebSocketClient.on.mock.calls.length;
      // listeners 陣列長度加上 standaloneListeners：
      // pod:chat:user-message、integration:connection:status:changed、
      // run:message、run:chat:complete、run:tool_use、run:tool_result 共 6 個
      // backup:started、backup:completed、backup:failed 共 3 個
      const expectedCount = listeners.length + 9;
      expect(callCount).toBe(expectedCount);
    });

    it("重複註冊應被防止", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();

      registerUnifiedListeners();

      mockWebSocketClient.on.mockClear();
      registerUnifiedListeners();

      expect(mockWebSocketClient.on).not.toHaveBeenCalled();
    });

    it("應取消註冊所有事件監聽器", () => {
      const { registerUnifiedListeners, unregisterUnifiedListeners } =
        useUnifiedEventListeners();

      registerUnifiedListeners();
      unregisterUnifiedListeners();

      expect(mockWebSocketClient.off).toHaveBeenCalled();
      const callCount = mockWebSocketClient.off.mock.calls.length;
      // listeners 陣列長度加上 standaloneListeners：
      // pod:chat:user-message、integration:connection:status:changed、
      // run:message、run:chat:complete、run:tool_use、run:tool_result 共 6 個
      // backup:started、backup:completed、backup:failed 共 3 個
      const expectedCount = listeners.length + 9;
      expect(callCount).toBe(expectedCount);
    });

    it("未註冊時取消註冊應被防止", () => {
      const { unregisterUnifiedListeners } = useUnifiedEventListeners();

      unregisterUnifiedListeners();

      expect(mockWebSocketClient.off).not.toHaveBeenCalled();
    });
  });

  describe("createUnifiedHandler - isCurrentCanvas 檢查", () => {
    it("事件來自當前 Canvas 時應處理", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();
      canvasStore.activeCanvasId = "canvas-1";

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1" });
      simulateEvent("pod:created", {
        canvasId: "canvas-1",
        pod,
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(true);
    });

    it("事件來自不同 Canvas 時不應處理", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const podStore = usePodStore();
      canvasStore.activeCanvasId = "canvas-1";
      podStore.pods = [];

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1" });
      simulateEvent("pod:created", {
        canvasId: "canvas-2",
        pod,
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(false);
    });

    it("skipCanvasCheck 為 true 時應忽略 Canvas 檢查", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      registerUnifiedListeners();

      const canvas = createMockCanvas({ id: "canvas-2", name: "New Canvas" });
      simulateEvent("canvas:created", {
        canvas,
      });

      expect(canvasStore.canvases.some((c) => c.id === "canvas-2")).toBe(true);
    });
  });

  describe("createUnifiedHandler - isOwnOperation 檢查", () => {
    it("自己的操作應顯示 Toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      mockTryResolvePendingRequest.mockReturnValue(true);

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1" });
      simulateEvent("pod:created", {
        canvasId: "canvas-1",
        requestId: "req-1",
        pod,
      });

      expect(sharedMockToast).toHaveBeenCalledWith({ title: "Pod 建立成功" });
    });

    it("他人操作不應顯示 Toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      mockTryResolvePendingRequest.mockReturnValue(false);

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1" });
      simulateEvent("pod:created", {
        canvasId: "canvas-1",
        requestId: "req-1",
        pod,
      });

      expect(sharedMockToast).not.toHaveBeenCalled();
    });

    it("無 requestId 時不應顯示 Toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1" });
      simulateEvent("pod:created", {
        canvasId: "canvas-1",
        pod,
      });

      expect(sharedMockToast).not.toHaveBeenCalled();
    });
  });

  describe("Pod 事件處理", () => {
    it("pod:created 應新增 Pod 到 podStore", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1", name: "Test Pod" });
      simulateEvent("pod:created", {
        canvasId: "canvas-1",
        pod,
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(true);
    });

    it("pod:moved 應更新 Pod 座標", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:moved", {
        canvasId: "canvas-1",
        pod: { ...pod, x: 200, y: 300 },
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.x).toBe(200);
      expect(updatedPod?.y).toBe(300);
    });

    it("pod:renamed 應更新 Pod 名稱", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", name: "Old Name" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:renamed", {
        canvasId: "canvas-1",
        podId: "pod-1",
        name: "New Name",
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.name).toBe("New Name");
    });

    it("pod:model:set 應更新 Pod 的 providerConfig.model", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({
        id: "pod-1",
        providerConfig: { model: "opus" },
      });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:model:set", {
        canvasId: "canvas-1",
        pod: { ...pod, providerConfig: { model: "sonnet" } },
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.providerConfig.model).toBe("sonnet");
    });

    it("pod:deleted 應移除 Pod 並清理相關 notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const skillStore = useSkillStore();

      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      const skillNote = createMockNote("skill", {
        id: "skill-note-1",
      }) as SkillNote;
      skillStore.notes = [skillNote] as any[];

      registerUnifiedListeners();

      simulateEvent("pod:deleted", {
        canvasId: "canvas-1",
        podId: "pod-1",
        deletedNoteIds: {
          skillNote: ["skill-note-1"],
        },
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(false);
      expect(skillStore.notes.some((n) => n.id === "skill-note-1")).toBe(false);
    });
  });

  describe("Connection 事件處理", () => {
    it("connection:created 應新增 Connection", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const connectionStore = useConnectionStore();

      registerUnifiedListeners();

      const connection = createMockConnection({ id: "conn-1" });
      simulateEvent("connection:created", {
        canvasId: "canvas-1",
        connection,
      });

      expect(connectionStore.connections.some((c) => c.id === "conn-1")).toBe(
        true,
      );
    });

    it("connection:updated 應更新 Connection", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const connectionStore = useConnectionStore();
      const connection = createMockConnection({
        id: "conn-1",
        triggerMode: "auto",
      });
      connectionStore.connections = [connection];

      registerUnifiedListeners();

      simulateEvent("connection:updated", {
        canvasId: "canvas-1",
        connection: { ...connection, triggerMode: "manual" },
      });

      const updatedConnection = connectionStore.connections.find(
        (c) => c.id === "conn-1",
      );
      expect(updatedConnection?.triggerMode).toBe("manual");
    });

    it("connection:deleted 應移除 Connection", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const connectionStore = useConnectionStore();
      const connection = createMockConnection({ id: "conn-1" });
      connectionStore.connections = [connection];

      registerUnifiedListeners();

      simulateEvent("connection:deleted", {
        canvasId: "canvas-1",
        connectionId: "conn-1",
      });

      expect(connectionStore.connections.some((c) => c.id === "conn-1")).toBe(
        false,
      );
    });
  });

  describe("Skill Note 事件處理", () => {
    it("skill-note:created 應新增 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const skillStore = useSkillStore();

      registerUnifiedListeners();

      const note = createMockNote("skill", { id: "skill-note-1" }) as SkillNote;
      simulateEvent("skill-note:created", {
        canvasId: "canvas-1",
        note,
      });

      expect(skillStore.notes.some((n) => n.id === "skill-note-1")).toBe(true);
    });

    it("skill-note:updated 應更新 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const skillStore = useSkillStore();
      const note = createMockNote("skill", {
        id: "skill-note-1",
        name: "Old",
      }) as SkillNote;
      skillStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("skill-note:updated", {
        canvasId: "canvas-1",
        note: { ...note, name: "New" },
      });

      const updated = skillStore.notes.find((n) => n.id === "skill-note-1");
      expect(updated?.name).toBe("New");
    });

    it("skill-note:deleted 應移除 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const skillStore = useSkillStore();
      const note = createMockNote("skill", { id: "skill-note-1" }) as SkillNote;
      skillStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("skill-note:deleted", {
        canvasId: "canvas-1",
        noteId: "skill-note-1",
      });

      expect(skillStore.notes.some((n) => n.id === "skill-note-1")).toBe(false);
    });

    it("skill:deleted 應移除 skill 和相關 notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const skillStore = useSkillStore();
      skillStore.availableItems = [{ id: "skill-1", name: "Test Skill" }];
      const note = createMockNote("skill", { id: "skill-note-1" }) as SkillNote;
      skillStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("skill:deleted", {
        canvasId: "canvas-1",
        skillId: "skill-1",
        deletedNoteIds: ["skill-note-1"],
      });

      expect(
        skillStore.availableItems.some((i) => (i as any).id === "skill-1"),
      ).toBe(false);
      expect(skillStore.notes.some((n) => n.id === "skill-note-1")).toBe(false);
    });
  });

  describe("Repository Note 事件處理", () => {
    it("repository:created 不再被監聽（後端改為 emitToConnection）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();

      registerUnifiedListeners();

      simulateEvent("repository:created", {
        canvasId: "canvas-1",
        repository: {
          id: "repo-1",
          name: "Test Repo",
          path: "/test",
          currentBranch: "main",
        },
      });

      expect(
        repositoryStore.availableItems.some((r) => (r as any).id === "repo-1"),
      ).toBe(false);
    });

    it("repository:worktree:created 應新增 worktree（通過安全檢查）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();

      registerUnifiedListeners();

      simulateEvent("repository:worktree:created", {
        canvasId: "canvas-1",
        repository: {
          id: "worktree-1",
          name: "Valid Worktree",
          parentRepoId: "repo-1",
          branchName: "feature",
        },
      });

      expect(
        repositoryStore.availableItems.some(
          (r) => (r as any).id === "worktree-1",
        ),
      ).toBe(true);
    });

    it("repository:worktree:created 應拒絕無效 id", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      registerUnifiedListeners();

      simulateEvent("repository:worktree:created", {
        canvasId: "canvas-1",
        repository: { id: "", name: "Test" },
      });

      expect(repositoryStore.availableItems.length).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Security] 無效的 repository.id 格式",
      );
      consoleErrorSpy.mockRestore();
    });

    it("repository:worktree:created 應拒絕無效 name", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      registerUnifiedListeners();

      simulateEvent("repository:worktree:created", {
        canvasId: "canvas-1",
        repository: { id: "worktree-1", name: "" },
      });

      expect(repositoryStore.availableItems.length).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Security] 無效的 repository.name 格式",
      );
      consoleErrorSpy.mockRestore();
    });

    it("repository:worktree:created 應拒絕包含危險字元的 name", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      registerUnifiedListeners();

      simulateEvent("repository:worktree:created", {
        canvasId: "canvas-1",
        repository: { id: "worktree-1", name: '<script>alert("xss")</script>' },
      });

      expect(repositoryStore.availableItems.length).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[Security] 潛在惡意的 repository.name:",
        '<script>alert("xss")</script>',
      );
      consoleErrorSpy.mockRestore();
    });

    it("repository:deleted 應移除 repository 和相關 notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      repositoryStore.availableItems = [
        { id: "repo-1", name: "Test", isGit: false },
      ];
      const note = createMockNote("repository", {
        id: "repo-note-1",
      }) as RepositoryNote;
      repositoryStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("repository:deleted", {
        canvasId: "canvas-1",
        repositoryId: "repo-1",
        deletedNoteIds: ["repo-note-1"],
      });

      expect(
        repositoryStore.availableItems.some((r) => (r as any).id === "repo-1"),
      ).toBe(false);
      expect(repositoryStore.notes.some((n) => n.id === "repo-note-1")).toBe(
        false,
      );
    });

    it("repository:branch:changed 應更新 currentBranch", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      repositoryStore.availableItems = [
        { id: "repo-1", name: "Test", isGit: true, currentBranch: "main" },
      ];

      registerUnifiedListeners();

      simulateEvent("repository:branch:changed", {
        repositoryId: "repo-1",
        branchName: "feature",
      });

      const repo = repositoryStore.availableItems.find(
        (r) => (r as any).id === "repo-1",
      ) as any;
      expect(repo?.currentBranch).toBe("feature");
    });

    it("repository:branch:changed 跨 canvas 應更新 currentBranch（skipCanvasCheck）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const repositoryStore = useRepositoryStore();
      canvasStore.activeCanvasId = "canvas-1";
      repositoryStore.availableItems = [
        { id: "repo-1", name: "Test", isGit: true, currentBranch: "main" },
      ];

      registerUnifiedListeners();

      simulateEvent("repository:branch:changed", {
        repositoryId: "repo-1",
        branchName: "feature",
      });

      const repo = repositoryStore.availableItems.find(
        (r) => (r as any).id === "repo-1",
      ) as any;
      expect(repo?.currentBranch).toBe("feature");
    });

    it("repository:branch:changed 含 XSS 的 branchName 不應更新 store", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      repositoryStore.availableItems = [
        { id: "repo-1", name: "Test", isGit: true, currentBranch: "main" },
      ];

      registerUnifiedListeners();

      simulateEvent("repository:branch:changed", {
        repositoryId: "repo-1",
        branchName: '<script>alert("xss")</script>',
      });

      const repo = repositoryStore.availableItems.find(
        (r) => (r as any).id === "repo-1",
      ) as any;
      expect(repo?.currentBranch).toBe("main");
    });

    it("repository:branch:changed 空字串 branchName 不應更新 store", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      repositoryStore.availableItems = [
        { id: "repo-1", name: "Test", isGit: true, currentBranch: "main" },
      ];

      registerUnifiedListeners();

      simulateEvent("repository:branch:changed", {
        repositoryId: "repo-1",
        branchName: "",
      });

      const repo = repositoryStore.availableItems.find(
        (r) => (r as any).id === "repo-1",
      ) as any;
      expect(repo?.currentBranch).toBe("main");
    });

    it("repository-note:created 應新增 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();

      registerUnifiedListeners();

      const note = createMockNote("repository", {
        id: "repo-note-1",
      }) as RepositoryNote;
      simulateEvent("repository-note:created", {
        canvasId: "canvas-1",
        note,
      });

      expect(repositoryStore.notes.some((n) => n.id === "repo-note-1")).toBe(
        true,
      );
    });

    it("repository-note:updated 應更新 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      const note = createMockNote("repository", {
        id: "repo-note-1",
        name: "Old",
      }) as RepositoryNote;
      repositoryStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("repository-note:updated", {
        canvasId: "canvas-1",
        note: { ...note, name: "New" },
      });

      const updated = repositoryStore.notes.find((n) => n.id === "repo-note-1");
      expect(updated?.name).toBe("New");
    });

    it("repository-note:deleted 應移除 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      const note = createMockNote("repository", {
        id: "repo-note-1",
      }) as RepositoryNote;
      repositoryStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("repository-note:deleted", {
        canvasId: "canvas-1",
        noteId: "repo-note-1",
      });

      expect(repositoryStore.notes.some((n) => n.id === "repo-note-1")).toBe(
        false,
      );
    });
  });

  describe("SubAgent Note 事件處理", () => {
    it("subagent:created 不再被監聽（後端改為 emitToConnection）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const subAgentStore = useSubAgentStore();

      registerUnifiedListeners();

      simulateEvent("subagent:created", {
        canvasId: "canvas-1",
        subAgent: { id: "subagent-1", name: "Test SubAgent" },
      });

      expect(
        subAgentStore.availableItems.some(
          (s) => (s as any).id === "subagent-1",
        ),
      ).toBe(false);
    });

    it("subagent:deleted 應移除 subAgent 和相關 notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const subAgentStore = useSubAgentStore();
      subAgentStore.availableItems = [{ id: "subagent-1", name: "Test" }];
      const note = createMockNote("subAgent", {
        id: "subagent-note-1",
      }) as SubAgentNote;
      subAgentStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("subagent:deleted", {
        canvasId: "canvas-1",
        subAgentId: "subagent-1",
        deletedNoteIds: ["subagent-note-1"],
      });

      expect(
        subAgentStore.availableItems.some(
          (s) => (s as any).id === "subagent-1",
        ),
      ).toBe(false);
      expect(subAgentStore.notes.some((n) => n.id === "subagent-note-1")).toBe(
        false,
      );
    });

    it("subagent-note:created 應新增 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const subAgentStore = useSubAgentStore();

      registerUnifiedListeners();

      const note = createMockNote("subAgent", {
        id: "subagent-note-1",
      }) as SubAgentNote;
      simulateEvent("subagent-note:created", {
        canvasId: "canvas-1",
        note,
      });

      expect(subAgentStore.notes.some((n) => n.id === "subagent-note-1")).toBe(
        true,
      );
    });

    it("subagent-note:updated 應更新 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const subAgentStore = useSubAgentStore();
      const note = createMockNote("subAgent", {
        id: "subagent-note-1",
        name: "Old",
      }) as SubAgentNote;
      subAgentStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("subagent-note:updated", {
        canvasId: "canvas-1",
        note: { ...note, name: "New" },
      });

      const updated = subAgentStore.notes.find(
        (n) => n.id === "subagent-note-1",
      );
      expect(updated?.name).toBe("New");
    });

    it("subagent-note:deleted 應移除 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const subAgentStore = useSubAgentStore();
      const note = createMockNote("subAgent", {
        id: "subagent-note-1",
      }) as SubAgentNote;
      subAgentStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("subagent-note:deleted", {
        canvasId: "canvas-1",
        noteId: "subagent-note-1",
      });

      expect(subAgentStore.notes.some((n) => n.id === "subagent-note-1")).toBe(
        false,
      );
    });
  });

  describe("Command Note 事件處理", () => {
    it("command:created 不再被監聽（後端改為 emitToConnection）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const commandStore = useCommandStore();

      registerUnifiedListeners();

      simulateEvent("command:created", {
        canvasId: "canvas-1",
        command: { id: "cmd-1", name: "Test Command" },
      });

      expect(
        commandStore.availableItems.some((c) => (c as any).id === "cmd-1"),
      ).toBe(false);
    });

    it("command:deleted 應移除 command 和相關 notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const commandStore = useCommandStore();
      commandStore.availableItems = [{ id: "cmd-1", name: "Test" }];
      const note = createMockNote("command", {
        id: "cmd-note-1",
      }) as CommandNote;
      commandStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("command:deleted", {
        canvasId: "canvas-1",
        commandId: "cmd-1",
        deletedNoteIds: ["cmd-note-1"],
      });

      expect(
        commandStore.availableItems.some((c) => (c as any).id === "cmd-1"),
      ).toBe(false);
      expect(commandStore.notes.some((n) => n.id === "cmd-note-1")).toBe(false);
    });

    it("command-note:created 應新增 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const commandStore = useCommandStore();

      registerUnifiedListeners();

      const note = createMockNote("command", {
        id: "cmd-note-1",
      }) as CommandNote;
      simulateEvent("command-note:created", {
        canvasId: "canvas-1",
        note,
      });

      expect(commandStore.notes.some((n) => n.id === "cmd-note-1")).toBe(true);
    });

    it("command-note:updated 應更新 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const commandStore = useCommandStore();
      const note = createMockNote("command", {
        id: "cmd-note-1",
        name: "Old",
      }) as CommandNote;
      commandStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("command-note:updated", {
        canvasId: "canvas-1",
        note: { ...note, name: "New" },
      });

      const updated = commandStore.notes.find((n) => n.id === "cmd-note-1");
      expect(updated?.name).toBe("New");
    });

    it("command-note:deleted 應移除 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const commandStore = useCommandStore();
      const note = createMockNote("command", {
        id: "cmd-note-1",
      }) as CommandNote;
      commandStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("command-note:deleted", {
        canvasId: "canvas-1",
        noteId: "cmd-note-1",
      });

      expect(commandStore.notes.some((n) => n.id === "cmd-note-1")).toBe(false);
    });
  });

  describe("Canvas 事件處理", () => {
    it("canvas:created 應新增 Canvas（skipCanvasCheck）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      canvasStore.activeCanvasId = "canvas-1";

      registerUnifiedListeners();

      const canvas = createMockCanvas({ id: "canvas-2", name: "New Canvas" });
      simulateEvent("canvas:created", {
        canvas,
      });

      expect(canvasStore.canvases.some((c) => c.id === "canvas-2")).toBe(true);
    });

    it("canvas:renamed 應重命名 Canvas（skipCanvasCheck）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const canvas = createMockCanvas({ id: "canvas-1", name: "Old Name" });
      canvasStore.canvases = [canvas];

      registerUnifiedListeners();

      simulateEvent("canvas:renamed", {
        canvasId: "canvas-1",
        newName: "New Name",
      });

      const updated = canvasStore.canvases.find((c) => c.id === "canvas-1");
      expect(updated?.name).toBe("New Name");
    });

    it("canvas:deleted 應移除 Canvas（skipCanvasCheck）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const canvas = createMockCanvas({ id: "canvas-2", name: "To Delete" });
      canvasStore.canvases = [canvas];

      registerUnifiedListeners();

      simulateEvent("canvas:deleted", {
        canvasId: "canvas-2",
      });

      expect(canvasStore.canvases.some((c) => c.id === "canvas-2")).toBe(false);
    });

    it("canvas:reordered 應重新排序 Canvases（skipCanvasCheck）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const canvas1 = createMockCanvas({ id: "canvas-1" });
      const canvas2 = createMockCanvas({ id: "canvas-2" });
      canvasStore.canvases = [canvas1, canvas2];

      registerUnifiedListeners();

      simulateEvent("canvas:reordered", {
        canvasIds: ["canvas-2", "canvas-1"],
      });

      expect(canvasStore.canvases[0]?.id).toBe("canvas-2");
      expect(canvasStore.canvases[1]?.id).toBe("canvas-1");
    });
  });

  describe("canvas:paste:result 批次操作", () => {
    it("應批次新增 Pods、Connections 和各種 Notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const connectionStore = useConnectionStore();
      const skillStore = useSkillStore();

      registerUnifiedListeners();

      const pod1 = createMockPod({ id: "pod-1" });
      const pod2 = createMockPod({ id: "pod-2" });
      const conn = createMockConnection({ id: "conn-1" });
      const skillNote = createMockNote("skill", {
        id: "skill-note-1",
      }) as SkillNote;

      simulateEvent("canvas:paste:result", {
        canvasId: "canvas-1",
        createdPods: [pod1, pod2],
        createdConnections: [conn],
        createdSkillNotes: [skillNote],
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(true);
      expect(podStore.pods.some((p) => p.id === "pod-2")).toBe(true);
      expect(connectionStore.connections.some((c) => c.id === "conn-1")).toBe(
        true,
      );
      expect(skillStore.notes.some((n) => n.id === "skill-note-1")).toBe(true);
    });
  });

  describe("workflow:clear:result 批次清空", () => {
    it("應清空多個 Pod 的訊息和輸出", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const chatStore = useChatStore();

      const pod1 = createMockPod({ id: "pod-1", output: ["line1", "line2"] });
      const pod2 = createMockPod({ id: "pod-2", output: ["line3"] });
      podStore.pods = [pod1, pod2];

      chatStore.messagesByPodId.set("pod-1", [
        { id: "msg-1", role: "user", content: "test", timestamp: "2024-01-01" },
      ]);

      registerUnifiedListeners();

      simulateEvent("workflow:clear:result", {
        canvasId: "canvas-1",
        clearedPodIds: ["pod-1", "pod-2"],
      });

      expect(podStore.getPodById("pod-1")?.output).toEqual([]);
      expect(podStore.getPodById("pod-2")?.output).toEqual([]);
      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages === undefined || messages.length === 0).toBe(true);
    });
  });

  describe("pod:chat:user-message 特殊處理", () => {
    it("應新增使用者訊息到 chatStore 並更新 Pod output", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const chatStore = useChatStore();
      const podStore = usePodStore();

      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:chat:user-message", {
        podId: "pod-1",
        messageId: "msg-1",
        content: "Hello, this is a test message",
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const messages = chatStore.messagesByPodId.get("pod-1");
      expect(messages).toHaveLength(1);
      expect(messages?.[0]).toMatchObject({
        id: "msg-1",
        role: "user",
        content: "Hello, this is a test message",
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.output[0]).toContain(
        "> Hello, this is a test message",
      );
    });

    it("應截斷過長的訊息內容（200字元）", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const chatStore = useChatStore();
      const podStore = usePodStore();

      const pod = createMockPod({ id: "pod-1", output: [] });
      podStore.pods = [pod];

      registerUnifiedListeners();

      const longContent = "a".repeat(250);
      simulateEvent("pod:chat:user-message", {
        podId: "pod-1",
        messageId: "msg-1",
        content: longContent,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const updatedPod = podStore.getPodById("pod-1");
      const output = updatedPod?.output[0] || "";
      expect(output).toMatch(/^> a{30,}\.\.\.$/);
    });
  });

  describe("removeDeletedNotes 批次刪除", () => {
    it("應移除所有類型的 deleted notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const skillStore = useSkillStore();
      const repositoryStore = useRepositoryStore();
      const commandStore = useCommandStore();
      const subAgentStore = useSubAgentStore();
      const mcpServerStore = useMcpServerStore();

      skillStore.notes = [
        createMockNote("skill", { id: "skill-note-1" }) as SkillNote,
      ] as any[];
      repositoryStore.notes = [
        createMockNote("repository", { id: "repo-note-1" }) as RepositoryNote,
      ] as any[];
      commandStore.notes = [
        createMockNote("command", { id: "cmd-note-1" }) as CommandNote,
      ] as any[];
      subAgentStore.notes = [
        createMockNote("subAgent", { id: "subagent-note-1" }) as SubAgentNote,
      ] as any[];
      mcpServerStore.notes = [
        createMockNote("mcpServer", { id: "mcp-note-1" }) as McpServerNote,
      ] as any[];

      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:deleted", {
        canvasId: "canvas-1",
        podId: "pod-1",
        deletedNoteIds: {
          skillNote: ["skill-note-1"],
          repositoryNote: ["repo-note-1"],
          commandNote: ["cmd-note-1"],
          subAgentNote: ["subagent-note-1"],
          mcpServerNote: ["mcp-note-1"],
        },
      });

      expect(skillStore.notes.length).toBe(0);
      expect(repositoryStore.notes.length).toBe(0);
      expect(commandStore.notes.length).toBe(0);
      expect(subAgentStore.notes.length).toBe(0);
      expect(mcpServerStore.notes.length).toBe(0);
    });
  });

  describe("MCP Server 事件處理", () => {
    it("mcp-server:created 應新增 MCP Server 到 mcpServerStore", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const mcpServerStore = useMcpServerStore();

      registerUnifiedListeners();

      const mcpServer: McpServer = {
        id: "mcp-1",
        name: "Test MCP",
        config: { command: "npx" },
      };
      simulateEvent("mcp-server:created", {
        canvasId: "canvas-1",
        mcpServer,
      });

      expect(
        mcpServerStore.availableItems.some(
          (i) => (i as McpServer).id === "mcp-1",
        ),
      ).toBe(true);
    });

    it("mcp-server:updated 應更新 mcpServerStore 中的 MCP Server", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const mcpServerStore = useMcpServerStore();
      const original: McpServer = {
        id: "mcp-1",
        name: "Original",
        config: { command: "npx" },
      };
      mcpServerStore.availableItems = [original];

      registerUnifiedListeners();

      const updated: McpServer = {
        id: "mcp-1",
        name: "Updated",
        config: { command: "node" },
      };
      simulateEvent("mcp-server:updated", {
        canvasId: "canvas-1",
        mcpServer: updated,
      });

      const item = mcpServerStore.availableItems.find(
        (i) => (i as McpServer).id === "mcp-1",
      ) as McpServer;
      expect(item?.name).toBe("Updated");
    });

    it("mcp-server:deleted 應移除 MCP Server 和相關 notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const mcpServerStore = useMcpServerStore();
      const mcpServer: McpServer = {
        id: "mcp-1",
        name: "Test MCP",
        config: { command: "npx" },
      };
      mcpServerStore.availableItems = [mcpServer];
      const note = createMockNote("mcpServer", {
        id: "mcp-note-1",
      }) as McpServerNote;
      mcpServerStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("mcp-server:deleted", {
        mcpServerId: "mcp-1",
        deletedNoteIds: ["mcp-note-1"],
      });

      expect(
        mcpServerStore.availableItems.some(
          (i) => (i as McpServer).id === "mcp-1",
        ),
      ).toBe(false);
      expect(mcpServerStore.notes.some((n) => n.id === "mcp-note-1")).toBe(
        false,
      );
    });

    it("mcp-server-note:created 應新增 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const mcpServerStore = useMcpServerStore();

      registerUnifiedListeners();

      const note = createMockNote("mcpServer", {
        id: "mcp-note-1",
      }) as McpServerNote;
      simulateEvent("mcp-server-note:created", {
        canvasId: "canvas-1",
        note,
      });

      expect(mcpServerStore.notes.some((n) => n.id === "mcp-note-1")).toBe(
        true,
      );
    });

    it("mcp-server-note:updated 應更新 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const mcpServerStore = useMcpServerStore();
      const note = createMockNote("mcpServer", {
        id: "mcp-note-1",
        name: "Old",
      }) as McpServerNote;
      mcpServerStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("mcp-server-note:updated", {
        canvasId: "canvas-1",
        note: { ...note, name: "New" },
      });

      const updated = mcpServerStore.notes.find((n) => n.id === "mcp-note-1");
      expect(updated?.name).toBe("New");
    });

    it("mcp-server-note:deleted 應移除 note", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const mcpServerStore = useMcpServerStore();
      const note = createMockNote("mcpServer", {
        id: "mcp-note-1",
      }) as McpServerNote;
      mcpServerStore.notes = [note] as any[];

      registerUnifiedListeners();

      simulateEvent("mcp-server-note:deleted", {
        canvasId: "canvas-1",
        noteId: "mcp-note-1",
      });

      expect(mcpServerStore.notes.some((n) => n.id === "mcp-note-1")).toBe(
        false,
      );
    });

    it("pod:mcp-server:bound 應更新 Pod", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:mcp-server:bound", {
        canvasId: "canvas-1",
        pod: { ...pod, mcpServerIds: ["mcp-1"] },
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.mcpServerIds).toContain("mcp-1");
    });

    it("pod:mcp-server:unbound 應更新 Pod", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:mcp-server:unbound", {
        canvasId: "canvas-1",
        pod: { ...pod, mcpServerIds: [] },
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.mcpServerIds).toEqual([]);
    });
  });

  describe("Integration 統一事件處理", () => {
    const createMockIntegrationApp = (
      overrides?: Partial<IntegrationApp>,
    ): IntegrationApp => ({
      id: "app-1",
      name: "Test App",
      connectionStatus: "disconnected",
      provider: "slack",
      resources: [],
      raw: {},
      ...overrides,
    });

    it("integration:app:created 應新增 App 到 integrationStore", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const integrationStore = useIntegrationStore();
      integrationStore.apps = { slack: [] };

      registerUnifiedListeners();

      simulateEvent("integration:app:created", {
        provider: "slack",
        app: {
          id: "app-1",
          name: "Test App",
          connectionStatus: "disconnected",
          channels: [],
        },
      });

      expect(
        integrationStore.apps["slack"]?.some((a) => a.id === "app-1"),
      ).toBe(true);
    });

    it("integration:app:created 無 app 時不應新增", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const integrationStore = useIntegrationStore();
      integrationStore.apps = { slack: [] };

      registerUnifiedListeners();

      simulateEvent("integration:app:created", { provider: "slack" });

      expect(integrationStore.apps["slack"]?.length).toBe(0);
    });

    it("integration:app:created 應忽略 Canvas 檢查", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const integrationStore = useIntegrationStore();
      canvasStore.activeCanvasId = "canvas-1";
      integrationStore.apps = { slack: [] };

      registerUnifiedListeners();

      simulateEvent("integration:app:created", {
        provider: "slack",
        app: {
          id: "app-1",
          name: "Test App",
          connectionStatus: "disconnected",
          channels: [],
        },
        canvasId: "canvas-other",
      });

      expect(
        integrationStore.apps["slack"]?.some((a) => a.id === "app-1"),
      ).toBe(true);
    });

    it("integration:app:deleted 應移除 App", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const integrationStore = useIntegrationStore();
      integrationStore.apps = { slack: [createMockIntegrationApp()] };

      registerUnifiedListeners();

      simulateEvent("integration:app:deleted", {
        provider: "slack",
        appId: "app-1",
      });

      expect(
        integrationStore.apps["slack"]?.some((a) => a.id === "app-1"),
      ).toBe(false);
    });

    it("integration:app:deleted 無 appId 時不應崩潰", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const integrationStore = useIntegrationStore();
      integrationStore.apps = { slack: [createMockIntegrationApp()] };

      registerUnifiedListeners();

      simulateEvent("integration:app:deleted", { provider: "slack" });

      expect(integrationStore.apps["slack"]?.length).toBe(1);
    });

    it("integration:connection:status:changed 應更新 App 狀態", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const integrationStore = useIntegrationStore();
      integrationStore.apps = {
        slack: [createMockIntegrationApp({ connectionStatus: "disconnected" })],
      };

      registerUnifiedListeners();

      simulateEvent("integration:connection:status:changed", {
        provider: "slack",
        appId: "app-1",
        connectionStatus: "connected",
        resources: [{ id: "ch-1", name: "general" }],
      });

      const app = integrationStore.apps["slack"]?.find((a) => a.id === "app-1");
      expect(app?.connectionStatus).toBe("connected");
      expect(app?.resources).toEqual([{ id: "ch-1", label: "#general" }]);
    });

    it("integration:connection:status:changed 一般狀態變更不應觸發 toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const integrationStore = useIntegrationStore();
      integrationStore.apps = {
        slack: [createMockIntegrationApp({ connectionStatus: "disconnected" })],
      };

      registerUnifiedListeners();

      simulateEvent("integration:connection:status:changed", {
        provider: "slack",
        appId: "app-1",
        connectionStatus: "connected",
      });

      expect(sharedMockToast).not.toHaveBeenCalled();
    });

    it("pod:integration:bound 應更新 Pod", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      const integrationBindings = [
        { provider: "slack", appId: "app-1", resourceId: "ch-1", extra: {} },
      ];
      simulateEvent("pod:integration:bound", {
        canvasId: "canvas-1",
        pod: { ...pod, integrationBindings },
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.integrationBindings).toEqual(integrationBindings);
    });

    it("pod:integration:unbound 應更新 Pod", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const integrationBindings = [
        { provider: "slack", appId: "app-1", resourceId: "ch-1", extra: {} },
      ];
      const pod = createMockPod({ id: "pod-1", integrationBindings });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:integration:unbound", {
        canvasId: "canvas-1",
        pod: { ...pod, integrationBindings: [] },
      });

      const updatedPod = podStore.getPodById("pod-1");
      expect(updatedPod?.integrationBindings).toEqual([]);
    });
  });
});
