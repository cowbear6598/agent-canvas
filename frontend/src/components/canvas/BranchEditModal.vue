<script setup lang="ts">
import { ref, watch, computed } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import {
  BRANCH_LABEL_MAX_LENGTH,
  BRANCH_DESCRIPTION_MAX_LENGTH,
} from "@/types/connection";
import { useConnectionStore } from "@/stores/connectionStore";

interface Props {
  open: boolean;
  /** 連線 ID；用於 store 端驗證 label 唯一性與送出更新 */
  connectionId: string;
  /** 來源 Pod ID；label 唯一性檢查需要 */
  sourcePodId: string;
  /** 目前已切換到 branch 模式（用於決定 Save 是否需要先切換 triggerMode） */
  isAlreadyBranch: boolean;
  /** 進入 modal 時預填的 label */
  initialLabel?: string;
  /** 進入 modal 時預填的 description */
  initialDescription?: string;
}

const props = withDefaults(defineProps<Props>(), {
  initialLabel: "",
  initialDescription: "",
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 使用者按下儲存；payload 為 trim 過的 label / description */
  submit: [payload: { label: string; description: string }];
}>();

const { t } = useI18n();
const connectionStore = useConnectionStore();

const label = ref("");
const description = ref("");

watch(
  () => props.open,
  (newOpen) => {
    if (newOpen) {
      label.value = props.initialLabel;
      description.value = props.initialDescription;
    }
  },
);

const labelValidationError = computed((): string | null => {
  const trimmed = label.value.trim();
  if (trimmed === "") return null;
  const result = connectionStore.validateBranchLabel(
    props.sourcePodId,
    props.connectionId,
    trimmed,
  );
  if (result.valid) return null;
  return t(`store.connection.${result.errorKey}`, {
    max: BRANCH_LABEL_MAX_LENGTH,
  });
});

const descriptionValidationError = computed((): string | null => {
  const result = connectionStore.validateBranchDescription(description.value);
  if (result.valid) return null;
  return t(`store.connection.${result.errorKey}`, {
    max: BRANCH_DESCRIPTION_MAX_LENGTH,
  });
});

const isSubmitDisabled = computed((): boolean => {
  if (label.value.trim() === "") return true;
  if (labelValidationError.value !== null) return true;
  if (descriptionValidationError.value !== null) return true;
  return false;
});

const handleSubmit = (): void => {
  if (isSubmitDisabled.value) return;
  emit("submit", {
    label: label.value.trim(),
    description: description.value.trim(),
  });
};

const handleClose = (): void => {
  emit("update:open", false);
};

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    handleSubmit();
  }
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {{ $t("canvas.branchEditModal.title") }}
        </DialogTitle>
        <DialogDescription>
          {{ $t("canvas.branchEditModal.description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Label 輸入區 -->
        <div class="space-y-1">
          <label class="text-xs font-mono text-muted-foreground">
            {{ $t("canvas.connectionContextMenu.branchLabel") }}
          </label>
          <input
            v-model="label"
            type="text"
            :maxlength="BRANCH_LABEL_MAX_LENGTH"
            :placeholder="
              $t('canvas.connectionContextMenu.branchLabelPlaceholder')
            "
            class="w-full px-3 py-2 text-sm font-mono rounded border-2 border-doodle-ink bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-doodle-ink/50"
            @keydown="handleKeyDown"
          >
          <div
            v-if="labelValidationError"
            class="text-xs text-destructive font-mono"
          >
            {{ labelValidationError }}
          </div>
        </div>

        <!-- Description 輸入區 -->
        <div class="space-y-1">
          <label class="text-xs font-mono text-muted-foreground">
            {{ $t("canvas.connectionContextMenu.branchDescription") }}
          </label>
          <textarea
            v-model="description"
            :maxlength="BRANCH_DESCRIPTION_MAX_LENGTH"
            :placeholder="
              $t('canvas.connectionContextMenu.branchDescriptionPlaceholder')
            "
            rows="4"
            class="w-full px-3 py-2 text-sm font-mono rounded border-2 border-doodle-ink bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-doodle-ink/50 resize-none doodle-textarea"
            @keydown="handleKeyDown"
          />
          <div
            v-if="descriptionValidationError"
            class="text-xs text-destructive font-mono"
          >
            {{ descriptionValidationError }}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{ $t("common.cancel") }}
        </Button>
        <Button
          variant="default"
          :disabled="isSubmitDisabled"
          @click="handleSubmit"
        >
          {{
            isAlreadyBranch
              ? $t("common.save")
              : $t("canvas.branchEditModal.confirmSwitch")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
