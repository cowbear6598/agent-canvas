<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { Download, Unplug } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { downloadPodDirectory } from "@/services/podApi";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { generateUUID } from "@/services/utils";
import { usePodStore } from "@/stores";
import { getAllProviders } from "@/integration/providerRegistry";
import { useDownloadProgress } from "@/composables/canvas/useDownloadProgress";

interface Props {
  position: { x: number; y: number };
  podId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "connect-integration": [podId: string, provider: string];
  "disconnect-integration": [podId: string, provider: string];
}>();

const { t } = useI18n();

const pod = computed(() => usePodStore().getPodById(props.podId));
const bindings = computed(() => pod.value?.integrationBindings ?? []);
const providers = getAllProviders();

const downloadProgress = useDownloadProgress();

const menuRef = ref<HTMLElement | null>(null);

const isBound = (provider: string): boolean =>
  bindings.value.some((b) => b.provider === provider);

const handleOutsideClick = (event: MouseEvent): void => {
  const menuEl = menuRef.value;

  const insideMenu = menuEl?.contains(event.target as Node) ?? false;

  if (insideMenu) return;

  // 右鍵點選單外部：關閉選單，讓事件繼續傳播到 canvas/pod
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

const handleDownloadDirectory = (): void => {
  const canvasId = getActiveCanvasIdOrWarn("PodContextMenu");
  if (!canvasId) return;

  const taskId = generateUUID();
  const podName = pod.value?.name ?? props.podId;

  downloadProgress.addTask(taskId, podName);

  // 立即關閉選單，下載在背景執行
  emit("close");

  downloadPodDirectory(canvasId, props.podId, (downloadedBytes) => {
    downloadProgress.updateProgress(taskId, downloadedBytes);
  })
    .then(() => {
      downloadProgress.completeTask(taskId);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : t("canvas.podContextMenu.downloadDirectoryFailed");
      downloadProgress.failTask(taskId, message);
    });
};

const handleConnect = (provider: string): void => {
  emit("connect-integration", props.podId, provider);
  emit("close");
};

const handleDisconnect = (provider: string): void => {
  emit("disconnect-integration", props.podId, provider);
  emit("close");
};
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
    <button
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      @click="handleDownloadDirectory"
    >
      <Download :size="14" />
      <span class="font-mono">{{
        $t("canvas.podContextMenu.downloadDirectory")
      }}</span>
    </button>

    <template
      v-for="provider in providers"
      :key="provider.name"
    >
      <div class="my-1 border-t border-border" />

      <button
        v-if="!isBound(provider.name)"
        class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        @click="handleConnect(provider.name)"
      >
        <component
          :is="provider.icon"
          :size="14"
        />
        <span class="font-mono">{{
          $t("canvas.podContextMenu.connect", { label: provider.label })
        }}</span>
      </button>

      <button
        v-else
        class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        @click="handleDisconnect(provider.name)"
      >
        <Unplug :size="14" />
        <span class="font-mono">{{
          $t("canvas.podContextMenu.disconnect", { label: provider.label })
        }}</span>
      </button>
    </template>
  </div>
</template>
