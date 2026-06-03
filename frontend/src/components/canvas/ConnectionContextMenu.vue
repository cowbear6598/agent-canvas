<script setup lang="ts">
import type { TriggerMode } from "@/types/connection";
import { Zap, Brain, ArrowRight } from "lucide-vue-next";
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useConnectionStore } from "@/stores/connectionStore";
import { useToast } from "@/composables/useToast";
import {
  DEFAULT_TOAST_DURATION_MS,
  SHORT_TOAST_DURATION_MS,
} from "@/lib/constants";
import TriggerModeRow from "./connectionMenu/TriggerModeRow.vue";
import BranchSettingsPanel from "./connectionMenu/BranchSettingsPanel.vue";

interface Props {
  position: { x: number; y: number };
  connectionId: string;
  currentTriggerMode: TriggerMode;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "trigger-mode-changed": [];
  "branch-mode-clicked": [];
}>();

const connectionStore = useConnectionStore();
const { toast } = useToast();
const { t } = useI18n();

const handleSetTriggerMode = async (targetMode: TriggerMode): Promise<void> => {
  if (targetMode === props.currentTriggerMode) {
    emit("close");
    return;
  }

  const result = await connectionStore.updateConnectionTriggerMode(
    props.connectionId,
    targetMode,
  );

  if (result) {
    const triggerModeLabels: Record<TriggerMode, string> = {
      auto: t("canvas.connectionContextMenu.triggerModeAutoLabel"),
      branch: t("canvas.connectionContextMenu.triggerModeBranchLabel"),
      direct: t("canvas.connectionContextMenu.triggerModeDirectLabel"),
    };
    toast({
      title: t("canvas.connectionContextMenu.triggerModeChanged"),
      description: t("canvas.connectionContextMenu.triggerModeChangedDesc", {
        mode: triggerModeLabels[targetMode],
      }),
      duration: SHORT_TOAST_DURATION_MS,
    });
    emit("trigger-mode-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.triggerModeChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

/** Branch 按鈕點擊：永遠 emit branch-mode-clicked，由 host 開啟 modal 與切換 trigger mode */
const handleBranchClick = (): void => {
  emit("branch-mode-clicked");
  emit("close");
};

const menuRef = ref<HTMLElement | null>(null);

const handleOutsideClick = (event: MouseEvent): void => {
  if (!menuRef.value) return;
  const menuEl = menuRef.value;
  if (menuEl?.contains(event.target as Node)) return;

  // 右鍵點選單外部：關閉選單，讓事件繼續傳播到 canvas/connection
  // 左鍵點選單外部：關閉選單並停止事件傳播
  if (event.button !== 2) {
    event.stopPropagation();
  }

  emit("close");
};

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
});
</script>

<template>
  <div
    ref="menuRef"
    class="bg-card border border-doodle-ink rounded-md p-1 fixed z-50"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
    @contextmenu.prevent
  >
    <TriggerModeRow
      :mode="'auto'"
      :current-mode="currentTriggerMode"
      :icon="Zap"
      :label="$t('canvas.connectionContextMenu.triggerModeAuto')"
      @click="handleSetTriggerMode('auto')"
    />

    <TriggerModeRow
      :mode="'direct'"
      :current-mode="currentTriggerMode"
      :icon="ArrowRight"
      :label="$t('canvas.connectionContextMenu.triggerModeDirect')"
      @click="handleSetTriggerMode('direct')"
    />

    <TriggerModeRow
      :mode="'branch'"
      :current-mode="currentTriggerMode"
      :icon="Brain"
      :label="$t('canvas.connectionContextMenu.triggerModeBranch')"
      @click="handleBranchClick"
    />

    <template v-if="currentTriggerMode === 'branch'">
      <div class="border-t border-border my-1" />
      <BranchSettingsPanel
        @edit-branch-settings="handleBranchClick"
      />
    </template>
  </div>
</template>
