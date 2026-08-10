<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUploadStore } from "@/stores/upload/uploadStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodFileDrop } from "@/composables/pod/usePodFileDrop";

const props = defineProps<{
  podId: string;
}>();

const { t } = useI18n();

const uploadStore = useUploadStore();
const canvasStore = useCanvasStore();
const uploadState = computed(() => uploadStore.getUploadState(props.podId));

// retryFailed 從 composable 取，不直接呼 store
const { retryFailed } = usePodFileDrop({
  disabled: () => false,
  getCanvasId: () => canvasStore.activeCanvasId,
});

const isVisible = computed(
  () =>
    uploadState.value.status === "uploading" ||
    uploadState.value.status === "upload-failed",
);

const failedFiles = computed(() =>
  uploadState.value.files.filter((f) => f.status === "failed"),
);

const isAllFailed = computed(
  () => failedFiles.value.length === uploadState.value.files.length,
);

// 找不到對應 i18n key 時 fallback 顯示 unknown
const getFailureReasonText = (reason: string | undefined): string => {
  if (!reason) return t("pod.upload.failureReason.unknown");
  return t(`pod.upload.failureReason.${reason}`);
};

const handleRetry = async (): Promise<void> => {
  await retryFailed(props.podId);
};
</script>

<template>
  <!-- 僅在 uploading 或 upload-failed 時渲染，idle 時整個元件不出現 -->
  <div
    v-if="isVisible"
    data-testid="pod-upload-overlay"
    class="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-2 overflow-hidden rounded-[4px] bg-background/95 p-2 backdrop-blur-sm"
    @mousedown.stop
    @dblclick.stop
    @contextmenu.prevent.stop
  >
    <!-- 上傳中視圖 -->
    <template v-if="uploadState.status === 'uploading'">
      <!-- 上傳進度文案 -->
      <p class="shrink-0 font-mono text-xs font-semibold text-foreground">
        {{
          t("pod.upload.uploading", { percent: uploadState.aggregateProgress })
        }}
      </p>

      <!-- 進度條：軌道 + 填充 -->
      <div
        class="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
          :style="{ width: `${uploadState.aggregateProgress}%` }"
        />
      </div>

      <!-- 檔案數量文案 -->
      <p class="shrink-0 font-mono text-[10px] text-muted-foreground">
        {{ t("pod.upload.fileCount", { count: uploadState.files.length }) }}
      </p>
    </template>

    <!-- 失敗視圖 -->
    <template v-else-if="uploadState.status === 'upload-failed'">
      <!-- 失敗標題：全部失敗 / 部分失敗 -->
      <p class="shrink-0 font-mono text-xs font-semibold leading-none text-destructive">
        {{
          isAllFailed
            ? t("pod.upload.failedAllTitle")
            : t("pod.upload.failedTitle")
        }}
      </p>

      <!-- 失敗檔案清單：超過高度時可捲動 -->
      <ScrollArea class="min-h-0 w-full flex-1">
        <ul class="space-y-1 pr-2">
          <li
            v-for="entry in failedFiles"
            :key="entry.id"
            class="flex flex-col gap-0.5 rounded bg-secondary px-2 py-1"
          >
            <!-- 檔案名稱 -->
            <span class="truncate font-mono text-[11px] leading-tight text-foreground">
              {{ entry.name }}
            </span>
            <!-- 失敗原因（對應 i18n key pod.upload.failureReason.<reason>） -->
            <span class="truncate font-mono text-[10px] leading-tight text-muted-foreground">
              {{ getFailureReasonText(entry.failureReason) }}
            </span>
          </li>
        </ul>
      </ScrollArea>

      <!-- 重試按鈕 -->
      <button
        type="button"
        class="pod-upload-retry-button shrink-0"
        @mousedown.stop
        @click.stop="handleRetry"
      >
        {{ t("pod.upload.retry") }}
      </button>
    </template>
  </div>
</template>
