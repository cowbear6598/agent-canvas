import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  webSocketMockFactory,
  mockWebSocketClient,
  resetMockWebSocket,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import { setupStoreTest } from "@tests/helpers/testSetup";
import {
  createMockPod,
  createMockConnection,
  createMockNote,
  createMockCanvas,
} from "@tests/helpers/factories";
import {
  useUnifiedEventListeners,
  listeners,
} from "@/composables/useUnifiedEventListeners";
import { resetChatActionsCache } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useManagedMcpStore } from "@/stores/managedMcpStore";
import type { Pod, Connection, RepositoryNote, Canvas } from "@/types";
import type { IntegrationApp } from "@/types/integration";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/services/websocket/createWebSocketRequest", () => ({
  tryResolvePendingRequest: vi.fn().mockReturnValue(false),
  createWebSocketRequest: vi.fn(),
}));

const { sharedMockToast } = vi.hoisted(() => ({
  sharedMockToast: vi.fn(),
}));

const {
  mockListManagedMcpRegistry,
  mockInvalidateManagedMcpRegistryCache,
  mockInvalidatePodMcpAvailabilityCache,
} = vi.hoisted(() => ({
  mockListManagedMcpRegistry: vi.fn(),
  mockInvalidateManagedMcpRegistryCache: vi.fn(),
  mockInvalidatePodMcpAvailabilityCache: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: sharedMockToast,
  }),
}));

vi.mock("@/services/managedMcpApi", () => ({
  listManagedMcpRegistry: mockListManagedMcpRegistry,
  saveManagedMcpRegistry: vi.fn(),
  deleteManagedMcpRegistry: vi.fn(),
  invalidateManagedMcpRegistryCache: mockInvalidateManagedMcpRegistryCache,
  invalidatePodMcpAvailabilityCache: mockInvalidatePodMcpAvailabilityCache,
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
    mockListManagedMcpRegistry.mockReset();
    mockInvalidateManagedMcpRegistryCache.mockReset();
    mockInvalidatePodMcpAvailabilityCache.mockReset();
    sharedMockToast.mockClear();
  });

  afterEach(() => {
    const { unregisterUnifiedListeners } = useUnifiedEventListeners();
    unregisterUnifiedListeners();
    resetMockWebSocket();
    vi.clearAllMocks();
  });

  describe("registerUnifiedListeners / unregisterUnifiedListeners", () => {
    it("重複註冊應被防止", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();

      registerUnifiedListeners();

      mockWebSocketClient.on.mockClear();
      registerUnifiedListeners();

      expect(mockWebSocketClient.on).not.toHaveBeenCalled();
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
    it("自己的 Pod 建立事件不應額外顯示事件 Toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      mockTryResolvePendingRequest.mockReturnValue(true);

      registerUnifiedListeners();

      const pod = createMockPod({ id: "pod-1" });
      simulateEvent("pod:created", {
        canvasId: "canvas-1",
        requestId: "req-1",
        pod,
      });

      expect(podStore.pods.some((item) => item.id === "pod-1")).toBe(true);
      expect(sharedMockToast).not.toHaveBeenCalled();
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

    it("pod:deleted 應移除 Pod", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();

      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:deleted", {
        canvasId: "canvas-1",
        podId: "pod-1",
        deletedNoteIds: {},
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(false);
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

  describe("Repository Note 事件處理", () => {
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

    it("repository:memory-enabled:set 應同步更新 repository 與綁定 pod 的 repo memory 狀態", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const repositoryStore = useRepositoryStore();
      const podStore = usePodStore();
      repositoryStore.availableItems = [
        {
          id: "repo-1",
          name: "Test",
          repoMemoryEnabled: false,
          hasRepoMemory: true,
        },
      ];
      podStore.pods = [
        createMockPod({
          id: "pod-1",
          repositoryId: "repo-1",
          repoMemoryEnabled: false,
          hasRepoMemory: true,
        }),
      ];

      registerUnifiedListeners();

      simulateEvent("repository:memory-enabled:set", {
        canvasId: "canvas-1",
        repositoryId: "repo-1",
        repository: {
          id: "repo-1",
          repoMemoryEnabled: true,
          hasRepoMemory: true,
        },
        pods: [
          createMockPod({
            id: "pod-1",
            repositoryId: "repo-1",
            repoMemoryEnabled: true,
            hasRepoMemory: true,
          }),
        ],
      });

      expect(repositoryStore.availableItems[0]).toMatchObject({
        repoMemoryEnabled: true,
        hasRepoMemory: true,
      });
      expect(podStore.getPodById("pod-1")).toMatchObject({
        repoMemoryEnabled: true,
        hasRepoMemory: true,
      });
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

  describe("Command Note 事件處理已移除", () => {
    it("不再註冊 command note listeners", () => {
      const events = listeners.map((listener) => listener.event);

      expect(events).not.toContain("command:deleted");
      expect(events).not.toContain("command-note:created");
      expect(events).not.toContain("command-note:updated");
      expect(events).not.toContain("command-note:deleted");
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

    it("canvas:renamed 為 own operation 時應同步狀態但不額外顯示成功 Toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const canvas = createMockCanvas({ id: "canvas-1", name: "Old Name" });
      canvasStore.canvases = [canvas];
      mockTryResolvePendingRequest.mockReturnValue(true);

      registerUnifiedListeners();

      simulateEvent("canvas:renamed", {
        canvasId: "canvas-1",
        requestId: "req-rename-canvas",
        newName: "New Name",
      });

      const updated = canvasStore.canvases.find((c) => c.id === "canvas-1");
      expect(updated?.name).toBe("New Name");
      expect(sharedMockToast).not.toHaveBeenCalled();
    });

    it("canvas:renamed own operation 失敗時不應同步狀態或顯示成功 Toast", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const canvasStore = useCanvasStore();
      const canvas = createMockCanvas({ id: "canvas-1", name: "Old Name" });
      canvasStore.canvases = [canvas];
      mockTryResolvePendingRequest.mockReturnValue(true);

      registerUnifiedListeners();

      simulateEvent("canvas:renamed", {
        canvasId: "canvas-1",
        requestId: "req-rename-canvas",
        success: false,
        error: "Canvas password required",
        code: "CANVAS_PASSWORD_REQUIRED",
      });

      const updated = canvasStore.canvases.find((c) => c.id === "canvas-1");
      expect(updated?.name).toBe("Old Name");
      expect(sharedMockToast).not.toHaveBeenCalled();
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
    it("應批次新增 Pods 和 Connections", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const connectionStore = useConnectionStore();

      registerUnifiedListeners();

      const pod1 = createMockPod({ id: "pod-1" });
      const pod2 = createMockPod({ id: "pod-2" });
      const conn = createMockConnection({ id: "conn-1" });

      simulateEvent("canvas:paste:result", {
        canvasId: "canvas-1",
        createdPods: [pod1, pod2],
        createdConnections: [conn],
      });

      expect(podStore.pods.some((p) => p.id === "pod-1")).toBe(true);
      expect(podStore.pods.some((p) => p.id === "pod-2")).toBe(true);
      expect(connectionStore.connections.some((c) => c.id === "conn-1")).toBe(
        true,
      );
    });
  });

  describe("removeDeletedNotes 批次刪除", () => {
    it("應移除 repository notes", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const repositoryStore = useRepositoryStore();

      repositoryStore.notes = [
        createMockNote("repository", { id: "repo-note-1" }) as RepositoryNote,
      ] as any[];

      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];

      registerUnifiedListeners();

      simulateEvent("pod:deleted", {
        canvasId: "canvas-1",
        podId: "pod-1",
        deletedNoteIds: {
          repositoryNote: ["repo-note-1"],
        },
      });

      expect(repositoryStore.notes.length).toBe(0);
    });
  });

  describe("pod:plugins:set 事件處理", () => {
    it("canvasId 匹配且 success=true 時應呼叫 updatePodPlugins", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", pluginIds: [] });
      podStore.pods = [pod];
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      registerUnifiedListeners();

      simulateEvent("pod:plugins:set", {
        canvasId: "canvas-1",
        success: true,
        pod: { ...pod, pluginIds: ["plugin-a", "plugin-b"] },
      });

      expect(spy).toHaveBeenCalledWith("pod-1", ["plugin-a", "plugin-b"]);
    });

    it("success=false 時不應呼叫 updatePodPlugins", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", pluginIds: [] });
      podStore.pods = [pod];
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      registerUnifiedListeners();

      simulateEvent("pod:plugins:set", {
        canvasId: "canvas-1",
        success: false,
        pod: { ...pod, pluginIds: ["plugin-a"] },
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("canvasId 不匹配時不應呼叫 updatePodPlugins", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", pluginIds: [] });
      podStore.pods = [pod];
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      registerUnifiedListeners();

      simulateEvent("pod:plugins:set", {
        canvasId: "canvas-other",
        success: true,
        pod: { ...pod, pluginIds: ["plugin-a"] },
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("payload 缺少 canvasId 時不應呼叫 updatePodPlugins", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1", pluginIds: [] });
      podStore.pods = [pod];
      const spy = vi.spyOn(podStore, "updatePodPlugins");

      registerUnifiedListeners();

      simulateEvent("pod:plugins:set", {
        success: true,
        pod: { ...pod, pluginIds: ["plugin-a"] },
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("pod:mcp-server-names:updated 事件處理", () => {
    it("canvasId 匹配且 podId 存在時應呼叫 updatePodMcpServers", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const pod = createMockPod({ id: "pod-1" });
      podStore.pods = [pod];
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      registerUnifiedListeners();

      simulateEvent("pod:mcp-server-names:updated", {
        canvasId: "canvas-1",
        podId: "pod-1",
        mcpServerNames: ["server-a", "server-b"],
      });

      expect(spy).toHaveBeenCalledWith("pod-1", ["server-a", "server-b"]);
    });

    it("podId 缺失時不應呼叫 updatePodMcpServers", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      registerUnifiedListeners();

      simulateEvent("pod:mcp-server-names:updated", {
        canvasId: "canvas-1",
        mcpServerNames: ["server-a"],
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("canvasId 不匹配時不應呼叫 updatePodMcpServers", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      registerUnifiedListeners();

      simulateEvent("pod:mcp-server-names:updated", {
        canvasId: "canvas-other",
        podId: "pod-1",
        mcpServerNames: ["server-a"],
      });

      expect(spy).not.toHaveBeenCalled();
    });

    it("payload 缺少 canvasId 時不應呼叫 updatePodMcpServers", () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const podStore = usePodStore();
      const spy = vi.spyOn(podStore, "updatePodMcpServers");

      registerUnifiedListeners();

      simulateEvent("pod:mcp-server-names:updated", {
        podId: "pod-1",
        mcpServerNames: ["server-a"],
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("managed-mcp:registry:updated 事件處理", () => {
    it("registry updated 事件會觸發 cache invalidation", async () => {
      const { registerUnifiedListeners } = useUnifiedEventListeners();
      const managedMcpStore = useManagedMcpStore();
      managedMcpStore.loaded = true;
      mockListManagedMcpRegistry.mockResolvedValueOnce([
        {
          id: "registry-1",
          name: "context7",
          transport: "stdio",
          enabled: true,
          command: "npx",
          args: [],
          cwd: null,
          env: {},
          url: null,
          status: "healthy",
          lastError: null,
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ]);

      registerUnifiedListeners();

      simulateEvent("managed-mcp:registry:updated", {
        requestId: "req-managed-mcp",
        success: true,
        action: "saved",
        registryId: "registry-1",
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(mockInvalidateManagedMcpRegistryCache).toHaveBeenCalledOnce();
      expect(mockInvalidatePodMcpAvailabilityCache).toHaveBeenCalledOnce();
      expect(managedMcpStore.registry).toEqual([
        expect.objectContaining({ name: "context7" }),
      ]);
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
