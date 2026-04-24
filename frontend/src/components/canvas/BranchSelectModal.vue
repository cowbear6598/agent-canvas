<script setup lang="ts">
import { watch, computed } from "vue";
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
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-vue-next";
import { useToast } from "@/composables/useToast";
import { useModalForm } from "@/composables/useModalForm";
import { isValidBranchName } from "@/lib/validators";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  branches: string[];
  currentBranch: string;
  repositoryName: string;
  worktreeBranches?: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  select: [branchName: string];
  delete: [branchName: string];
}>();

const { t } = useI18n();
const { toast } = useToast();

const { inputValue: inputBranchName, resetForm } = useModalForm<string>({
  validator: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return t("canvas.branchSelect.nameRequired");
    if (!isValidBranchName(trimmed))
      return t("canvas.branchSelect.nameInvalid");
    return null;
  },
  onSubmit: async (name) => {
    emit("select", name.trim());
    return null;
  },
  onClose: () => emit("update:open", false),
});

const normalBranches = computed(() => {
  if (!props.worktreeBranches || props.worktreeBranches.length === 0) {
    return props.branches;
  }
  return props.branches.filter(
    (branch) => !props.worktreeBranches!.includes(branch),
  );
});

const hasWorktreeBranches = computed(() => {
  return props.worktreeBranches && props.worktreeBranches.length > 0;
});

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      resetForm();
    }
  },
);

const handleBranchClick = (branchName: string): void => {
  if (branchName === props.currentBranch) {
    return;
  }
  emit("select", branchName);
};

const handleInputSubmit = (): void => {
  const trimmedName = inputBranchName.value.trim();

  if (!trimmedName) {
    return;
  }

  if (!isValidBranchName(trimmedName)) {
    toast({
      title: t("canvas.branchSelect.nameFormatError"),
      description: t("canvas.branchSelect.nameInvalid"),
    });
    return;
  }

  emit("select", trimmedName);
};

const handleInputKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleInputSubmit();
  }
};

const handleClose = (): void => {
  emit("update:open", false);
};

const handleDeleteClick = (event: Event, branchName: string): void => {
  event.stopPropagation();
  emit("delete", branchName);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("canvas.branchSelect.title") }}</DialogTitle>
        <DialogDescription>
          {{ $t("canvas.branchSelect.description", { name: repositoryName }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex gap-2">
        <Input
          v-model="inputBranchName"
          :placeholder="$t('canvas.branchSelect.inputPlaceholder')"
          @keydown="handleInputKeydown"
        />
        <Button
          :disabled="!inputBranchName.trim()"
          @click="handleInputSubmit"
        >
          {{ $t("canvas.branchSelect.switchButton") }}
        </Button>
      </div>

      <div class="border-t my-4" />

      <ScrollArea class="max-h-60 pr-4">
        <div class="space-y-1">
          <div
            v-for="branch in normalBranches"
            :key="branch"
            :class="[
              'w-full flex items-center gap-2 px-3 py-2 font-mono text-sm rounded-md transition-colors group',
              branch === currentBranch
                ? 'bg-secondary text-muted-foreground'
                : 'hover:bg-secondary cursor-pointer',
            ]"
          >
            <button
              type="button"
              class="flex-1 text-left"
              :class="[
                branch === currentBranch ? 'cursor-default' : 'cursor-pointer',
              ]"
              @click="handleBranchClick(branch)"
            >
              {{ branch }}
              <span
                v-if="branch === currentBranch"
                class="ml-2 text-muted-foreground"
              >{{ $t("canvas.branchSelect.currentLabel") }}</span>
            </button>
            <button
              v-if="branch !== currentBranch"
              type="button"
              class="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
              @click="handleDeleteClick($event, branch)"
            >
              <Trash2
                :size="14"
                class="text-destructive"
              />
            </button>
          </div>

          <template v-if="hasWorktreeBranches">
            <div class="flex items-center gap-2 py-2">
              <div class="flex-1 border-t border-border" />
              <span class="text-xs text-muted-foreground">{{
                $t("canvas.branchSelect.worktreeOccupied")
              }}</span>
              <div class="flex-1 border-t border-border" />
            </div>

            <div
              v-for="branch in worktreeBranches"
              :key="`worktree-${branch}`"
              class="w-full flex items-center gap-2 px-3 py-2 font-mono text-sm rounded-md text-muted-foreground opacity-50 cursor-not-allowed"
            >
              <span class="flex-1">{{ branch }}</span>
            </div>
          </template>
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{ $t("common.cancel") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
