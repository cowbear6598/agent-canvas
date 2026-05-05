<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUploadStore } from "@/stores/upload/uploadStore";
import { useCanvasStore } from "@/stores/canvasStore";
import { usePodFileDrop } from "@/composables/pod/usePodFileDrop";

// Props 定義
const props = defineProps<{
  podId: string;
}>();

const { t } = useI18n();

// 從 store 取得此 Pod 的上傳狀態
const uploadStore = useUploadStore();
const canvasStore = useCanvasStore();
const uploadState = computed(() => uploadStore.getUploadState(props.podId));

// 取 retryFailed（從 composable 拿，不直接呼 store）
const { retryFailed } = usePodFileDrop({
  disabled: () => false,
  getCanvasId: () => canvasStore.activeCanvasId,
});

// 上傳中或上傳失敗時才顯示覆蓋層
const isVisible = computed(
  () =>
    uploadState.value.status === "uploading" ||
    uploadState.value.status === "upload-failed",
);

// 失敗的檔案清單
const failedFiles = computed(() =>
  uploadState.value.files.filter((f) => f.status === "failed"),
);

// 判斷是否全部失敗，決定顯示哪個標題 i18n key
const isAllFailed = computed(
  () => failedFiles.value.length === uploadState.value.files.length,
);

// 取得失敗原因的 i18n 文案；找不到對應 key 時 fallback 顯示 unknown
const getFailureReasonText = (reason: string | undefined): string => {
  if (!reason) return t("pod.upload.failureReason.unknown");
  return t(`pod.upload.failureReason.${reason}`);
};

// 重試按鈕點擊處理
const handleRetry = async (): Promise<void> => {
  await retryFailed(props.podId);
};
</script>

<template>
  <!-- 僅在 uploading 或 upload-failed 時渲染，idle 時整個元件不出現 -->
  <div
    v-if="isVisible"
    class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm px-6"
  >
    <!-- 上傳中視圖 -->
    <template v-if="uploadState.status === 'uploading'">
      <!-- 上傳進度文案 -->
      <p class="text-sm font-mono text-foreground">
        {{
          t("pod.upload.uploading", { percent: uploadState.aggregateProgress })
        }}
      </p>

      <!-- 進度條：軌道 + 填充 -->
      <div
        class="w-full max-w-xs h-2 rounded-full bg-secondary overflow-hidden"
      >
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
          :style="{ width: `${uploadState.aggregateProgress}%` }"
        />
      </div>

      <!-- 檔案數量文案 -->
      <p class="text-xs font-mono text-muted-foreground">
        {{ t("pod.upload.fileCount", { count: uploadState.files.length }) }}
      </p>
    </template>

    <!-- 失敗視圖 -->
    <template v-else-if="uploadState.status === 'upload-failed'">
      <!-- 失敗標題：全部失敗 / 部分失敗 -->
      <p class="text-sm font-mono font-semibold text-destructive">
        {{
          isAllFailed
            ? t("pod.upload.failedAllTitle")
            : t("pod.upload.failedTitle")
        }}
      </p>

      <!-- 失敗檔案清單：超過高度時可捲動 -->
      <ScrollArea class="w-full max-w-xs max-h-40">
        <ul class="space-y-1">
          <li
            v-for="entry in failedFiles"
            :key="entry.id"
            class="flex flex-col gap-0.5 rounded px-2 py-1 bg-secondary"
          >
            <!-- 檔案名稱 -->
            <span class="text-xs font-mono text-foreground truncate">
              {{ entry.name }}
            </span>
            <!-- 失敗原因（對應 i18n key pod.upload.failureReason.<reason>） -->
            <span class="text-xs font-mono text-muted-foreground">
              {{ getFailureReasonText(entry.failureReason) }}
            </span>
          </li>
        </ul>
      </ScrollArea>

      <!-- 重試按鈕 -->
      <Button
        variant="outline"
        size="sm"
        @click="handleRetry"
      >
        {{ t("pod.upload.retry") }}
      </Button>
    </template>
  </div>
</template>
