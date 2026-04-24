<template>
  <Transition name="sidebar">
    <div
      v-if="open"
      ref="sidebarRef"
      class="fixed right-0 z-40 flex h-[calc(100vh-64px)] w-72 flex-col border-l border-border bg-background"
      style="top: 64px"
      @dragleave="handleSidebarDragLeave"
    >
      <div
        class="flex items-center justify-between border-b border-border px-4 py-3"
      >
        <h2 class="text-lg font-semibold">
          Canvas
        </h2>
        <button
          class="rounded-md p-1 hover:bg-accent"
          @click="handleClose"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <div class="border-b border-border p-4">
        <div
          v-if="isCreating"
          class="flex flex-col gap-2"
        >
          <input
            ref="createInputRef"
            v-model="newCanvasName"
            type="text"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Canvas name"
            @keydown.enter="handleCreate"
            @keydown.escape="cancelCreate"
            @blur="cancelCreate"
          >
        </div>
        <button
          v-else
          class="w-full rounded-md border border-dashed border-border px-3 py-2 text-sm hover:bg-accent"
          @click="startCreate"
        >
          <Plus class="mr-2 inline h-4 w-4" />
          New Canvas
        </button>
      </div>

      <ScrollArea class="flex-1">
        <div class="p-2">
          <div
            v-if="canvasStore.canvases.length === 0"
            class="px-2 py-8 text-center text-sm text-muted-foreground"
          >
            No canvases yet
          </div>
          <div
            v-for="(canvas, index) in canvasStore.canvases"
            :key="canvas.id"
            class="group relative mb-1"
            draggable="true"
            @dragstart="handleDragStart($event, index)"
            @dragend="handleDragEnd"
            @dragover="handleDragOver($event, index)"
            @dragenter="handleDragEnter($event, index)"
            @dragleave="handleDragLeave"
            @drop="handleDrop($event, index)"
          >
            <div
              class="flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent transition-opacity duration-200"
              :class="{
                'bg-accent': canvas.id === canvasStore.activeCanvasId,
                'opacity-50': draggedIndex === index,
                'cursor-grabbing': draggedIndex === index,
                'cursor-grab': draggedIndex !== index,
                'border-t-2 border-t-blue-500':
                  dragOverIndex === index &&
                  draggedIndex !== null &&
                  draggedIndex > index,
                'border-b-2 border-b-blue-500':
                  dragOverIndex === index &&
                  draggedIndex !== null &&
                  draggedIndex < index,
              }"
              @click="handleSwitchCanvas(canvas.id)"
            >
              <div
                v-if="renamingCanvasId === canvas.id"
                class="flex-1"
                @click.stop
              >
                <input
                  ref="renameInputRef"
                  v-model="renamingName"
                  type="text"
                  class="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                  @keydown.enter="handleRename(canvas.id)"
                  @keydown.escape="cancelRename"
                  @blur="cancelRename"
                >
              </div>
              <span
                v-else
                class="flex-1 text-sm"
              >{{ canvas.name }}</span>

              <div
                class="flex items-center gap-1 opacity-0 group-hover:opacity-100"
              >
                <button
                  class="rounded-md p-1 hover:bg-accent-foreground/10"
                  @click.stop="startRename(canvas.id, canvas.name)"
                >
                  <Pencil class="h-4 w-4" />
                </button>
                <button
                  class="rounded-md p-1 hover:bg-destructive/20"
                  @click.stop="handleDelete(canvas.id)"
                >
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  </Transition>

  <Dialog
    :open="showDeleteDialog"
    @update:open="showDeleteDialog = false"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("canvas.sidebar.confirmDelete") }}</DialogTitle>
        <DialogDescription>
          {{
            $t("canvas.sidebar.confirmDeleteMessage", {
              name: deleteTargetName,
            })
          }}
        </DialogDescription>
      </DialogHeader>

      <DialogFooter>
        <Button
          variant="outline"
          @click="showDeleteDialog = false"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="destructive"
          @click="confirmDelete"
        >
          {{
            $t("common.delete")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue";
import { X, Plus, Pencil, Trash2 } from "lucide-vue-next";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCanvasDragReorder } from "@/composables/canvas/useCanvasDragReorder";

interface Props {
  open: boolean;
}

interface Emits {
  (e: "update:open", value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const canvasStore = useCanvasStore();

const sidebarRef = ref<HTMLElement | undefined>(undefined);
const isCreating = ref(false);
const newCanvasName = ref("");
const createInputRef = ref<HTMLInputElement | undefined>(undefined);

const renamingCanvasId = ref<string | null>(null);
const renamingName = ref("");
const renameInputRef = ref<HTMLInputElement | HTMLInputElement[] | undefined>(
  undefined,
);

const showDeleteDialog = ref(false);
const deleteTargetId = ref<string | null>(null);
const deleteTargetName = ref("");

const {
  draggedIndex,
  dragOverIndex,
  handleDragStart,
  handleDragEnd,
  handleDragOver,
  handleDragEnter,
  handleDragLeave,
  handleDrop,
  handleSidebarDragLeave,
  cancelDrag,
} = useCanvasDragReorder(sidebarRef);

const handleClose = (): void => {
  emit("update:open", false);
};

const startCreate = (): void => {
  isCreating.value = true;
  newCanvasName.value = "";
  nextTick(() => {
    createInputRef.value?.focus();
  });
};

const cancelCreate = (): void => {
  isCreating.value = false;
  newCanvasName.value = "";
};

const handleCreate = async (): Promise<void> => {
  if (!newCanvasName.value.trim()) return;

  await canvasStore.createCanvas(newCanvasName.value.trim());
  cancelCreate();
};

const startRename = (canvasId: string, currentName: string): void => {
  renamingCanvasId.value = canvasId;
  renamingName.value = currentName;
  nextTick(() => {
    const el = Array.isArray(renameInputRef.value)
      ? renameInputRef.value[0]
      : renameInputRef.value;
    el?.focus();
  });
};

const cancelRename = (): void => {
  renamingCanvasId.value = null;
  renamingName.value = "";
};

const handleRename = async (canvasId: string): Promise<void> => {
  if (!renamingName.value.trim()) return;

  await canvasStore.renameCanvas(canvasId, renamingName.value.trim());
  cancelRename();
};

const handleDelete = (canvasId: string): void => {
  const canvas = canvasStore.canvases.find((canvas) => canvas.id === canvasId);
  if (!canvas) return;

  deleteTargetId.value = canvasId;
  deleteTargetName.value = canvas.name;
  showDeleteDialog.value = true;
};

const confirmDelete = (): void => {
  if (deleteTargetId.value) {
    canvasStore.deleteCanvas(deleteTargetId.value);
  }
  showDeleteDialog.value = false;
  deleteTargetId.value = null;
  deleteTargetName.value = "";
};

const handleSwitchCanvas = (canvasId: string): void => {
  if (renamingCanvasId.value || isCreating.value) return;

  canvasStore.switchCanvas(canvasId);
  emit("update:open", false);
};

const handleClickOutside = (event: MouseEvent): void => {
  const target = event.target;

  if (!(target instanceof Node)) {
    return;
  }

  if (sidebarRef.value?.contains(target)) {
    return;
  }

  const headerCanvasButton = document.querySelector("[data-canvas-toggle]");
  if (headerCanvasButton?.contains(target)) {
    return;
  }

  handleClose();
};

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    if (draggedIndex.value !== null) {
      event.preventDefault();
      cancelDrag();
      return;
    }

    if (!isCreating.value && !renamingCanvasId.value) {
      event.preventDefault();
      handleClose();
    }
  }
};

const removeDocumentListeners = (): void => {
  document.removeEventListener("mousedown", handleClickOutside);
  document.removeEventListener("keydown", handleKeyDown);
};

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      nextTick(() => {
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
      });
    } else {
      removeDocumentListeners();
      cancelCreate();
      cancelRename();
    }
  },
);

onUnmounted(() => {
  removeDocumentListeners();
});
</script>

<style scoped>
.sidebar-enter-active,
.sidebar-leave-active {
  transition: transform 0.2s ease-out;
}

.sidebar-enter-from {
  transform: translateX(100%);
}

.sidebar-leave-to {
  transform: translateX(100%);
}
</style>
