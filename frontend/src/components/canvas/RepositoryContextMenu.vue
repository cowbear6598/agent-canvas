<script setup lang="ts">
import { reactive, onMounted, onUnmounted, ref } from "vue";

import { GitBranch, Download } from "lucide-vue-next";
import { useRepositoryStore } from "@/stores/note/repositoryStore";
import { useToast } from "@/composables/useToast";
import { useI18n } from "vue-i18n";
import CreateWorktreeModal from "./CreateWorktreeModal.vue";
import BranchSelectModal from "./BranchSelectModal.vue";
import ForceCheckoutModal from "./ForceCheckoutModal.vue";
import DeleteBranchModal from "./DeleteBranchModal.vue";
import PullLatestConfirmModal from "./PullLatestConfirmModal.vue";

interface Props {
  position: { x: number; y: number };
  repositoryId: string;
  repositoryName: string;
  notePosition: { x: number; y: number };
  isWorktree: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "worktree-created": [];
  "branch-switched": [];
  "pull-started": [
    payload: {
      requestId: string;
      repositoryName: string;
      repositoryId: string;
    },
  ];
}>();

const repositoryStore = useRepositoryStore();
const { showErrorToast } = useToast();
const { t } = useI18n();

const uiState = reactive({
  isGit: false,
  isCheckingGit: true,
  menuVisible: true,
  isLoadingBranches: false,
});

const modalState = reactive({
  showWorktree: false,
  showBranch: false,
  showForceCheckout: false,
  showDeleteBranch: false,
  showPullConfirm: false,
});

const dataState = reactive({
  localBranches: [] as string[],
  currentBranch: "",
  worktreeBranches: [] as string[],
  targetBranch: "",
  branchToDelete: "",
});

const isMounted = ref(true);
const menuRef = ref<HTMLElement | null>(null);

const handleOutsideClick = (event: MouseEvent): void => {
  if (!uiState.menuVisible) return;

  const menuEl = menuRef.value;
  if (menuEl?.contains(event.target as Node)) return;

  // 右鍵點選單外部：關閉選單，讓事件繼續傳播到 canvas/repository
  // 左鍵點選單外部：關閉選單並停止事件傳播
  if (event.button !== 2) {
    event.stopPropagation();
  }

  emit("close");
};

onMounted(async () => {
  document.addEventListener("mousedown", handleOutsideClick, true);
  uiState.isCheckingGit = true;
  uiState.isGit = await repositoryStore.checkIsGit(props.repositoryId);
  uiState.isCheckingGit = false;
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
  isMounted.value = false;
});

type ModalKey = keyof typeof modalState;

const createModalCloseHandler =
  (key: ModalKey) =>
  (open: boolean): void => {
    modalState[key] = open;
    if (!open) emit("close");
  };

const handleWorktreeModalClose = createModalCloseHandler("showWorktree");
const handleBranchModalClose = createModalCloseHandler("showBranch");
const handleForceCheckoutModalClose =
  createModalCloseHandler("showForceCheckout");
const handleDeleteBranchModalClose =
  createModalCloseHandler("showDeleteBranch");
const handlePullConfirmModalClose = createModalCloseHandler("showPullConfirm");

const handleCreateWorktreeClick = (): void => {
  if (!uiState.isGit) return;
  uiState.menuVisible = false;
  modalState.showWorktree = true;
};

const handleWorktreeSubmit = async (worktreeName: string): Promise<void> => {
  const result = await repositoryStore.createWorktree(
    props.repositoryId,
    worktreeName,
    props.notePosition,
  );

  if (result.success) {
    emit("worktree-created");
    emit("close");
  }
};

const handleSwitchBranchClick = async (): Promise<void> => {
  if (!uiState.isGit || props.isWorktree || uiState.isLoadingBranches) return;

  uiState.menuVisible = false;
  uiState.isLoadingBranches = true;
  const result = await repositoryStore.getLocalBranches(props.repositoryId);
  uiState.isLoadingBranches = false;

  if (!result.success || !result.branches) {
    emit("close");
    return;
  }

  dataState.localBranches = result.branches;
  dataState.currentBranch = result.currentBranch ?? "";
  dataState.worktreeBranches = result.worktreeBranches ?? [];
  modalState.showBranch = true;
};

// 不提前關閉 branch modal，等 checkDirty 結果再決定，避免 async gap 中的 race condition
const handleBranchSelect = async (branchName: string): Promise<void> => {
  const dirtyResult = await repositoryStore.checkDirty(props.repositoryId);

  if (!isMounted.value) return;

  if (!dirtyResult.success) {
    modalState.showBranch = false;
    showErrorToast("Git", dirtyResult.error || t("canvas.checkDirtyFailed"));
    emit("close");
    return;
  }

  if (dirtyResult.isDirty) {
    // 同一個 tick 關閉 branch modal + 開啟 forceCheckout modal，避免 watcher 誤觸
    modalState.showBranch = false;
    dataState.targetBranch = branchName;
    modalState.showForceCheckout = true;
    return;
  }

  modalState.showBranch = false;
  await performCheckout(branchName, false);
};

const handleForceCheckout = async (): Promise<void> => {
  modalState.showForceCheckout = false;
  await performCheckout(dataState.targetBranch, true);
};

const performCheckout = async (
  branchName: string,
  force: boolean,
): Promise<void> => {
  await repositoryStore.checkoutBranch(props.repositoryId, branchName, force);
  emit("branch-switched");
  emit("close");
};

const handleBranchDelete = (branchName: string): void => {
  dataState.branchToDelete = branchName;
  modalState.showBranch = false;
  modalState.showDeleteBranch = true;
};

const handleDeleteBranchConfirm = async (): Promise<void> => {
  const result = await repositoryStore.deleteBranch(
    props.repositoryId,
    dataState.branchToDelete,
  );

  if (!isMounted.value) return;

  modalState.showDeleteBranch = false;

  if (result.success) {
    await reloadBranchList();
  } else {
    emit("close");
  }
};

const reloadBranchList = async (): Promise<void> => {
  const result = await repositoryStore.getLocalBranches(props.repositoryId);
  if (result.success && result.branches) {
    dataState.localBranches = result.branches;
    dataState.currentBranch = result.currentBranch || "";
    dataState.worktreeBranches = result.worktreeBranches || [];
    modalState.showBranch = true;
  }
};

const handlePullLatestClick = (): void => {
  if (!uiState.isGit) return;
  uiState.menuVisible = false;
  modalState.showPullConfirm = true;
};

const handlePullLatestConfirm = async (): Promise<void> => {
  const { requestId } = await repositoryStore.pullLatest(props.repositoryId);
  emit("pull-started", {
    requestId,
    repositoryName: props.repositoryName,
    repositoryId: props.repositoryId,
  });
  modalState.showPullConfirm = false;
  emit("close");
};
</script>

<template>
  <div
    v-if="uiState.menuVisible"
    ref="menuRef"
    class="bg-card border border-doodle-ink rounded-md p-1 fixed z-50"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
    @contextmenu.prevent
  >
    <button
      :disabled="!uiState.isGit || uiState.isCheckingGit"
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs',
        uiState.isGit && !uiState.isCheckingGit
          ? 'hover:bg-secondary'
          : 'opacity-50 cursor-not-allowed',
      ]"
      @click="handleCreateWorktreeClick"
    >
      <GitBranch
        :size="14"
        class="text-foreground"
      />
      <span class="font-mono text-foreground">{{
        $t("canvas.repositoryContextMenu.createWorktree")
      }}</span>
    </button>

    <button
      v-if="!isWorktree"
      :disabled="
        !uiState.isGit || uiState.isCheckingGit || uiState.isLoadingBranches
      "
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs',
        uiState.isGit && !uiState.isCheckingGit && !uiState.isLoadingBranches
          ? 'hover:bg-secondary'
          : 'opacity-50 cursor-not-allowed',
      ]"
      @click="handleSwitchBranchClick"
    >
      <GitBranch
        :size="14"
        class="text-foreground"
      />
      <span class="font-mono text-foreground">{{
        $t("canvas.repositoryContextMenu.switchBranch")
      }}</span>
    </button>

    <button
      v-if="!isWorktree"
      :disabled="!uiState.isGit || uiState.isCheckingGit"
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs',
        uiState.isGit && !uiState.isCheckingGit
          ? 'hover:bg-secondary'
          : 'opacity-50 cursor-not-allowed',
      ]"
      @click="handlePullLatestClick"
    >
      <Download
        :size="14"
        class="text-foreground"
      />
      <span class="font-mono text-foreground">{{
        $t("canvas.repositoryContextMenu.pullLatest")
      }}</span>
    </button>

    <p
      v-if="!uiState.isGit && !uiState.isCheckingGit"
      class="text-xs text-muted-foreground mt-0.5 ml-6"
    >
      {{ $t("canvas.repository.notGitRepo") }}
    </p>
  </div>

  <!-- 使用 Teleport 將 Modal 移到 body，避免父組件銷毀時 Modal 也消失 -->
  <Teleport to="body">
    <CreateWorktreeModal
      :open="modalState.showWorktree"
      :repository-name="repositoryName"
      @update:open="handleWorktreeModalClose"
      @submit="handleWorktreeSubmit"
    />

    <BranchSelectModal
      :open="modalState.showBranch"
      :branches="dataState.localBranches"
      :current-branch="dataState.currentBranch"
      :repository-name="repositoryName"
      :worktree-branches="dataState.worktreeBranches"
      @update:open="handleBranchModalClose"
      @select="handleBranchSelect"
      @delete="handleBranchDelete"
    />

    <ForceCheckoutModal
      :open="modalState.showForceCheckout"
      :target-branch="dataState.targetBranch"
      @update:open="handleForceCheckoutModalClose"
      @force-checkout="handleForceCheckout"
    />

    <DeleteBranchModal
      :open="modalState.showDeleteBranch"
      :branch-name="dataState.branchToDelete"
      @update:open="handleDeleteBranchModalClose"
      @confirm="handleDeleteBranchConfirm"
    />

    <PullLatestConfirmModal
      :open="modalState.showPullConfirm"
      @update:open="handlePullConfirmModalClose"
      @confirm="handlePullLatestConfirm"
    />
  </Teleport>
</template>
