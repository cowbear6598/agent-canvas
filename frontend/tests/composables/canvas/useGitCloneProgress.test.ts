import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import {
  webSocketMockFactory,
  simulateEvent,
  mockWebSocketClient,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useGitCloneProgress } from "@/composables/canvas/useGitCloneProgress";
import { useChatStore } from "@/stores/chat/chatStore";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { WebSocketResponseEvents } from "@/types/websocket";
import type {
  RepositoryGitCloneProgressPayload,
  RepositoryGitCloneResultPayload,
} from "@/types/websocket";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => {
    const repositoryStore = useRepositoryStore();
    const chatStore = useChatStore();
    return { repositoryStore, chatStore };
  },
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

describe("useGitCloneProgress", () => {
  setupStoreTest(() => {
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Git Clone 進度追蹤", () => {
    it("新增 clone 任務時應初始化任務狀態", () => {
      const { cloneTasks, addTask } = useGitCloneProgress();

      addTask("req-1", "test-repo");

      const task = cloneTasks.value.get("req-1");
      expect(task).toBeDefined();
      expect(task?.requestId).toBe("req-1");
      expect(task?.repoName).toBe("test-repo");
      expect(task?.progress).toBe(0);
      expect(task?.message).toBe("開始下載...");
      expect(task?.status).toBe("cloning");
    });

    it("接收進度更新應更新任務進度和訊息", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const progressPayload: RepositoryGitCloneProgressPayload = {
        requestId: "req-1",
        progress: 50,
        message: "下載中 50%",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
        progressPayload,
      );

      const task = cloneTasks.value.get("req-1");
      expect(task?.progress).toBe(50);
      expect(task?.message).toBe("下載中 50%");
      expect(task?.status).toBe("cloning");
    });

    it("任務狀態不是 cloning 時應忽略進度更新", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const task = cloneTasks.value.get("req-1");
      if (task) {
        task.status = "completed";
        task.progress = 100;
      }

      const progressPayload: RepositoryGitCloneProgressPayload = {
        requestId: "req-1",
        progress: 50,
        message: "這個不應該被更新",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
        progressPayload,
      );

      expect(task?.progress).toBe(100);
      expect(task?.message).not.toBe("這個不應該被更新");
    });
  });

  describe("Clone 完成", () => {
    it("成功完成應更新狀態為 completed 並顯示成功 Toast", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      const repositoryStore = useRepositoryStore();
      const loadRepositoriesSpy = vi
        .spyOn(repositoryStore, "loadRepositories")
        .mockResolvedValue();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: true,
        repository: { id: "repo-1", name: "test-repo" },
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.status).toBe("completed");
      expect(task?.progress).toBe(100);
      expect(task?.message).toBe("下載完畢");
      expect(loadRepositoriesSpy).toHaveBeenCalled();
    });

    it("成功完成後應在 1 秒後自動移除任務", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      const repositoryStore = useRepositoryStore();
      vi.spyOn(repositoryStore, "loadRepositories").mockResolvedValue();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: true,
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      expect(cloneTasks.value.has("req-1")).toBe(true);

      vi.advanceTimersByTime(1000);
      await nextTick();

      expect(cloneTasks.value.has("req-1")).toBe(false);
    });
  });

  describe("Clone 失敗", () => {
    it("失敗時應更新狀態為 failed 並顯示錯誤 Toast", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Network error",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.status).toBe("failed");
      expect(task?.message).toBe("網路連線失敗");
    });

    it("失敗後應在 2 秒後自動移除任務", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Some error",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      expect(cloneTasks.value.has("req-1")).toBe(true);

      vi.advanceTimersByTime(2000);
      await nextTick();

      expect(cloneTasks.value.has("req-1")).toBe(false);
    });
  });

  describe("錯誤訊息友善化", () => {
    it("ALREADY_EXISTS 錯誤應顯示「倉庫已存在」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "ALREADY_EXISTS",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("倉庫已存在");
    });

    it("認證錯誤應顯示「Token 權限不足」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Authentication failed",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("認證失敗，請確認 Token 設定");
    });

    it("404 錯誤應顯示「找不到倉庫」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Repository not found (404)",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("找不到倉庫");
    });

    it("網路錯誤應顯示「網路連線失敗」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Network timeout",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("網路連線失敗");
    });

    it("分支錯誤應顯示「指定的分支不存在」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Invalid ref specified",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("指定的分支不存在");
    });

    it("磁碟空間錯誤應顯示「磁碟空間不足」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Not enough disk space",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("磁碟空間不足");
    });

    it("未知錯誤應顯示原始錯誤訊息", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
        error: "Unknown error occurred",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("Unknown error occurred");
    });

    it("無錯誤訊息時應顯示「未知錯誤」", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "test-repo");

      const resultPayload: RepositoryGitCloneResultPayload = {
        requestId: "req-1",
        success: false,
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        resultPayload,
      );
      await nextTick();

      const task = cloneTasks.value.get("req-1");
      expect(task?.message).toBe("未知錯誤");
    });
  });

  describe("任務管理", () => {
    it("removeTask 應移除指定的任務", () => {
      const { cloneTasks, addTask, removeTask } = useGitCloneProgress();

      addTask("req-1", "repo-1");
      addTask("req-2", "repo-2");

      expect(cloneTasks.value.size).toBe(2);

      removeTask("req-1");

      expect(cloneTasks.value.size).toBe(1);
      expect(cloneTasks.value.has("req-1")).toBe(false);
      expect(cloneTasks.value.has("req-2")).toBe(true);
    });

    it("多個任務應能同時進行", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cloneTasks, addTask } = useGitCloneProgress();
      await nextTick();

      addTask("req-1", "repo-1");
      addTask("req-2", "repo-2");

      const progress1: RepositoryGitCloneProgressPayload = {
        requestId: "req-1",
        progress: 30,
        message: "Repo 1 at 30%",
      };

      const progress2: RepositoryGitCloneProgressPayload = {
        requestId: "req-2",
        progress: 70,
        message: "Repo 2 at 70%",
      };

      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
        progress1,
      );
      simulateEvent(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
        progress2,
      );

      const task1 = cloneTasks.value.get("req-1");
      const task2 = cloneTasks.value.get("req-2");

      expect(task1?.progress).toBe(30);
      expect(task1?.message).toBe("Repo 1 at 30%");
      expect(task2?.progress).toBe(70);
      expect(task2?.message).toBe("Repo 2 at 70%");
    });
  });

  describe("WebSocket 監聽器管理", () => {
    it("連線狀態為 connected 時應自動註冊監聽器", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "disconnected";

      useGitCloneProgress();

      expect(mockWebSocketClient.on).not.toHaveBeenCalled();

      chatStore.connectionStatus = "connected";
      await nextTick();

      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
        expect.any(Function),
      );
      expect(mockWebSocketClient.on).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        expect.any(Function),
      );
    });

    it("cleanupListeners 應移除所有監聽器", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { cleanupListeners } = useGitCloneProgress();
      await nextTick();

      cleanupListeners();

      expect(mockWebSocketClient.off).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
        expect.any(Function),
      );
      expect(mockWebSocketClient.off).toHaveBeenCalledWith(
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        expect.any(Function),
      );
    });

    it("重複呼叫 setupListeners 應只註冊一次", async () => {
      const chatStore = useChatStore();
      chatStore.connectionStatus = "connected";

      const { setupListeners } = useGitCloneProgress();
      await nextTick();

      mockWebSocketClient.on.mockClear();

      setupListeners();

      expect(mockWebSocketClient.on).not.toHaveBeenCalled();
    });
  });
});
