<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { GripVertical, Upload } from "lucide-vue-next";
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
import ModalBackButton from "@/components/ui/ModalBackButton.vue";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import { type InstalledPlugin } from "@/types/plugin";

interface Props {
  open: boolean;
  showBackButton?: boolean;
}

const DRAG_ANIMATION_MS = 180;

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  back: [];
}>();

const store = useManagedPluginStore();
const { t, locale } = useI18n();

const githubRepoInput = ref<string>("");
const githubImportError = ref<string | null>(null);
const importingGithub = ref<boolean>(false);

const bundleUploadError = ref<string | null>(null);
const uploadingBundle = ref<boolean>(false);
const selectedBundleFile = ref<File | null>(null);
const bundleFileInput = ref<HTMLInputElement | null>(null);
const isBundleDragOver = ref<boolean>(false);

const updatingId = ref<string | null>(null);
const reordering = ref<boolean>(false);
const draggablePlugins = ref<InstalledPlugin[]>([]);

const confirmDeletePlugin = ref<InstalledPlugin | null>(null);
const showConfirmDialog = ref<boolean>(false);

const isBundleListBusy = computed(
  () =>
    store.loading ||
    importingGithub.value ||
    uploadingBundle.value ||
    updatingId.value !== null,
);
const isListMutationDisabled = computed(
  () => isBundleListBusy.value || reordering.value,
);
const duplicatedDisplayNames = computed<Set<string>>(() => {
  const counts = new Map<string, number>();
  for (const plugin of store.plugins) {
    const normalizedName = plugin.displayName.trim().toLocaleLowerCase();
    if (!normalizedName) continue;
    counts.set(normalizedName, (counts.get(normalizedName) ?? 0) + 1);
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
});

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(locale.value);
}

function getNormalizedDisplayName(plugin: InstalledPlugin): string {
  return plugin.displayName.trim().toLocaleLowerCase();
}

function shouldShowPluginSource(plugin: InstalledPlugin): boolean {
  return duplicatedDisplayNames.value.has(getNormalizedDisplayName(plugin));
}

function formatPluginSource(plugin: InstalledPlugin): string {
  if (plugin.source.type === "github") {
    return plugin.source.ref;
  }

  return `${t("pluginManager.list.localUploadSource")} · ${plugin.source.ref.slice(0, 12)}`;
}

function clearBundleSelection(): void {
  selectedBundleFile.value = null;
  if (bundleFileInput.value) {
    bundleFileInput.value.value = "";
  }
}

function resetModalLocalState(): void {
  githubImportError.value = null;
  bundleUploadError.value = null;
  githubRepoInput.value = "";
  isBundleDragOver.value = false;
  clearBundleSelection();
}

async function handleGithubImport(): Promise<void> {
  const repo = githubRepoInput.value.trim();
  if (!repo || isListMutationDisabled.value) return;

  githubImportError.value = null;
  importingGithub.value = true;
  try {
    await store.install(repo);
    githubRepoInput.value = "";
  } catch (err) {
    githubImportError.value =
      err instanceof Error ? err.message : t("pluginManager.github.importFailed");
  } finally {
    importingGithub.value = false;
  }
}

function openBundleFilePicker(): void {
  if (isListMutationDisabled.value) return;
  bundleFileInput.value?.click();
}

function handleBundleSelected(event: Event): void {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] ?? null;
  selectedBundleFile.value = file;
  bundleUploadError.value = null;
  isBundleDragOver.value = false;
}

function handleBundleDragOver(event: DragEvent): void {
  if (isListMutationDisabled.value) return;
  event.preventDefault();
  isBundleDragOver.value = true;
}

function handleBundleDragLeave(): void {
  isBundleDragOver.value = false;
}

function handleBundleDrop(event: DragEvent): void {
  if (isListMutationDisabled.value) return;
  event.preventDefault();
  isBundleDragOver.value = false;
  const file = event.dataTransfer?.files?.[0] ?? null;
  if (!file) return;
  selectedBundleFile.value = file;
  bundleUploadError.value = null;
}

async function handleBundleUpload(): Promise<void> {
  if (!selectedBundleFile.value || isListMutationDisabled.value) return;

  bundleUploadError.value = null;
  uploadingBundle.value = true;
  try {
    await store.upload(selectedBundleFile.value);
    clearBundleSelection();
  } catch (err) {
    bundleUploadError.value =
      err instanceof Error ? err.message : t("pluginManager.localUpload.uploadFailed");
  } finally {
    uploadingBundle.value = false;
  }
}

function canRefreshPlugin(plugin: InstalledPlugin): boolean {
  return plugin.source.type === "github";
}

async function handleUpdate(plugin: InstalledPlugin): Promise<void> {
  if (!canRefreshPlugin(plugin) || isListMutationDisabled.value) return;

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

async function handleReorder(): Promise<void> {
  if (isBundleListBusy.value || reordering.value) return;

  const ids = draggablePlugins.value.map((plugin) => plugin.id);
  reordering.value = true;
  try {
    await store.reorder(ids);
  } finally {
    reordering.value = false;
  }
}

function handleClose(): void {
  resetModalLocalState();
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
    if (!open) {
      resetModalLocalState();
      return;
    }
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
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ModalBackButton
            v-if="showBackButton"
            @back="emit('back')"
          />
          {{ t("pluginManager.modal.title") }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("pluginManager.modal.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-lg border border-border bg-muted/30 p-4">
          <div class="mb-3">
            <h3 class="text-sm font-semibold">
              {{ t("pluginManager.github.title") }}
            </h3>
          </div>
          <div class="flex gap-2">
            <input
              v-model="githubRepoInput"
              :placeholder="t('pluginManager.github.placeholder')"
              class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isListMutationDisabled"
              @keydown.enter="handleGithubImport"
            >
            <button
              class="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              :disabled="isListMutationDisabled || !githubRepoInput.trim()"
              @click="handleGithubImport"
            >
              {{
                importingGithub
                  ? t("pluginManager.actions.adding")
                  : t("common.add")
              }}
            </button>
          </div>
          <p
            v-if="githubImportError"
            class="mt-2 text-sm text-destructive"
          >
            {{ githubImportError }}
          </p>
        </section>

        <section class="rounded-lg border border-border bg-muted/30 p-4">
          <div class="mb-3">
            <h3 class="text-sm font-semibold">
              {{ t("pluginManager.localUpload.title") }}
            </h3>
          </div>
          <input
            ref="bundleFileInput"
            class="hidden"
            type="file"
            accept=".zip,application/zip"
            :disabled="isListMutationDisabled"
            @change="handleBundleSelected"
          >
          <div class="flex gap-2">
            <button
              type="button"
              class="flex min-h-10 flex-1 items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm transition-colors"
              :class="
                isBundleDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
              "
              :disabled="isListMutationDisabled"
              @click="openBundleFilePicker"
              @dragover="handleBundleDragOver"
              @dragleave="handleBundleDragLeave"
              @drop="handleBundleDrop"
            >
              <Upload
                :size="16"
                class="shrink-0"
              />
              <span class="truncate font-medium text-muted-foreground">
                {{
                  selectedBundleFile?.name ??
                    t("pluginManager.localUpload.dropzonePlaceholder")
                }}
              </span>
            </button>
            <button
              class="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              :disabled="isListMutationDisabled || !selectedBundleFile"
              @click="handleBundleUpload"
            >
              {{
                uploadingBundle
                  ? t("pluginManager.actions.adding")
                  : t("common.add")
              }}
            </button>
          </div>
          <p
            v-if="bundleUploadError"
            class="mt-2 text-sm text-destructive"
          >
            {{ bundleUploadError }}
          </p>
        </section>
      </div>

      <ScrollArea class="max-h-[52vh] pr-3">
        <div class="flex flex-col gap-2">
          <div
            v-if="store.loading && store.plugins.length === 0"
            class="py-8 text-center text-sm text-muted-foreground"
          >
            {{ t("pluginManager.list.loading") }}
          </div>

          <div
            v-else-if="!store.loading && store.plugins.length === 0"
            class="py-8 text-center text-sm text-muted-foreground"
          >
            {{ t("pluginManager.list.empty") }}
          </div>

          <VueDraggable
            v-else
            v-model="draggablePlugins"
            handle=".managed-plugin-card__handle"
            :animation="DRAG_ANIMATION_MS"
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
                  :title="t('pluginManager.list.dragHandle')"
                  :disabled="isListMutationDisabled"
                  @click.stop
                >
                  <GripVertical :size="16" />
                </button>
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate text-sm font-medium">{{
                    plugin.displayName
                  }}</span>
                  <span
                    v-if="shouldShowPluginSource(plugin)"
                    class="truncate text-xs text-muted-foreground"
                  >
                    {{ formatPluginSource(plugin) }}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {{
                      t("pluginManager.list.updatedAt", {
                        date: formatDate(plugin.updatedAt),
                      })
                    }}
                  </span>
                </div>
              </div>
              <div class="ml-4 flex shrink-0 gap-2">
                <button
                  v-if="canRefreshPlugin(plugin)"
                  class="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  :disabled="isListMutationDisabled"
                  @click="handleUpdate(plugin)"
                >
                  {{
                    updatingId === plugin.id
                      ? t("pluginManager.actions.updating")
                      : t("common.update")
                  }}
                </button>
                <button
                  class="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-sm font-medium text-destructive ring-offset-background transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  :disabled="isListMutationDisabled"
                  @click="openDeleteConfirm(plugin)"
                >
                  {{ t("common.delete") }}
                </button>
              </div>
            </div>
          </VueDraggable>

          <div
            v-if="reordering"
            class="text-center text-xs text-muted-foreground"
          >
            {{ t("pluginManager.list.reordering") }}
          </div>
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>

  <Dialog
    :open="showConfirmDialog"
    @update:open="cancelDelete"
  >
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ t("pluginManager.deleteDialog.title") }}</DialogTitle>
        <DialogDescription>
          {{
            t("pluginManager.deleteDialog.description", {
              name: confirmDeletePlugin?.displayName ?? "",
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :disabled="reordering || store.loading"
          @click="cancelDelete"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground ring-offset-background transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :disabled="isListMutationDisabled"
          @click="confirmDelete"
        >
          {{ t("pluginManager.deleteDialog.confirm") }}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
