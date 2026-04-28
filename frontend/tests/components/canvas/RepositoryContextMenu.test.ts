import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "../../helpers/mockWebSocket";
import { setupStoreTest } from "../../helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import RepositoryContextMenu from "@/components/canvas/RepositoryContextMenu.vue";

// ── WS 邊界 mock ──────────────────────────────────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── useToast：驗證元件層自己呼叫的 showErrorToast ────────────
const { mockShowErrorToast } = vi.hoisted(() => ({
  mockShowErrorToast: vi.fn(),
}));
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: mockShowErrorToast,
    toast: vi.fn(),
    dismiss: vi.fn(),
    toasts: { value: [] },
  }),
}));

// ── UI 元件 mock（避免複雜子元件 render 干擾）────────────────
vi.mock("lucide-vue-next", () => ({
  GitBranch: { name: "GitBranch", template: "<svg />" },
  Download: { name: "Download", template: "<svg />" },
}));
vi.mock("@/components/canvas/CreateWorktreeModal.vue", () => ({
  default: {
    name: "CreateWorktreeModal",
    props: ["open", "repositoryName"],
    emits: ["update:open", "submit"],
    template: "<div />",
  },
}));
vi.mock("@/components/canvas/BranchSelectModal.vue", () => ({
  default: {
    name: "BranchSelectModal",
    props: [
      "open",
      "branches",
      "currentBranch",
      "repositoryName",
      "worktreeBranches",
    ],
    emits: ["update:open", "select", "delete"],
    template: "<div />",
  },
}));
vi.mock("@/components/canvas/ForceCheckoutModal.vue", () => ({
  default: {
    name: "ForceCheckoutModal",
    props: ["open", "targetBranch"],
    emits: ["update:open", "force-checkout"],
    template: "<div />",
  },
}));
vi.mock("@/components/canvas/DeleteBranchModal.vue", () => ({
  default: {
    name: "DeleteBranchModal",
    props: ["open", "branchName"],
    emits: ["update:open", "confirm"],
    template: "<div />",
  },
}));
vi.mock("@/components/canvas/PullLatestConfirmModal.vue", () => ({
  default: {
    name: "PullLatestConfirmModal",
    props: ["open"],
    emits: ["update:open", "confirm"],
    template: "<div />",
  },
}));

// ── 預設 props ────────────────────────────────────────────────
const defaultProps = {
  position: { x: 100, y: 100 },
  repositoryId: "repo-123",
  repositoryName: "test-repo",
  notePosition: { x: 50, y: 50 },
  isWorktree: false,
};

function mountMenu(props = {}) {
  return mount(RepositoryContextMenu, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

describe("RepositoryContextMenu", () => {
  // 使用真實 repositoryStore + Pinia，只 mock WS 邊界
  setupStoreTest(() => {
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
    // onMounted 呼叫 checkIsGit，預設回傳 true
    mockCreateWebSocketRequest.mockResolvedValue({
      success: true,
      isGit: true,
    });
  });

  describe("render smoke — 元件可正常掛載", () => {
    it("帶入有效 props 應成功 render", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("handleBranchSelect — checkDirty 失敗時的 emit / toast 行為", () => {
    it("checkDirty 失敗（含 error 訊息）時元件應呼叫 showErrorToast", async () => {
      // checkIsGit 成功 → checkDirty 失敗
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: false, error: "無法取得 Git 狀態" }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
      };
      await vm.handleBranchSelect("feature");

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "Git",
        "無法取得 Git 狀態",
      );
    });

    it("checkDirty 失敗且無 error 訊息時應顯示預設錯誤文字", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: false }); // checkDirty 無 error

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
      };
      await vm.handleBranchSelect("feature");

      expect(mockShowErrorToast).toHaveBeenCalledWith(
        "Git",
        "檢查修改狀態失敗",
      );
    });

    it("checkDirty 失敗時應 emit close", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: false, error: "錯誤" }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
      };
      await vm.handleBranchSelect("feature");

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("checkDirty 成功且未修改（isDirty: false）時應執行 checkout，不顯示 errorToast", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: false }); // checkDirty
      // checkoutBranch 使用 websocketClient.emit（fire-and-forget），不需額外 mock

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
      };
      await vm.handleBranchSelect("feature");

      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });

    it("checkDirty 成功且 isDirty: true 時不應顯示 errorToast", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: true }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
      };
      await vm.handleBranchSelect("feature");

      expect(mockShowErrorToast).not.toHaveBeenCalled();
    });
  });

  describe("handleBranchSelect — isDirty: true 時的 ForceCheckoutModal 狀態", () => {
    it("checkDirty 返回 isDirty: true 時應開啟 ForceCheckoutModal", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: true }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
        modalState: { showForceCheckout: boolean };
      };
      await vm.handleBranchSelect("feature");

      expect(vm.modalState.showForceCheckout).toBe(true);
    });

    it("checkDirty 返回 isDirty: true 時應設定 targetBranch", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: true }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
        dataState: { targetBranch: string };
      };
      await vm.handleBranchSelect("feature");

      expect(vm.dataState.targetBranch).toBe("feature");
    });
  });

  describe("handleForceCheckout — force checkout 完整流程的 emit", () => {
    it("ForceCheckout 確認後應 emit branch-switched", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: true }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
        handleForceCheckout: () => Promise<void>;
      };

      await vm.handleBranchSelect("feature");
      await vm.handleForceCheckout();

      expect(wrapper.emitted("branch-switched")).toBeTruthy();
    });

    it("ForceCheckout 確認後應 emit close", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: true }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
        handleForceCheckout: () => Promise<void>;
      };

      await vm.handleBranchSelect("feature");
      await vm.handleForceCheckout();

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("performCheckout — 正常 checkout 的 emit", () => {
    it("isDirty: false 時 checkout 後應 emit branch-switched", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, isDirty: false }); // checkDirty

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchSelect: (branch: string) => Promise<void>;
      };
      await vm.handleBranchSelect("feature");

      expect(wrapper.emitted("branch-switched")).toBeTruthy();
    });
  });

  describe("handleBranchDelete — 刪除分支的 UI 狀態變化", () => {
    it("選擇刪除分支時應設定 branchToDelete 並開啟 DeleteBranchModal", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchDelete: (branch: string) => void;
        dataState: { branchToDelete: string };
        modalState: { showDeleteBranch: boolean; showBranch: boolean };
      };

      vm.handleBranchDelete("old-feature");

      expect(vm.dataState.branchToDelete).toBe("old-feature");
      expect(vm.modalState.showDeleteBranch).toBe(true);
      expect(vm.modalState.showBranch).toBe(false);
    });
  });

  describe("handleDeleteBranchConfirm — 刪除分支後的行為", () => {
    it("刪除失敗時應 emit close", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: false }); // deleteBranch

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleDeleteBranchConfirm: () => Promise<void>;
      };
      await vm.handleDeleteBranchConfirm();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("刪除成功時應呼叫 getLocalBranches 重新載入分支列表", async () => {
      mockCreateWebSocketRequest
        .mockResolvedValueOnce({ success: true, isGit: true }) // checkIsGit
        .mockResolvedValueOnce({ success: true, branchName: "feature-1" }) // deleteBranch
        .mockResolvedValueOnce({
          success: true,
          branches: ["main"],
          currentBranch: "main",
          worktreeBranches: [],
        }); // getLocalBranches

      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleDeleteBranchConfirm: () => Promise<void>;
      };
      await vm.handleDeleteBranchConfirm();

      // getLocalBranches 被呼叫（mockCreateWebSocketRequest 被呼叫 3 次）
      expect(mockCreateWebSocketRequest).toHaveBeenCalledTimes(3);
    });
  });

  describe("handlePullLatestConfirm — Pull 操作的 emit", () => {
    it("Pull 完成後應 emit close", async () => {
      // pullLatest 使用 websocketClient.emit（fire-and-forget），不需額外 mock
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handlePullLatestConfirm: () => Promise<void>;
      };
      await vm.handlePullLatestConfirm();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("Pull 完成後應 emit pull-started 並帶有 repositoryName 和 repositoryId", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handlePullLatestConfirm: () => Promise<void>;
      };
      await vm.handlePullLatestConfirm();

      expect(wrapper.emitted("pull-started")).toBeTruthy();
      const [payload] = wrapper.emitted("pull-started")![0] as [
        { requestId: string; repositoryName: string; repositoryId: string },
      ];
      expect(payload.repositoryName).toBe("test-repo");
      expect(payload.repositoryId).toBe("repo-123");
      expect(typeof payload.requestId).toBe("string");
    });
  });

  describe("Modal close handlers — 使用者取消時 emit close", () => {
    it("使用者取消 WorktreeModal 時應 emit close", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleWorktreeModalClose: (open: boolean) => void;
      };
      vm.handleWorktreeModalClose(false);

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("使用者取消 BranchModal 時應 emit close", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleBranchModalClose: (open: boolean) => void;
      };
      vm.handleBranchModalClose(false);

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("使用者取消 ForceCheckoutModal 時應 emit close", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleForceCheckoutModalClose: (open: boolean) => void;
      };
      vm.handleForceCheckoutModalClose(false);

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("使用者取消 DeleteBranchModal 時應 emit close", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleDeleteBranchModalClose: (open: boolean) => void;
      };
      vm.handleDeleteBranchModalClose(false);

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("使用者取消 PullConfirmModal 時應 emit close", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handlePullConfirmModalClose: (open: boolean) => void;
      };
      vm.handlePullConfirmModalClose(false);

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("Modal open 為 true 時不應 emit close", async () => {
      const wrapper = mountMenu();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        handleWorktreeModalClose: (open: boolean) => void;
      };
      vm.handleWorktreeModalClose(true);

      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });
});
