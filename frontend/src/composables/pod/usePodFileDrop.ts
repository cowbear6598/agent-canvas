import { ref, type Ref } from "vue";
import { useToast } from "@/composables/useToast";
import { t } from "@/i18n";
import { MAX_POD_DROP_FILE_BYTES } from "@/lib/constants";
import {
  uploadFile,
  UploadError,
  type UploadFailureReason,
} from "@/api/uploadApi";
import { useUploadStore } from "@/stores/upload/uploadStore";
import { useChatStore } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { isPodReadyToExecute } from "@/lib/podValidation";

type ValidateDropResult = { ok: true } | { ok: false; toastKey: string };

/**
 * 純函式：驗證 drop 事件中的 items 與 files 是否合法。
 * 回傳 { ok: true } 代表可繼續上傳；{ ok: false, toastKey } 代表應顯示對應 i18n 錯誤。
 *
 * 驗證順序：
 * 1. 資料夾偵測（透過 DataTransferItemList.webkitGetAsEntry）
 * 2. 空檔清單
 * 3. 單檔大小超過上限
 * 4. 檔案名稱路徑字元過濾
 */
export function validateDropFiles(
  items: DataTransferItemList | null | undefined,
  files: FileList | null | undefined,
): ValidateDropResult {
  // 1. 資料夾偵測
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]?.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        return { ok: false, toastKey: "errors.attachmentFolderNotAllowed" };
      }
    }
  }

  // 2. 空檔清單
  if (!files || files.length === 0) {
    return { ok: false, toastKey: "errors.attachmentEmpty" };
  }

  // 3. 單檔大小超過上限
  for (const file of Array.from(files)) {
    if (file.size > MAX_POD_DROP_FILE_BYTES) {
      return { ok: false, toastKey: "errors.attachmentTooLarge" };
    }
  }

  // 4. 檔案名稱路徑字元過濾（defense-in-depth：後端有雙重防禦，前端提前擋下）
  // 含 '/'、'\'、或 '..' 的名稱視為路徑穿越風險，整批拒絕
  for (const file of Array.from(files)) {
    if (
      file.name.includes("/") ||
      file.name.includes("\\") ||
      file.name.includes("..")
    ) {
      return { ok: false, toastKey: "errors.attachmentInvalidName" };
    }
  }

  return { ok: true };
}

interface UsePodFileDropOptions {
  /** getter，回傳 true 時所有事件 early return */
  disabled: () => boolean;
  /** 可注入的 canvas 解析器，預設使用目前 active canvas */
  getCanvasId?: () => string | null;
}

interface UsePodFileDropReturn {
  /** 拖入目標範圍時為 true，用於模板綁定高亮 class */
  isDragOver: Ref<boolean>;
  handleDragEnter: (event: DragEvent) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  /**
   * DragEvent 版本的 drop 處理入口，供 CanvasPod.vue `@drop` 事件綁定使用。
   * 內部取出 File 列表後呼叫 handleDrop。
   */
  handleDropEvent: (event: DragEvent, podId: string) => Promise<void>;
  /**
   * 主上傳入口，接受 podId 與 File 陣列。
   * 可直接由 PodUploadOverlay 等元件呼叫。
   */
  handleDrop: (podId: string, files: File[]) => Promise<void>;
  /** 重試目前 upload-failed 狀態中所有失敗的檔案 */
  retryFailed: (podId: string) => Promise<void>;
}

/**
 * 從 UploadError 取得對應的 UploadFailureReason。
 * 非 UploadError 型別的錯誤一律回傳 'unknown'。
 */
function resolveFailureReason(err: unknown): UploadFailureReason {
  if (err instanceof UploadError) return err.reason;
  return "unknown";
}

/**
 * 處理 Pod 聊天視窗的檔案拖曳上傳邏輯。
 * 採用 HTTP POST 並行上傳，支援聚合進度追蹤、單檔失敗隔離與失敗重試。
 */
export function usePodFileDrop(
  options: UsePodFileDropOptions,
): UsePodFileDropReturn {
  const { disabled, getCanvasId = defaultGetCanvasId } = options;
  const { toast } = useToast();

  const isDragOver = ref(false);

  const handleDragEnter = (event: DragEvent): void => {
    event.preventDefault();
    if (disabled()) return;
    isDragOver.value = true;
  };

  const handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    if (disabled()) return;
  };

  /**
   * 以 relatedTarget 是否仍在 currentTarget 內判斷是否真的離開，
   * 避免游標移到子元素時觸發假離開（dragenter/leave 抖動問題）。
   */
  const handleDragLeave = (event: DragEvent): void => {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget as Node | null;

    if (
      currentTarget &&
      relatedTarget &&
      currentTarget.contains(relatedTarget)
    ) {
      // 仍在容器內，忽略
      return;
    }

    isDragOver.value = false;
  };

  /**
   * 主上傳入口：對每個 file 並行呼叫 uploadApi.uploadFile，
   * 單檔失敗不中斷其他檔案上傳，結束後統一 finalize。
   *
   * 若 isUploading 為 true（上傳中再拖入），直接 return 忽略。
   */
  const handleDrop = async (podId: string, files: File[]): Promise<void> => {
    const uploadStore = useUploadStore();
    const chatStore = useChatStore();
    const podStore = usePodStore();
    const canvasId = getCanvasId();

    if (!canvasId) return;
    if (!isPodReadyToExecute(podStore.getPodById(podId))) {
      toast({
        title: t("pod.goal.title"),
        description: t("pod.goal.requiredDescription"),
        variant: "destructive",
      });
      return;
    }

    // 上傳中再拖入時忽略，避免覆蓋進行中的狀態
    if (uploadStore.isUploading(podId)) return;

    // 建立上傳 session，取得 sessionId 與各檔案的 entry id
    const uploadSessionId = uploadStore.startUpload(podId, files);

    // 取得剛建立的 file entries，讓後續操作能對應 fileId
    const podState = uploadStore.getUploadState(podId);
    const fileEntries = podState.files;

    // 對每個檔案並行上傳；個別包 try/catch，單檔失敗不中斷其他
    await Promise.allSettled(
      fileEntries.map(async (entry) => {
        try {
          await uploadFile(
            entry.file,
            canvasId,
            uploadSessionId,
            ({ loaded }) => {
              uploadStore.updateFileProgress(podId, entry.id, loaded);
            },
          );
          uploadStore.markFileSuccess(podId, entry.id);
        } catch (err) {
          const reason = resolveFailureReason(err);
          uploadStore.markFileFailed(podId, entry.id, reason);
        }
      }),
    );

    // 所有上傳結束後，依結果決定後續行為
    const result = uploadStore.finalizeUpload(podId);

    if (result.ok) {
      // 全部成功：送 WS 訊息，由後端根據 uploadSessionId 組裝附件
      try {
        await chatStore.sendMessageWithUploadSession(podId, uploadSessionId);
      } catch (error) {
        toast({
          title:
            error instanceof Error
              ? error.message
              : t("composable.chat.podDropSendFailed"),
          variant: "destructive",
        });
      }
    }
    // ok=false 時不送訊息，UI 由 PodUploadOverlay 顯示失敗清單
  };

  /**
   * DragEvent 版本的 drop 處理入口，供 CanvasPod.vue `@drop` 事件綁定使用。
   * 負責取出 File 列表、執行驗證，並呼叫主入口 handleDrop。
   */
  const handleDropEvent = async (
    event: DragEvent,
    podId: string,
  ): Promise<void> => {
    event.preventDefault();
    isDragOver.value = false;

    if (disabled()) return;

    const items = event.dataTransfer?.items;
    const files = event.dataTransfer?.files;

    // 驗證：資料夾、空檔、大小、名稱
    const validation = validateDropFiles(items, files);
    if (!validation.ok) {
      toast({ title: t(validation.toastKey), variant: "destructive" });
      return;
    }

    await handleDrop(podId, Array.from(files!));
  };

  /**
   * 重試失敗的檔案：
   * 1. 從 store 撈出所有 status=failed 的 entry
   * 2. 呼叫 markRetrying 將失敗檔重設為 pending，進度從 0% 起跳（成功檔排除在計算外）
   * 3. 重新對這些檔案執行上傳，重用既有的 uploadSessionId
   * 4. 結束後呼叫 finalize，全部成功則送 WS 訊息
   */
  const retryFailed = async (podId: string): Promise<void> => {
    const uploadStore = useUploadStore();
    const chatStore = useChatStore();
    const canvasId = getCanvasId();

    if (!canvasId) return;

    const podState = uploadStore.getUploadState(podId);
    const failedEntries = podState.files.filter((f) => f.status === "failed");

    // 沒有失敗檔案時不做任何事
    if (failedEntries.length === 0) return;

    const { uploadSessionId } = podState;

    // 將失敗檔案重設為 pending，切回 uploading 狀態，進度從 0% 起跳
    uploadStore.markRetrying(
      podId,
      failedEntries.map((f) => f.id),
    );

    // 只對失敗的檔案重新上傳；成功的檔案不重傳
    await Promise.allSettled(
      failedEntries.map(async (entry) => {
        try {
          await uploadFile(
            entry.file,
            canvasId,
            uploadSessionId,
            ({ loaded }) => {
              uploadStore.updateFileProgress(podId, entry.id, loaded);
            },
          );
          uploadStore.markFileSuccess(podId, entry.id);
        } catch (err) {
          const reason = resolveFailureReason(err);
          uploadStore.markFileFailed(podId, entry.id, reason);
        }
      }),
    );

    const result = uploadStore.finalizeUpload(podId);

    if (result.ok) {
      // 所有（含先前已成功的）檔案均成功，送 WS 訊息
      try {
        await chatStore.sendMessageWithUploadSession(podId, uploadSessionId);
      } catch {
        toast({
          title: t("composable.chat.podDropSendFailed"),
          variant: "destructive",
        });
      }
    }
    // ok=false：部分仍失敗，維持 upload-failed 狀態，UI 繼續顯示失敗清單
  };

  return {
    isDragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDropEvent,
    handleDrop,
    retryFailed,
  };
}

function defaultGetCanvasId(): string | null {
  return getActiveCanvasIdOrWarn("usePodFileDrop");
}
