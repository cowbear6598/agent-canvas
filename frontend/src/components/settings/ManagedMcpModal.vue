<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useManagedMcpStore } from "@/stores/managedMcpStore";
import { useToast } from "@/composables/useToast";
import type {
  ManagedMcpRegistryInput,
  ManagedMcpRegistryItem,
} from "@/types/mcp";
import McpRegistryList from "./managedMcp/McpRegistryList.vue";
import McpEditForm from "./managedMcp/McpEditForm.vue";

type PendingAction = "refresh" | "save" | "delete" | "test" | null;

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();
const managedMcpStore = useManagedMcpStore();
const { showSuccessToast, showErrorToast } = useToast();

const selectedId = ref<string | null>(null);
const pendingAction = ref<PendingAction>(null);

const selectedEntry = computed<ManagedMcpRegistryItem | null>(
  () =>
    managedMcpStore.registry.find((item) => item.id === selectedId.value) ??
    null,
);

function selectRegistryItem(item: ManagedMcpRegistryItem): void {
  selectedId.value = item.id;
}

function startCreateFlow(): void {
  selectedId.value = null;
}

function syncSelectionWithRegistry(): void {
  if (selectedId.value) {
    const matched = managedMcpStore.registry.find(
      (item) => item.id === selectedId.value,
    );
    if (matched) return;
  }

  const firstItem = managedMcpStore.registry[0];
  if (firstItem) {
    selectRegistryItem(firstItem);
    return;
  }

  startCreateFlow();
}

async function refreshRegistry(force = false): Promise<void> {
  if (managedMcpStore.loaded && !force) {
    syncSelectionWithRegistry();
    return;
  }

  pendingAction.value = "refresh";
  try {
    await managedMcpStore.refresh();
    syncSelectionWithRegistry();
  } finally {
    pendingAction.value = null;
  }
}

async function handleRefresh(): Promise<void> {
  await refreshRegistry(true);
}

async function handleSave(payload: ManagedMcpRegistryInput): Promise<void> {
  pendingAction.value = "save";
  try {
    const saved = await managedMcpStore.saveRegistry(payload);
    await managedMcpStore.refresh();

    if (saved) {
      const refreshed =
        managedMcpStore.registry.find((item) => item.id === saved.id) ?? saved;
      selectRegistryItem(refreshed);
    } else {
      syncSelectionWithRegistry();
    }
  } catch {
    // 錯誤訊息由 store.error 承接
  } finally {
    pendingAction.value = null;
  }
}

async function handleTest(): Promise<void> {
  const id = selectedId.value;
  if (!id) return;

  pendingAction.value = "test";
  try {
    const outcome = await managedMcpStore.testRegistryConnection(id);
    if (outcome.status === "healthy") {
      showSuccessToast("Mcp", t("managedMcp.actions.testSuccess"));
    } else {
      showErrorToast(
        "Mcp",
        t("managedMcp.actions.testFailed"),
        outcome.lastError ?? t("managedMcp.actions.testUnknownError"),
      );
    }
  } catch (err) {
    showErrorToast(
      "Mcp",
      t("managedMcp.actions.testFailed"),
      err instanceof Error ? err.message : undefined,
    );
  } finally {
    pendingAction.value = null;
  }
}

async function handleQuickToggle(
  item: ManagedMcpRegistryItem,
  enabled: boolean,
): Promise<void> {
  if (item.enabled === enabled) return;

  const basePayload = { id: item.id, name: item.name, enabled };
  const payload: ManagedMcpRegistryInput =
    item.transport === "stdio"
      ? {
          ...basePayload,
          transport: "stdio",
          command: item.command ?? "",
          args: item.args,
          cwd: item.cwd,
          env: item.env,
        }
      : {
          ...basePayload,
          transport: item.transport,
          url: item.url ?? "",
        };

  try {
    await managedMcpStore.saveRegistry(payload);
  } catch {
    // 錯誤訊息由 store.error 承接，避免 toggle 時 throw 影響 UI
  }
}

async function handleDelete(): Promise<void> {
  if (!selectedId.value) return;

  pendingAction.value = "delete";
  try {
    await managedMcpStore.deleteRegistryById(selectedId.value);
    syncSelectionWithRegistry();
  } catch {
    // 錯誤訊息由 store.error 承接
  } finally {
    pendingAction.value = null;
  }
}

function handleClose(): void {
  emit("update:open", false);
}

const showRefreshSpinner = computed(() => pendingAction.value === "refresh");
const showInitialLoading = computed(
  () =>
    managedMcpStore.loading &&
    pendingAction.value === "refresh" &&
    managedMcpStore.registry.length === 0,
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      pendingAction.value = null;
      return;
    }

    void refreshRegistry();
  },
  { immediate: true },
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle>{{ t("managedMcp.modal.title") }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("managedMcp.modal.description") }}
        </DialogDescription>
      </DialogHeader>

      <div
        data-testid="managed-mcp-modal"
        class="flex max-h-[72vh] flex-col gap-4 lg:flex-row"
      >
        <McpRegistryList
          :registry="managedMcpStore.registry"
          :selected-id="selectedId"
          :loading="managedMcpStore.loading"
          :show-refresh-spinner="showRefreshSpinner"
          :show-initial-loading="showInitialLoading"
          @select="selectRegistryItem"
          @create="startCreateFlow"
          @refresh="handleRefresh"
          @quick-toggle="handleQuickToggle"
        />

        <McpEditForm
          :entry="selectedEntry"
          :pending-action="pendingAction"
          :loading="managedMcpStore.loading"
          :store-error="managedMcpStore.error"
          @save="handleSave"
          @test="handleTest"
          @delete="handleDelete"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
