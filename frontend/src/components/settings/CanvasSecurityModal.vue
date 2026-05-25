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
import { ScrollArea } from "@/components/ui/scroll-area";
import WarningBox from "@/components/ui/WarningBox.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSecurityStore } from "@/stores/securityStore";
import { updateCanvasPassword } from "@/services/securityApi";
import { useToast } from "@/composables/useToast";

interface Props {
  open: boolean;
  canvasId?: string | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const canvasStore = useCanvasStore();
const securityStore = useSecurityStore();
const { showSuccessToast } = useToast();
const { t } = useI18n();

const currentPassword = ref("");
const newPassword = ref("");
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);

const selectedCanvas = computed(() => {
  if (props.canvasId) {
    return (
      canvasStore.canvases.find((canvas) => canvas.id === props.canvasId) ??
      null
    );
  }

  return canvasStore.activeCanvas;
});

const resetForm = (): void => {
  currentPassword.value = "";
  newPassword.value = "";
  errorMessage.value = null;
};

const handleClose = (): void => {
  resetForm();
  emit("update:open", false);
};

const handleSetPassword = async (): Promise<void> => {
  if (!selectedCanvas.value || !newPassword.value.trim()) {
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = null;

  try {
    const result = await updateCanvasPassword(selectedCanvas.value.id, {
      action: "set",
      newPassword: newPassword.value,
    });
    if (result.canvas) {
      canvasStore.updateCanvasProtectionFromEvent(result.canvas);
      if (result.canvas.isProtected) {
        securityStore.addUnlockedCanvasId(selectedCanvas.value.id);
      }
    }
    showSuccessToast("Canvas", t("security.canvas.saved"));
    handleClose();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t("common.error.save");
  } finally {
    isSubmitting.value = false;
  }
};

const handleChangePassword = async (): Promise<void> => {
  if (
    !selectedCanvas.value ||
    !currentPassword.value.trim() ||
    !newPassword.value.trim()
  ) {
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = null;

  try {
    const result = await updateCanvasPassword(selectedCanvas.value.id, {
      action: "change",
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    if (result.canvas) {
      canvasStore.updateCanvasProtectionFromEvent(result.canvas);
      if (result.canvas.isProtected) {
        securityStore.addUnlockedCanvasId(selectedCanvas.value.id);
      }
    }
    showSuccessToast("Canvas", t("security.canvas.updated"));
    handleClose();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t("common.error.update");
  } finally {
    isSubmitting.value = false;
  }
};

const handleRemovePassword = async (): Promise<void> => {
  if (!selectedCanvas.value || !currentPassword.value.trim()) {
    return;
  }

  isSubmitting.value = true;
  errorMessage.value = null;

  try {
    const result = await updateCanvasPassword(selectedCanvas.value.id, {
      action: "remove",
      currentPassword: currentPassword.value,
    });
    if (result.canvas) {
      canvasStore.updateCanvasProtectionFromEvent(result.canvas);
    }
    showSuccessToast("Canvas", t("security.canvas.removed"));
    handleClose();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t("common.error.update");
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md max-h-[85vh] overflow-hidden p-0">
      <div class="flex max-h-[85vh] flex-col">
        <DialogHeader class="px-6 pt-6">
          <DialogTitle>{{ t("security.canvas.settingsTitle") }}</DialogTitle>
          <DialogDescription>
            {{ selectedCanvas?.name ?? t("security.canvas.noSelection") }}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea class="min-h-0 flex-1 px-6">
          <div class="space-y-4 pb-6">
            <WarningBox
              v-if="securityStore.showTransportRiskWarning"
              :title="t('security.transportWarning.title')"
              :description="t('security.transportWarning.description')"
            />

            <div
              v-if="selectedCanvas"
              class="space-y-3"
            >
              <p class="text-sm text-muted-foreground">
                {{
                  selectedCanvas.isProtected
                    ? t("security.canvas.statusProtected")
                    : t("security.canvas.statusOpen")
                }}
              </p>

              <Input
                v-if="selectedCanvas.isProtected"
                v-model="currentPassword"
                type="password"
                :placeholder="t('security.canvas.currentPassword')"
                :disabled="
                  isSubmitting || securityStore.isPasswordTransportBlocked
                "
              />

              <Input
                v-model="newPassword"
                type="password"
                :placeholder="
                  selectedCanvas.isProtected
                    ? t('security.canvas.newPassword')
                    : t('security.canvas.password')
                "
                :disabled="
                  isSubmitting || securityStore.isPasswordTransportBlocked
                "
              />

              <p
                v-if="errorMessage"
                class="text-sm text-destructive"
              >
                {{ errorMessage }}
              </p>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter class="gap-2 border-t border-border px-6 py-4">
          <Button
            variant="outline"
            @click="handleClose"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button
            v-if="selectedCanvas && !selectedCanvas.isProtected"
            :disabled="
              isSubmitting ||
                securityStore.isPasswordTransportBlocked ||
                !newPassword.trim()
            "
            @click="handleSetPassword"
          >
            {{ t("security.canvas.setPassword") }}
          </Button>
          <Button
            v-if="selectedCanvas?.isProtected"
            variant="outline"
            :disabled="
              isSubmitting ||
                securityStore.isPasswordTransportBlocked ||
                !currentPassword.trim()
            "
            @click="handleRemovePassword"
          >
            {{ t("security.canvas.removePassword") }}
          </Button>
          <Button
            v-if="selectedCanvas?.isProtected"
            :disabled="
              isSubmitting ||
                securityStore.isPasswordTransportBlocked ||
                !currentPassword.trim() ||
                !newPassword.trim()
            "
            @click="handleChangePassword"
          >
            {{ t("security.canvas.changePassword") }}
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>
