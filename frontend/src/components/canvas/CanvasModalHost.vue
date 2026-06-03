<script setup lang="ts">
import BranchEditModal from "./BranchEditModal.vue";
import CreateRepositoryModal from "./CreateRepositoryModal.vue";
import CloneRepositoryModal from "./CloneRepositoryModal.vue";
import ConfirmDeleteModal from "./ConfirmDeleteModal.vue";
import RepositoryMemoryConfirmModal from "./RepositoryMemoryConfirmModal.vue";
import PodMemoryConfirmModal from "./PodMemoryConfirmModal.vue";
import MemoryViewerModal from "./MemoryViewerModal.vue";
import IntegrationConnectModal from "@/components/integration/IntegrationConnectModal.vue";

defineProps<{
  branchEditModal: {
    visible: boolean;
    connectionId: string;
    sourcePodId: string;
    isAlreadyBranch: boolean;
    initialLabel: string;
    initialDescription: string;
  };
  showCreateRepositoryModal: boolean;
  showCloneRepositoryModal: boolean;
  showDeleteModal: boolean;
  showDeleteMemoryModal: boolean;
  deleteTarget: {
    name: string;
    type: "repository";
  } | null;
  isDeleteTargetInUse: boolean;
  podMemoryConfirmModal: {
    visible: boolean;
    podId: string;
    podName: string;
  };
  repoMemoryConfirmModal: {
    visible: boolean;
    repositoryId: string;
    repositoryName: string;
  };
  memoryViewerModal: {
    visible: boolean;
    title: string;
    summary: string | null;
    summaryUpdatedAt: string | null;
    emptyMessage: string;
  };
  integrationConnectModal: {
    visible: boolean;
    podId: string;
    provider: string;
  };
}>();

const emit = defineEmits<{
  "update:branch-open": [open: boolean];
  "submit:branch": [payload: { label: string; description: string }];
  "update:create-repository-open": [open: boolean];
  "created:repository": [repository: { id: string; name: string }];
  "update:clone-repository-open": [open: boolean];
  "clone-started": [payload: { requestId: string; repoName: string }];
  "update:delete-open": [open: boolean];
  "confirm:delete": [];
  "update:delete-memory-open": [open: boolean];
  "confirm:delete-memory": [];
  "update:pod-memory-open": [open: boolean];
  "confirm:clear-pod-memory": [];
  "update:repo-memory-open": [open: boolean];
  "confirm:clear-repo-memory": [];
  "update:memory-viewer-open": [open: boolean];
  "update:integration-connect-open": [open: boolean];
}>();
</script>

<template>
  <BranchEditModal
    :open="branchEditModal.visible"
    :connection-id="branchEditModal.connectionId"
    :source-pod-id="branchEditModal.sourcePodId"
    :is-already-branch="branchEditModal.isAlreadyBranch"
    :initial-label="branchEditModal.initialLabel"
    :initial-description="branchEditModal.initialDescription"
    @update:open="(open) => emit('update:branch-open', open)"
    @submit="(payload) => emit('submit:branch', payload)"
  />

  <CreateRepositoryModal
    :open="showCreateRepositoryModal"
    @update:open="(open) => emit('update:create-repository-open', open)"
    @created="(repository) => emit('created:repository', repository)"
  />

  <CloneRepositoryModal
    :open="showCloneRepositoryModal"
    @update:open="(open) => emit('update:clone-repository-open', open)"
    @clone-started="(payload) => emit('clone-started', payload)"
  />

  <ConfirmDeleteModal
    :open="showDeleteModal"
    :item-name="deleteTarget?.name ?? ''"
    :is-in-use="isDeleteTargetInUse"
    :item-type="deleteTarget?.type ?? 'repository'"
    @update:open="(open) => emit('update:delete-open', open)"
    @confirm="emit('confirm:delete')"
  />

  <RepositoryMemoryConfirmModal
    :open="showDeleteMemoryModal"
    :repository-name="deleteTarget?.name ?? ''"
    mode="delete"
    @update:open="(open) => emit('update:delete-memory-open', open)"
    @confirm="emit('confirm:delete-memory')"
  />

  <PodMemoryConfirmModal
    :open="podMemoryConfirmModal.visible"
    :pod-name="podMemoryConfirmModal.podName"
    @update:open="(open) => emit('update:pod-memory-open', open)"
    @confirm="emit('confirm:clear-pod-memory')"
  />

  <RepositoryMemoryConfirmModal
    :open="repoMemoryConfirmModal.visible"
    :repository-name="repoMemoryConfirmModal.repositoryName"
    mode="clear"
    @update:open="(open) => emit('update:repo-memory-open', open)"
    @confirm="emit('confirm:clear-repo-memory')"
  />

  <MemoryViewerModal
    :open="memoryViewerModal.visible"
    :title="memoryViewerModal.title"
    :summary="memoryViewerModal.summary"
    :summary-updated-at="memoryViewerModal.summaryUpdatedAt"
    :empty-message="memoryViewerModal.emptyMessage"
    @update:open="(open) => emit('update:memory-viewer-open', open)"
  />

  <IntegrationConnectModal
    :open="integrationConnectModal.visible"
    :pod-id="integrationConnectModal.podId"
    :provider="integrationConnectModal.provider"
    @update:open="(open) => emit('update:integration-connect-open', open)"
  />
</template>
