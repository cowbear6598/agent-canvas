<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Loader2 } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanvasStore } from "@/stores/canvasStore";
import { useI18n } from "vue-i18n";

interface Props {
  open: boolean;
  mode: "set" | "change" | "remove" | "verify";
  canvasId: string;
  canvasName: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  success: [];
}>();

const { t } = useI18n();
const canvasStore = useCanvasStore();

// 表單欄位
const password = ref("");
const confirmPassword = ref("");
const oldPassword = ref("");
const newPassword = ref("");
const confirmNewPassword = ref("");

// 狀態
const isSubmitting = ref(false);
const errorMessage = ref("");

// Dialog 標題
const dialogTitle = computed(() => {
  switch (props.mode) {
    case "set":
      return t("canvas.password.setTitle");
    case "change":
      return t("canvas.password.changeTitle");
    case "remove":
      return t("canvas.password.removeTitle");
    case "verify":
      return t("canvas.password.verifyTitle");
    default:
      return "";
  }
});

// 驗證錯誤
const validationError = computed(() => {
  if (props.mode === "set") {
    if (!password.value || !confirmPassword.value) return "";
    if (password.value !== confirmPassword.value) {
      return t("canvas.password.mismatch");
    }
  }
  if (props.mode === "change") {
    if (!newPassword.value || !confirmNewPassword.value) return "";
    if (newPassword.value !== confirmNewPassword.value) {
      return t("canvas.password.mismatch");
    }
  }
  return "";
});

// 是否可送出
const canSubmit = computed(() => {
  if (validationError.value) return false;
  if (props.mode === "set") {
    return !!password.value && !!confirmPassword.value;
  }
  if (props.mode === "change") {
    return (
      !!oldPassword.value && !!newPassword.value && !!confirmNewPassword.value
    );
  }
  if (props.mode === "remove") {
    return !!password.value;
  }
  if (props.mode === "verify") {
    return !!password.value;
  }
  return false;
});

// 關閉時清空狀態
watch(
  () => props.open,
  (newOpen) => {
    if (!newOpen) {
      clearForm();
    }
  },
);

const clearForm = (): void => {
  password.value = "";
  confirmPassword.value = "";
  oldPassword.value = "";
  newPassword.value = "";
  confirmNewPassword.value = "";
  errorMessage.value = "";
};

const handleClose = (): void => {
  emit("update:open", false);
};

const handleSubmit = async (): Promise<void> => {
  if (!canSubmit.value || isSubmitting.value) return;

  isSubmitting.value = true;
  errorMessage.value = "";

  try {
    if (props.mode === "set") {
      await canvasStore.setPassword(props.canvasId, password.value);
      emit("success");
      handleClose();
    } else if (props.mode === "change") {
      await canvasStore.changePassword(
        props.canvasId,
        oldPassword.value,
        newPassword.value,
      );
      emit("success");
      handleClose();
    } else if (props.mode === "remove") {
      await canvasStore.removePassword(props.canvasId, password.value);
      emit("success");
      handleClose();
    } else if (props.mode === "verify") {
      const success = await canvasStore.verifyPassword(
        props.canvasId,
        password.value,
      );
      if (success) {
        emit("success");
        handleClose();
      } else {
        errorMessage.value = t("canvas.password.verifyFailed");
      }
    }
  } catch (error) {
    console.error("[CanvasPasswordDialog] 送出表單時發生錯誤", error);
    errorMessage.value = t("common.error");
  } finally {
    isSubmitting.value = false;
  }
};

const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSubmit();
  }
};
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="max-w-md" @keydown="handleKeyDown">
      <DialogHeader>
        <DialogTitle>{{ dialogTitle }}：{{ canvasName }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4">
        <!-- set 模式：密碼 + 確認密碼 -->
        <template v-if="mode === 'set'">
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.password") }}
            </label>
            <Input
              v-model="password"
              type="password"
              :placeholder="t('canvas.password.password')"
              :disabled="isSubmitting"
              autofocus
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.confirmPassword") }}
            </label>
            <Input
              v-model="confirmPassword"
              type="password"
              :placeholder="t('canvas.password.confirmPassword')"
              :disabled="isSubmitting"
            />
          </div>
        </template>

        <!-- change 模式：舊密碼 + 新密碼 + 確認新密碼 -->
        <template v-else-if="mode === 'change'">
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.oldPassword") }}
            </label>
            <Input
              v-model="oldPassword"
              type="password"
              :placeholder="t('canvas.password.oldPassword')"
              :disabled="isSubmitting"
              autofocus
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.newPassword") }}
            </label>
            <Input
              v-model="newPassword"
              type="password"
              :placeholder="t('canvas.password.newPassword')"
              :disabled="isSubmitting"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.confirmNewPassword") }}
            </label>
            <Input
              v-model="confirmNewPassword"
              type="password"
              :placeholder="t('canvas.password.confirmNewPassword')"
              :disabled="isSubmitting"
            />
          </div>
        </template>

        <!-- remove 模式：當前密碼 -->
        <template v-else-if="mode === 'remove'">
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.password") }}
            </label>
            <Input
              v-model="password"
              type="password"
              :placeholder="t('canvas.password.password')"
              :disabled="isSubmitting"
              autofocus
            />
          </div>
        </template>

        <!-- verify 模式：密碼 -->
        <template v-else-if="mode === 'verify'">
          <p class="text-sm text-muted-foreground">
            {{ t("canvas.password.required") }}
          </p>
          <div class="space-y-2">
            <label class="text-sm font-medium">
              {{ t("canvas.password.password") }}
            </label>
            <Input
              v-model="password"
              type="password"
              :placeholder="t('canvas.password.password')"
              :disabled="isSubmitting"
              autofocus
            />
          </div>
        </template>

        <!-- 驗證錯誤 -->
        <p v-if="validationError" class="text-sm text-destructive">
          {{ validationError }}
        </p>

        <!-- 送出錯誤 -->
        <p v-if="errorMessage" class="text-sm text-destructive">
          {{ errorMessage }}
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="isSubmitting" @click="handleClose">
          {{ t("common.cancel") }}
        </Button>
        <Button
          variant="default"
          :disabled="!canSubmit || isSubmitting"
          @click="handleSubmit"
        >
          <Loader2 v-if="isSubmitting" class="mr-2 h-4 w-4 animate-spin" />
          {{ t("common.confirm") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
