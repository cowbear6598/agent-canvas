<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSecurityStore } from "@/stores/securityStore";

const securityStore = useSecurityStore();
const canvasStore = useCanvasStore();
const { t } = useI18n();
const password = ref("");

const activeCanvasName = computed(() => {
  if (!securityStore.unlockingCanvasId) {
    return "";
  }

  return (
    canvasStore.canvases.find(
      (canvas) => canvas.id === securityStore.unlockingCanvasId,
    )?.name ?? ""
  );
});
const isUnlockDisabled = computed(
  () =>
    securityStore.isUnlockingCanvas ||
    securityStore.isPasswordTransportBlocked ||
    !password.value.trim(),
);

const handleClose = (): void => {
  password.value = "";
  securityStore.closeCanvasUnlockDialog();
};

const handleSubmit = async (): Promise<void> => {
  if (!password.value.trim() || securityStore.isUnlockingCanvas) {
    return;
  }

  try {
    await securityStore.unlockCanvas(password.value);
    password.value = "";
  } catch {
    // inline error handled by store
  }
};
</script>

<template>
  <Dialog
    :open="!!securityStore.unlockingCanvasId"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t("security.canvas.unlockTitle") }}</DialogTitle>
        <DialogDescription>
          {{ t("security.canvas.unlockDescription", { name: activeCanvasName }) }}
        </DialogDescription>
      </DialogHeader>

      <form
        class="space-y-4"
        @submit.prevent="handleSubmit"
      >
        <Input
          v-model="password"
          type="password"
          :placeholder="t('security.canvas.password')"
          :disabled="
            securityStore.isUnlockingCanvas ||
              securityStore.isPasswordTransportBlocked
          "
        />

        <p
          v-if="securityStore.lastUnlockError"
          class="text-sm text-destructive"
        >
          {{ securityStore.lastUnlockError }}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            @click="handleClose"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button
            type="submit"
            :disabled="isUnlockDisabled"
          >
            {{ t("security.canvas.unlockAction") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
