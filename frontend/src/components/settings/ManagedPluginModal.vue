<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { GripVertical } from "lucide-vue-next";
import { VueDraggable } from "vue-draggable-plus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import type { InstalledPlugin } from "@/types/plugin";

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const store = useManagedPluginStore();

const newRepo = ref<string>("");
const installError = ref<string | null>(null);
const installing = ref<boolean>(false);

const updatingId = ref<string | null>(null);
const reordering = ref<boolean>(false);
const draggablePlugins = ref<InstalledPlugin[]>([]);

const confirmDeletePlugin = ref<InstalledPlugin | null>(null);
const showConfirmDialog = ref<boolean>(false);

const isPluginListBusy = computed(
  () => store.loading || installing.value || updatingId.value !== null,
);
const isListMutationDisabled = computed(
  () => isPluginListBusy.value || reordering.value,
);

async function handleInstall(): Promise<void> {
  const repo = newRepo.value.trim();
  if (!repo || isListMutationDisabled.value) return;

  installError.value = null;
  installing.value = true;
  try {
    await store.install(repo);
    newRepo.value = "";
  } catch (err) {
    installError.value = err instanceof Error ? err.message : "安裝失敗";
  } finally {
    installing.value = false;
  }
}

async function handleUpdate(plugin: InstalledPlugin): Promise<void> {
  if (isListMutationDisabled.value) return;

  updatingId.value = plugin.id;
  try {
    await store.update(plugin.id);
  } finally {
    updatingId.value = null;
  }
}

function openDeleteConfirm(plugin: InstalledPlugin): void {
  if (isListMutationDisabled.value) return;

  confirmDeletePlugin.value = plugin;
  showConfirmDialog.value = true;
}

function cancelDelete(): void {
  showConfirmDialog.value = false;
  confirmDeletePlugin.value = null;
}

async function confirmDelete(): Promise<void> {
  if (!confirmDeletePlugin.value || isListMutationDisabled.value) return;

  try {
    await store.remove(confirmDeletePlugin.value.id);
  } finally {
    showConfirmDialog.value = false;
    confirmDeletePlugin.value = null;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("zh-TW");
}

async function handleReorder(): Promise<void> {
  if (isPluginListBusy.value || reordering.value) return;

  const ids = draggablePlugins.value.map((plugin) => plugin.id);
  reordering.value = true;
  try {
    await store.reorder(ids);
  } finally {
    reordering.value = false;
  }
}

function handleClose(): void {
  emit("update:open", false);
}

watch(
  () => store.plugins,
  (plugins) => {
    draggablePlugins.value = [...plugins];
  },
  { immediate: true },
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void store.refresh();
  },
  { immediate: true },
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Plugin 管理</DialogTitle>
        <DialogDescription class="sr-only">
          管理已安裝的 GitHub Plugin
        </DialogDescription>
      </DialogHeader>

      <!-- 安裝輸入區 -->
      <div class="flex flex-col gap-2">
        <div class="flex gap-2">
          <input
            v-model="newRepo"
            placeholder="owner/repo"
            class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="isListMutationDisabled"
            @keydown.enter="handleInstall"
          >
          <button
            class="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            :disabled="isListMutationDisabled || !newRepo.trim()"
            @click="handleInstall"
          >
            {{ installing ? "安裝中..." : "安裝" }}
          </button>
        </div>
        <p
          v-if="installError"
          class="text-sm text-destructive"
        >
          {{ installError }}
        </p>
      </div>

      <!-- Plugin 清單區 -->
      <ScrollArea class="max-h-[50vh] pr-3">
        <div class="flex flex-col gap-2">
          <!-- 載入中狀態 -->
          <div
            v-if="store.loading && store.plugins.length === 0"
            class="py-8 text-center text-sm text-muted-foreground"
          >
            載入中...
          </div>

          <!-- 空狀態 -->
          <div
            v-else-if="!store.loading && store.plugins.length === 0"
            class="py-8 text-center text-sm text-muted-foreground"
          >
            尚未安裝任何 plugin
          </div>

          <!-- Plugin 列表 -->
          <VueDraggable
            v-else
            v-model="draggablePlugins"
            handle=".managed-plugin-card__handle"
            :animation="180"
            :disabled="isListMutationDisabled"
            ghost-class="sortable-ghost"
            chosen-class="sortable-chosen"
            class="flex flex-col gap-2"
            @end="handleReorder"
          >
            <div
              v-for="plugin in draggablePlugins"
              :key="plugin.id"
              class="flex items-center justify-between rounded-md border border-border p-3"
            >
              <div class="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  class="managed-plugin-card__handle inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                  title="拖曳排序"
                  :disabled="isListMutationDisabled"
                  @click.stop
                >
                  <GripVertical :size="16" />
                </button>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate text-sm font-medium">{{
                    plugin.displayName
                  }}</span>
                  <span class="truncate text-xs text-muted-foreground">{{
                    plugin.githubRepo
                  }}</span>
                  <span class="text-xs text-muted-foreground">安裝於 {{ formatDate(plugin.installedAt) }}</span>
                </div>
              </div>
              <div class="ml-4 flex shrink-0 gap-2">
                <button
                  class="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  :disabled="isListMutationDisabled"
                  @click="handleUpdate(plugin)"
                >
                  {{ updatingId === plugin.id ? "更新中..." : "更新" }}
                </button>
                <button
                  class="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-sm font-medium text-destructive ring-offset-background transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  :disabled="isListMutationDisabled"
                  @click="openDeleteConfirm(plugin)"
                >
                  刪除
                </button>
              </div>
            </div>
          </VueDraggable>

          <div
            v-if="reordering"
            class="text-center text-xs text-muted-foreground"
          >
            排序保存中...
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>

  <!-- 刪除確認對話框 -->
  <Dialog
    :open="showConfirmDialog"
    @update:open="cancelDelete"
  >
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>確認刪除</DialogTitle>
        <DialogDescription>
          確認刪除 {{ confirmDeletePlugin?.displayName }}？已啟用此 plugin 的
          Pod 會自動移除勾選
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :disabled="reordering || store.loading"
          @click="cancelDelete"
        >
          取消
        </button>
        <button
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground ring-offset-background transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :disabled="isListMutationDisabled"
          @click="confirmDelete"
        >
          確認刪除
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
