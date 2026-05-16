/**
 * usePodFileDrop 單元測試
 *
 * 涵蓋以下情境：
 * 1. DragEvent 驗證：空檔、資料夾、超大檔、disabled 時 early return
 * 2. handleDrop 主流程：並行上傳、單檔失敗不中斷、全成功送 WS、有失敗不送 WS
 * 3. isDragOver 狀態：dragenter / dragleave / drop 後正確切換
 * 4. retryFailed：只重傳失敗檔、全成功後送 WS、重試後仍有失敗則不送 WS
 * 5. 上傳中（isUploading=true）再拖入應被忽略
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePodFileDrop } from "@/composables/pod/usePodFileDrop";
import { MAX_POD_DROP_FILE_BYTES } from "@/lib/constants";
import type { UploadFileEntry } from "@/types/upload";

// ─────────────────────────────────────────────
// Hoisted mocks
// ─────────────────────────────────────────────

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

const mockGetPodById = vi.fn(() => ({
  id: "pod-001",
  goal: { todos: [{ id: "goal-1", text: "Ship it" }] },
  goalStatus: "ready",
  canExecute: true,
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// uploadStore mock
const mockIsUploading = vi.fn().mockReturnValue(false);
const mockStartUpload = vi.fn().mockReturnValue("session-123");
const mockUpdateFileProgress = vi.fn();
const mockMarkFileSuccess = vi.fn();
const mockMarkFileFailed = vi.fn();
const mockFinalizeUpload = vi
  .fn()
  .mockReturnValue({ ok: true, uploadSessionId: "session-123" });
const mockGetUploadState = vi.fn();
const mockMarkRetrying = vi.fn();

vi.mock("@/stores/upload/uploadStore", () => ({
  useUploadStore: () => ({
    isUploading: mockIsUploading,
    startUpload: mockStartUpload,
    updateFileProgress: mockUpdateFileProgress,
    markFileSuccess: mockMarkFileSuccess,
    markFileFailed: mockMarkFileFailed,
    finalizeUpload: mockFinalizeUpload,
    getUploadState: mockGetUploadState,
    markRetrying: mockMarkRetrying,
  }),
}));

// chatStore mock
const mockSendMessageWithUploadSession = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/chat/chatStore", () => ({
  useChatStore: () => ({
    sendMessageWithUploadSession: mockSendMessageWithUploadSession,
  }),
}));

vi.mock("@/stores/pod/podStore", () => ({
  usePodStore: () => ({
    getPodById: mockGetPodById,
  }),
}));

// uploadApi mock
const mockUploadFile = vi
  .fn()
  .mockResolvedValue({ filename: "file.txt", size: 100, mime: "text/plain" });

vi.mock("@/api/uploadApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/uploadApi")>();
  return {
    ...actual,
    uploadFile: (...args: Parameters<typeof mockUploadFile>) =>
      mockUploadFile(...args),
  };
});

// ─────────────────────────────────────────────
// 工具函式
// ─────────────────────────────────────────────

function createFile(
  name: string,
  sizeBytes: number,
  type = "text/plain",
): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

function createDataTransferItem(isDirectory: boolean): DataTransferItem {
  return {
    webkitGetAsEntry: vi.fn().mockReturnValue({ isDirectory }),
  } as unknown as DataTransferItem;
}

function createDropEvent(options: {
  files?: File[];
  hasDirectory?: boolean;
  items?: DataTransferItem[];
  currentTarget?: EventTarget | null;
  relatedTarget?: EventTarget | null;
}): DragEvent {
  const { files = [], hasDirectory = false } = options;

  const items: DataTransferItem[] = options.items
    ? options.items
    : [
        ...(hasDirectory ? [createDataTransferItem(true)] : []),
        ...files.map(() => createDataTransferItem(false)),
      ];

  const fileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  };
  for (let i = 0; i < files.length; i++) {
    (fileList as Record<string | number, unknown>)[i] = files[i];
  }

  const event = new Event("drop", { bubbles: true }) as DragEvent;

  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: fileList,
      items: {
        length: items.length,
        [Symbol.iterator]: function* () {
          for (const item of items) yield item;
        },
      } as unknown as DataTransferItemList,
      dropEffect: "copy",
    },
    writable: true,
  });

  if (options.currentTarget !== undefined) {
    Object.defineProperty(event, "currentTarget", {
      value: options.currentTarget,
      writable: true,
    });
  }
  if (options.relatedTarget !== undefined) {
    Object.defineProperty(event, "relatedTarget", {
      value: options.relatedTarget,
      writable: true,
    });
  }

  return event;
}

function createDragEvent(
  type: "dragenter" | "dragleave" | "dragover",
  options: {
    currentTarget?: EventTarget | null;
    relatedTarget?: EventTarget | null;
  } = {},
): DragEvent {
  const event = new Event(type, { bubbles: true }) as DragEvent;

  if (options.currentTarget !== undefined) {
    Object.defineProperty(event, "currentTarget", {
      value: options.currentTarget,
      writable: true,
    });
  }
  if (options.relatedTarget !== undefined) {
    Object.defineProperty(event, "relatedTarget", {
      value: options.relatedTarget,
      writable: true,
    });
  }

  return event;
}

/** 建立模擬的 UploadFileEntry */
function makeEntry(
  id: string,
  name: string,
  status: "pending" | "success" | "failed" = "pending",
): UploadFileEntry {
  return {
    id,
    file: createFile(name, 100),
    name,
    size: 100,
    loaded: 0,
    status,
  };
}

const TEST_POD_ID = "pod-001";
const TEST_CANVAS_ID = "canvas-001";

function createOptions(disabled = false) {
  return {
    disabled: () => disabled,
    getCanvasId: () => TEST_CANVAS_ID,
  };
}

// ─────────────────────────────────────────────
// 測試主體
// ─────────────────────────────────────────────

describe("usePodFileDrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPodById.mockReturnValue({
      id: TEST_POD_ID,
      goal: { todos: [{ id: "goal-1", text: "Ship it" }] },
      goalStatus: "ready",
      canExecute: true,
    });
    // 預設：未上傳中
    mockIsUploading.mockReturnValue(false);
    // 預設：startUpload 回傳 sessionId
    mockStartUpload.mockReturnValue("session-123");
    // 預設：取得 state 有兩個 pending entry
    mockGetUploadState.mockReturnValue({
      status: "uploading",
      uploadSessionId: "session-123",
      files: [makeEntry("f1", "a.txt"), makeEntry("f2", "b.txt")],
      aggregateProgress: 0,
    });
    // 預設：全成功
    mockFinalizeUpload.mockReturnValue({
      ok: true,
      uploadSessionId: "session-123",
    });
    // 預設：uploadFile 成功
    mockUploadFile.mockResolvedValue({
      filename: "file.txt",
      size: 100,
      mime: "text/plain",
    });
  });

  // ─────────────────────────────────────────────
  // DragEvent 驗證（handleDropEvent）
  // ─────────────────────────────────────────────

  describe("handleDropEvent 驗證", () => {
    it("拖入 0 個檔案時，應顯示 errors.attachmentEmpty toast，不觸發上傳", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions());
      const event = createDropEvent({ files: [] });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
      expect(mockStartUpload).not.toHaveBeenCalled();
    });

    it("拖入含資料夾條目時，應顯示 errors.attachmentFolderNotAllowed toast", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions());
      const event = createDropEvent({ hasDirectory: true });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
      expect(mockStartUpload).not.toHaveBeenCalled();
    });

    it("單檔超過 MAX_POD_DROP_FILE_BYTES 時，應顯示 errors.attachmentTooLarge toast", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions());
      const bigFile = createFile("big.bin", MAX_POD_DROP_FILE_BYTES + 1);
      const event = createDropEvent({ files: [bigFile] });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
      expect(mockStartUpload).not.toHaveBeenCalled();
    });

    it("disabled=true 時 drop 應直接 return，不觸發上傳", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions(true));
      const files = [createFile("file.txt", 100)];
      const event = createDropEvent({ files });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockStartUpload).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("合法檔案應觸發 startUpload，並在全成功後送 WS 訊息", async () => {
      // 設定 getUploadState 回傳單一 entry，對應 startUpload 後的狀態
      const entry = makeEntry("f1", "test.txt");
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: [entry],
        aggregateProgress: 0,
      });

      const { handleDropEvent } = usePodFileDrop(createOptions());
      const files = [createFile("test.txt", 100)];
      const event = createDropEvent({ files });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockStartUpload).toHaveBeenCalledWith(TEST_POD_ID, files);
      expect(mockMarkFileSuccess).toHaveBeenCalledWith(TEST_POD_ID, "f1");
      expect(mockFinalizeUpload).toHaveBeenCalledWith(TEST_POD_ID);
      expect(mockSendMessageWithUploadSession).toHaveBeenCalledWith(
        TEST_POD_ID,
        "session-123",
      );
    });
  });

  // ─────────────────────────────────────────────
  // handleDrop 主流程
  // ─────────────────────────────────────────────

  describe("handleDrop 主流程", () => {
    it("isUploading=true 時再次呼叫 handleDrop 應直接忽略", async () => {
      mockIsUploading.mockReturnValue(true);

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("file.txt", 100)]);

      expect(mockStartUpload).not.toHaveBeenCalled();
    });

    it("單檔上傳失敗時，應呼叫 markFileFailed 且 finalize 後不送 WS 訊息", async () => {
      const entry = makeEntry("f1", "bad.txt");
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: [entry],
        aggregateProgress: 0,
      });

      // 模擬上傳失敗
      mockUploadFile.mockRejectedValueOnce(new Error("網路錯誤"));

      // finalize 回傳有失敗
      mockFinalizeUpload.mockReturnValue({
        ok: false,
        failedFiles: [{ ...entry, status: "failed" }],
        uploadSessionId: "session-123",
      });

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("bad.txt", 100)]);

      expect(mockMarkFileFailed).toHaveBeenCalledWith(
        TEST_POD_ID,
        "f1",
        "unknown",
      );
      expect(mockSendMessageWithUploadSession).not.toHaveBeenCalled();
    });

    it("多檔部分失敗時，成功的仍呼叫 markFileSuccess，失敗的呼叫 markFileFailed", async () => {
      const entries = [makeEntry("f1", "ok.txt"), makeEntry("f2", "bad.txt")];
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: entries,
        aggregateProgress: 0,
      });

      // 第一個成功，第二個失敗
      mockUploadFile
        .mockResolvedValueOnce({
          filename: "ok.txt",
          size: 100,
          mime: "text/plain",
        })
        .mockRejectedValueOnce(new Error("逾時"));

      mockFinalizeUpload.mockReturnValue({
        ok: false,
        failedFiles: [{ ...entries[1], status: "failed" }],
        uploadSessionId: "session-123",
      });

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [
        createFile("ok.txt", 100),
        createFile("bad.txt", 100),
      ]);

      expect(mockMarkFileSuccess).toHaveBeenCalledWith(TEST_POD_ID, "f1");
      expect(mockMarkFileFailed).toHaveBeenCalledWith(
        TEST_POD_ID,
        "f2",
        "unknown",
      );
      expect(mockSendMessageWithUploadSession).not.toHaveBeenCalled();
    });

    it("全部成功時應送 WS 訊息，不顯示 toast", async () => {
      const entry = makeEntry("f1", "ok.txt");
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: [entry],
        aggregateProgress: 0,
      });

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("ok.txt", 100)]);

      expect(mockSendMessageWithUploadSession).toHaveBeenCalledWith(
        TEST_POD_ID,
        "session-123",
      );
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("sendMessageWithUploadSession 拋出例外時，應顯示 podDropSendFailed toast", async () => {
      const entry = makeEntry("f1", "ok.txt");
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: [entry],
        aggregateProgress: 0,
      });

      mockSendMessageWithUploadSession.mockRejectedValueOnce(
        new Error("WS 斷線"),
      );

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("ok.txt", 100)]);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    it("上傳進度回呼應呼叫 updateFileProgress", async () => {
      const entry = makeEntry("f1", "progress.txt");
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: [entry],
        aggregateProgress: 0,
      });

      // 模擬 uploadFile 呼叫 onProgress 後 resolve
      mockUploadFile.mockImplementationOnce(
        (
          _file: File,
          _canvasId: string,
          _sessionId: string,
          onProgress: (e: { loaded: number }) => void,
        ) => {
          onProgress({ loaded: 50 });
          return Promise.resolve({
            filename: "progress.txt",
            size: 100,
            mime: "text/plain",
          });
        },
      );

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("progress.txt", 100)]);

      expect(mockUpdateFileProgress).toHaveBeenCalledWith(
        TEST_POD_ID,
        "f1",
        50,
      );
    });
  });

  // ─────────────────────────────────────────────
  // isDragOver 狀態
  // ─────────────────────────────────────────────

  describe("isDragOver 狀態", () => {
    it("初始 isDragOver 應為 false", () => {
      const { isDragOver } = usePodFileDrop(createOptions());
      expect(isDragOver.value).toBe(false);
    });

    it("handleDragEnter 後 isDragOver 應變為 true", () => {
      const { isDragOver, handleDragEnter } = usePodFileDrop(createOptions());
      handleDragEnter(createDragEvent("dragenter"));
      expect(isDragOver.value).toBe(true);
    });

    it("disabled=true 時 dragenter 不應設定 isDragOver", () => {
      const { isDragOver, handleDragEnter } = usePodFileDrop(
        createOptions(true),
      );
      handleDragEnter(createDragEvent("dragenter"));
      expect(isDragOver.value).toBe(false);
    });

    it("handleDragLeave 離開容器後 isDragOver 應恢復 false", () => {
      const { isDragOver, handleDragEnter, handleDragLeave } =
        usePodFileDrop(createOptions());

      handleDragEnter(createDragEvent("dragenter"));
      expect(isDragOver.value).toBe(true);

      const containerEl = document.createElement("div");
      const leaveEvent = createDragEvent("dragleave", {
        currentTarget: containerEl,
        relatedTarget: document.createElement("span"), // 不在容器內
      });
      handleDragLeave(leaveEvent);

      expect(isDragOver.value).toBe(false);
    });

    it("handleDragLeave relatedTarget 在容器內時，isDragOver 不應重置（子元素抖動防護）", () => {
      const { isDragOver, handleDragEnter, handleDragLeave } =
        usePodFileDrop(createOptions());

      handleDragEnter(createDragEvent("dragenter"));
      expect(isDragOver.value).toBe(true);

      const containerEl = document.createElement("div");
      const childEl = document.createElement("span");
      containerEl.appendChild(childEl);

      const leaveEvent = createDragEvent("dragleave", {
        currentTarget: containerEl,
        relatedTarget: childEl,
      });
      handleDragLeave(leaveEvent);

      expect(isDragOver.value).toBe(true);
    });

    it("handleDropEvent 後 isDragOver 應重置為 false", async () => {
      const entry = makeEntry("f1", "test.txt");
      mockGetUploadState.mockReturnValue({
        status: "uploading",
        uploadSessionId: "session-123",
        files: [entry],
        aggregateProgress: 0,
      });

      const { isDragOver, handleDragEnter, handleDropEvent } =
        usePodFileDrop(createOptions());

      handleDragEnter(createDragEvent("dragenter"));
      expect(isDragOver.value).toBe(true);

      const files = [createFile("test.txt", 100)];
      await handleDropEvent(createDropEvent({ files }), TEST_POD_ID);

      expect(isDragOver.value).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // handleDragOver
  // ─────────────────────────────────────────────

  describe("handleDragOver 行為", () => {
    it("disabled=false 時，handleDragOver 應將 dropEffect 設為 'copy'", () => {
      const { handleDragOver } = usePodFileDrop(createOptions());
      const event = createDragEvent("dragover");
      const mockDataTransfer = { dropEffect: "none" as string };
      Object.defineProperty(event, "dataTransfer", {
        value: mockDataTransfer,
        writable: true,
      });

      handleDragOver(event);

      expect(mockDataTransfer.dropEffect).toBe("copy");
    });

    it("disabled=true 時，handleDragOver 不拋例外，isDragOver 不改變", () => {
      const { isDragOver, handleDragOver } = usePodFileDrop(
        createOptions(true),
      );
      const event = createDragEvent("dragover");

      expect(() => handleDragOver(event)).not.toThrow();
      expect(isDragOver.value).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // retryFailed
  // ─────────────────────────────────────────────

  describe("retryFailed", () => {
    it("沒有 failed 檔案時，retryFailed 應直接 return，不觸發任何上傳", async () => {
      mockGetUploadState.mockReturnValue({
        status: "upload-failed",
        uploadSessionId: "session-123",
        files: [makeEntry("f1", "ok.txt", "success")],
        aggregateProgress: 100,
      });

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(mockMarkRetrying).not.toHaveBeenCalled();
      expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("有 failed 檔案時，應呼叫 markRetrying 並對失敗檔重新上傳", async () => {
      const failedEntry = makeEntry("f2", "bad.txt", "failed");
      const successEntry = makeEntry("f1", "ok.txt", "success");

      mockGetUploadState.mockReturnValue({
        status: "upload-failed",
        uploadSessionId: "session-retry",
        files: [successEntry, failedEntry],
        aggregateProgress: 50,
      });

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      // 應只重試失敗的 entry
      expect(mockMarkRetrying).toHaveBeenCalledWith(TEST_POD_ID, ["f2"]);
      // 應只對失敗的檔案呼叫 uploadFile
      expect(mockUploadFile).toHaveBeenCalledTimes(1);
    });

    it("重試後全成功，應送 WS 訊息", async () => {
      const failedEntry = makeEntry("f2", "bad.txt", "failed");

      mockGetUploadState.mockReturnValue({
        status: "upload-failed",
        uploadSessionId: "session-retry",
        files: [failedEntry],
        aggregateProgress: 0,
      });

      mockFinalizeUpload.mockReturnValue({
        ok: true,
        uploadSessionId: "session-retry",
      });

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(mockSendMessageWithUploadSession).toHaveBeenCalledWith(
        TEST_POD_ID,
        "session-retry",
      );
    });

    it("重試後仍有失敗，不送 WS 訊息", async () => {
      const failedEntry = makeEntry("f2", "bad.txt", "failed");

      mockGetUploadState.mockReturnValue({
        status: "upload-failed",
        uploadSessionId: "session-retry",
        files: [failedEntry],
        aggregateProgress: 0,
      });

      // 上傳仍然失敗
      mockUploadFile.mockRejectedValueOnce(new Error("仍然失敗"));

      mockFinalizeUpload.mockReturnValue({
        ok: false,
        failedFiles: [{ ...failedEntry, status: "failed" }],
        uploadSessionId: "session-retry",
      });

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(mockSendMessageWithUploadSession).not.toHaveBeenCalled();
    });

    it("retryFailed 進度從 0% 開始且只計剩餘（失敗）檔案", async () => {
      // 模擬有一個成功、一個失敗的狀態，重試時進度只計失敗的那個
      const successEntry = makeEntry("f1", "ok.txt", "success");
      const failedEntry = makeEntry("f2", "retry.txt", "failed");

      mockGetUploadState.mockReturnValue({
        status: "upload-failed",
        uploadSessionId: "session-retry",
        files: [successEntry, failedEntry],
        aggregateProgress: 50,
      });

      // 模擬 uploadFile 呼叫 onProgress
      mockUploadFile.mockImplementationOnce(
        (
          _file: File,
          _canvasId: string,
          _sessionId: string,
          onProgress: (e: { loaded: number }) => void,
        ) => {
          onProgress({ loaded: 50 });
          return Promise.resolve({
            filename: "retry.txt",
            size: 100,
            mime: "text/plain",
          });
        },
      );

      mockFinalizeUpload.mockReturnValue({
        ok: true,
        uploadSessionId: "session-retry",
      });

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      // 重試流程只對失敗檔案呼叫 updateFileProgress
      expect(mockUpdateFileProgress).toHaveBeenCalledWith(
        TEST_POD_ID,
        "f2",
        50,
      );
      // 重試成功後應送 WS 訊息
      expect(mockSendMessageWithUploadSession).toHaveBeenCalledWith(
        TEST_POD_ID,
        "session-retry",
      );
    });
  });

  // ─────────────────────────────────────────────
  // 多 Pod 整合（E）
  // ─────────────────────────────────────────────

  describe("多 Pod 同時上傳互不影響", () => {
    it("兩個不同 podId 的 handleDrop 呼叫應各自獨立，互不影響進度", async () => {
      // Pod A
      const entryA = makeEntry("a1", "a.txt");
      // Pod B
      const entryB = makeEntry("b1", "b.txt");

      // getUploadState 根據 podId 回傳不同 state
      mockGetUploadState.mockImplementation((podId: string) => {
        if (podId === "pod-A") {
          return {
            status: "uploading",
            uploadSessionId: "session-A",
            files: [entryA],
            aggregateProgress: 0,
          };
        }
        return {
          status: "uploading",
          uploadSessionId: "session-B",
          files: [entryB],
          aggregateProgress: 0,
        };
      });

      // Pod A：startUpload 回傳 session-A
      // Pod B：startUpload 回傳 session-B
      mockStartUpload
        .mockReturnValueOnce("session-A")
        .mockReturnValueOnce("session-B");

      // 兩個 handleDrop 都成功
      mockFinalizeUpload
        .mockReturnValueOnce({ ok: true, uploadSessionId: "session-A" })
        .mockReturnValueOnce({ ok: true, uploadSessionId: "session-B" });

      const composableA = usePodFileDrop(createOptions());
      const composableB = usePodFileDrop(createOptions());

      // 同時啟動兩個 Pod 的上傳
      await Promise.all([
        composableA.handleDrop("pod-A", [createFile("a.txt", 100)]),
        composableB.handleDrop("pod-B", [createFile("b.txt", 100)]),
      ]);

      // 兩個 Pod 都應各自呼叫 startUpload
      expect(mockStartUpload).toHaveBeenCalledWith("pod-A", expect.any(Array));
      expect(mockStartUpload).toHaveBeenCalledWith("pod-B", expect.any(Array));

      // 兩個 Pod 都應送出 WS 訊息，且帶正確的 sessionId
      expect(mockSendMessageWithUploadSession).toHaveBeenCalledWith(
        "pod-A",
        "session-A",
      );
      expect(mockSendMessageWithUploadSession).toHaveBeenCalledWith(
        "pod-B",
        "session-B",
      );
    });
  });
});
