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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { usePodFileDrop } from "@/composables/pod/usePodFileDrop";
import { useCanvasStore } from "@/stores/canvasStore";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { useUploadStore } from "@/stores/upload/uploadStore";
import { MAX_POD_DROP_FILE_BYTES } from "@/lib/constants";
import { WebSocketRequestEvents } from "@/services/websocket";
import type { PodChatSendPayload } from "@/types/websocket";
import { startFakeWebSocketServer } from "@tests/helpers/fakeWebSocketServer";
import {
  connectChatStoreToFakeServer,
  disconnectChatStoreFromFakeServer,
  expectMessagePayload,
  waitForExpect,
} from "@tests/helpers/chatWebSocketFlowTestUtils";

// ─────────────────────────────────────────────
// Hoisted mocks
// ─────────────────────────────────────────────

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
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
  const file = new File([], name, { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

function createDataTransferItem(isDirectory: boolean): DataTransferItem {
  return {
    webkitGetAsEntry: vi.fn().mockReturnValue({ isDirectory }),
  } as unknown as DataTransferItem;
}

function createDataTransferItemList(
  items: DataTransferItem[],
): DataTransferItemList {
  const itemList = {
    length: items.length,
    item: (i: number) => items[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const item of items) yield item;
    },
  };

  for (let i = 0; i < items.length; i++) {
    (itemList as Record<string | number, unknown>)[i] = items[i];
  }

  return itemList as unknown as DataTransferItemList;
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
      items: createDataTransferItemList(items),
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

const TEST_POD_ID = "pod-001";
const TEST_CANVAS_ID = "canvas-001";
type FakeServer = ReturnType<typeof startFakeWebSocketServer>;

function createOptions(disabled = false) {
  return {
    disabled: () => disabled,
    getCanvasId: () => TEST_CANVAS_ID,
  };
}

async function connectUploadUserFlow(): Promise<FakeServer> {
  const fakeServer = startFakeWebSocketServer();
  await connectChatStoreToFakeServer(fakeServer);
  return fakeServer;
}

async function waitForUploadSessionMessage(
  fakeServer: FakeServer,
): Promise<PodChatSendPayload> {
  const sentMessage = await fakeServer.waitForMessage(
    (candidate) => candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
  );
  return expectMessagePayload<PodChatSendPayload>(sentMessage);
}

// ─────────────────────────────────────────────
// 測試主體
// ─────────────────────────────────────────────

describe("usePodFileDrop", () => {
  let fakeServer: FakeServer | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFile.mockReset();
    setActivePinia(createPinia());
    resetChatActionsCache();
    useCanvasStore().activeCanvasId = TEST_CANVAS_ID;
    mockUploadFile.mockResolvedValue({
      filename: "file.txt",
      size: 100,
      mime: "text/plain",
    });
  });

  afterEach(async () => {
    await disconnectChatStoreFromFakeServer(fakeServer);
    fakeServer = undefined;
  });

  // ─────────────────────────────────────────────
  // DragEvent 驗證（handleDropEvent）
  // ─────────────────────────────────────────────

  describe("handleDropEvent 驗證", () => {
    it("Pod 拖曳單檔上限應為 100 MB", () => {
      expect(MAX_POD_DROP_FILE_BYTES).toBe(100 * 1024 * 1024);
    });

    it("拖入 0 個檔案時，應顯示 errors.attachmentEmpty toast，不觸發上傳", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions());
      const event = createDropEvent({ files: [] });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("拖入含資料夾條目時，應顯示 errors.attachmentFolderNotAllowed toast", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions());
      const event = createDropEvent({ hasDirectory: true });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("單檔超過 MAX_POD_DROP_FILE_BYTES 時，應顯示 errors.attachmentTooLarge toast", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions());
      const bigFile = createFile("big.bin", MAX_POD_DROP_FILE_BYTES + 1);
      const event = createDropEvent({ files: [bigFile] });
      await handleDropEvent(event, TEST_POD_ID);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(mockUploadFile).not.toHaveBeenCalled();
    });

    it("disabled=true 時 drop 應直接 return，不觸發上傳", async () => {
      const { handleDropEvent } = usePodFileDrop(createOptions(true));
      const files = [createFile("file.txt", 100)];
      const event = createDropEvent({ files });
      await handleDropEvent(event, TEST_POD_ID);

      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("合法檔案從拖放到上傳成功後，應送出含 uploadSessionId 的 WS 訊息", async () => {
      fakeServer = await connectUploadUserFlow();
      const uploadedSessions: string[] = [];
      mockUploadFile.mockImplementationOnce(
        async (_file: File, _canvasId: string, sessionId: string) => {
          uploadedSessions.push(sessionId);
          return { filename: "test.txt", size: 100, mime: "text/plain" };
        },
      );

      const { handleDropEvent } = usePodFileDrop(createOptions());
      const files = [createFile("test.txt", 100)];
      const event = createDropEvent({ files });
      await handleDropEvent(event, TEST_POD_ID);

      const payload = await waitForUploadSessionMessage(fakeServer);
      expect(payload).toMatchObject({
        canvasId: TEST_CANVAS_ID,
        podId: TEST_POD_ID,
        message: "",
      });
      expect(payload.uploadSessionId).toBe(uploadedSessions[0]);
      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(useChatStore().isTyping(TEST_POD_ID)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────
  // handleDrop 主流程
  // ─────────────────────────────────────────────

  describe("handleDrop 主流程", () => {
    it("isUploading=true 時再次呼叫 handleDrop 應直接忽略", async () => {
      const uploadStore = useUploadStore();
      const existingFile = createFile("existing.txt", 100);
      uploadStore.startUpload(TEST_POD_ID, [existingFile]);
      const existingSessionId =
        uploadStore.getUploadState(TEST_POD_ID).uploadSessionId;

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("file.txt", 100)]);

      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(uploadStore.getUploadState(TEST_POD_ID).uploadSessionId).toBe(
        existingSessionId,
      );
    });

    it("單檔上傳失敗時，狀態停在 upload-failed 且不送 WS 訊息", async () => {
      fakeServer = await connectUploadUserFlow();
      mockUploadFile.mockRejectedValueOnce(new Error("網路錯誤"));

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("bad.txt", 100)]);

      const state = useUploadStore().getUploadState(TEST_POD_ID);
      expect(state.status).toBe("upload-failed");
      expect(state.files).toHaveLength(1);
      expect(state.files[0]).toMatchObject({
        name: "bad.txt",
        status: "failed",
        failureReason: "unknown",
      });
      expect(fakeServer.receivedMessages).not.toContainEqual(
        expect.objectContaining({ type: WebSocketRequestEvents.POD_CHAT_SEND }),
      );
    });

    it("多檔部分失敗時，成功檔保留 success，失敗檔保留 failed 且不送 WS 訊息", async () => {
      fakeServer = await connectUploadUserFlow();
      mockUploadFile
        .mockResolvedValueOnce({
          filename: "ok.txt",
          size: 100,
          mime: "text/plain",
        })
        .mockRejectedValueOnce(new Error("逾時"));

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [
        createFile("ok.txt", 100),
        createFile("bad.txt", 100),
      ]);

      const files = useUploadStore().getUploadState(TEST_POD_ID).files;
      expect(files.find((file) => file.name === "ok.txt")?.status).toBe(
        "success",
      );
      expect(files.find((file) => file.name === "bad.txt")).toMatchObject({
        status: "failed",
        failureReason: "unknown",
      });
      expect(fakeServer.receivedMessages).not.toContainEqual(
        expect.objectContaining({ type: WebSocketRequestEvents.POD_CHAT_SEND }),
      );
    });

    it("全部成功時應送 WS 訊息，不顯示 toast", async () => {
      fakeServer = await connectUploadUserFlow();

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("ok.txt", 100)]);

      const payload = await waitForUploadSessionMessage(fakeServer);
      expect(payload.podId).toBe(TEST_POD_ID);
      expect(payload.uploadSessionId).toEqual(expect.any(String));
      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("websocket 未連線時，檔案仍完成上傳並顯示送出失敗 toast", async () => {
      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("ok.txt", 100)]);

      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" }),
      );
    });

    it("上傳進度回呼會更新 store 進度，失敗後保留給使用者重試", async () => {
      mockUploadFile.mockImplementationOnce(
        (
          _file: File,
          _canvasId: string,
          _sessionId: string,
          onProgress: (e: { loaded: number }) => void,
        ) => {
          onProgress({ loaded: 50 });
          return Promise.reject(new Error("中斷"));
        },
      );

      const { handleDrop } = usePodFileDrop(createOptions());
      await handleDrop(TEST_POD_ID, [createFile("progress.txt", 100)]);

      const state = useUploadStore().getUploadState(TEST_POD_ID);
      expect(state.status).toBe("upload-failed");
      expect(state.aggregateProgress).toBe(50);
      expect(state.files[0]).toMatchObject({
        name: "progress.txt",
        loaded: 50,
        status: "failed",
      });
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
      fakeServer = await connectUploadUserFlow();
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
      const uploadStore = useUploadStore();
      uploadStore.startUpload(TEST_POD_ID, [createFile("ok.txt", 100)]);
      const entry = uploadStore.getUploadState(TEST_POD_ID).files[0]!;
      uploadStore.markFileSuccess(TEST_POD_ID, entry.id);

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(mockUploadFile).not.toHaveBeenCalled();
      expect(uploadStore.getUploadState(TEST_POD_ID).status).toBe("uploading");
    });

    it("有 failed 檔案時，應只對失敗檔重新上傳", async () => {
      const uploadStore = useUploadStore();
      uploadStore.startUpload(TEST_POD_ID, [
        createFile("ok.txt", 100),
        createFile("bad.txt", 100),
      ]);
      const [successEntry, failedEntry] =
        uploadStore.getUploadState(TEST_POD_ID).files;
      uploadStore.markFileSuccess(TEST_POD_ID, successEntry!.id);
      uploadStore.markFileFailed(TEST_POD_ID, failedEntry!.id, "unknown");
      uploadStore.finalizeUpload(TEST_POD_ID);

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      expect(mockUploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ name: "bad.txt" }),
        TEST_CANVAS_ID,
        expect.any(String),
        expect.any(Function),
      );
    });

    it("重試後全成功，應送 WS 訊息", async () => {
      fakeServer = await connectUploadUserFlow();
      const uploadStore = useUploadStore();
      uploadStore.startUpload(TEST_POD_ID, [createFile("bad.txt", 100)]);
      const failedEntry = uploadStore.getUploadState(TEST_POD_ID).files[0]!;
      uploadStore.markFileFailed(TEST_POD_ID, failedEntry.id, "unknown");
      const failedResult = uploadStore.finalizeUpload(TEST_POD_ID);
      expect(failedResult.ok).toBe(false);
      const retrySessionId =
        uploadStore.getUploadState(TEST_POD_ID).uploadSessionId;

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      const payload = await waitForUploadSessionMessage(fakeServer);
      expect(payload.podId).toBe(TEST_POD_ID);
      expect(payload.uploadSessionId).toBe(retrySessionId);
    });

    it("重試後仍有失敗，不送 WS 訊息", async () => {
      fakeServer = await connectUploadUserFlow();
      const uploadStore = useUploadStore();
      uploadStore.startUpload(TEST_POD_ID, [createFile("bad.txt", 100)]);
      const failedEntry = uploadStore.getUploadState(TEST_POD_ID).files[0]!;
      uploadStore.markFileFailed(TEST_POD_ID, failedEntry.id, "unknown");
      uploadStore.finalizeUpload(TEST_POD_ID);
      mockUploadFile.mockRejectedValueOnce(new Error("仍然失敗"));

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(uploadStore.getUploadState(TEST_POD_ID).status).toBe(
        "upload-failed",
      );
      expect(fakeServer.receivedMessages).not.toContainEqual(
        expect.objectContaining({ type: WebSocketRequestEvents.POD_CHAT_SEND }),
      );
    });

    it("retryFailed 進度從 0% 開始且只計剩餘（失敗）檔案", async () => {
      fakeServer = await connectUploadUserFlow();
      const uploadStore = useUploadStore();
      uploadStore.startUpload(TEST_POD_ID, [
        createFile("ok.txt", 100),
        createFile("retry.txt", 100),
      ]);
      const [successEntry, failedEntry] =
        uploadStore.getUploadState(TEST_POD_ID).files;
      uploadStore.markFileSuccess(TEST_POD_ID, successEntry!.id);
      uploadStore.markFileFailed(TEST_POD_ID, failedEntry!.id, "unknown");
      uploadStore.finalizeUpload(TEST_POD_ID);

      mockUploadFile.mockImplementationOnce(
        (
          _file: File,
          _canvasId: string,
          _sessionId: string,
          onProgress: (e: { loaded: number }) => void,
        ) => {
          onProgress({ loaded: 50 });
          const retryState = uploadStore.getUploadState(TEST_POD_ID);
          expect(retryState.status).toBe("uploading");
          expect(retryState.aggregateProgress).toBe(50);
          return Promise.resolve({
            filename: "retry.txt",
            size: 100,
            mime: "text/plain",
          });
        },
      );

      const { retryFailed } = usePodFileDrop(createOptions());
      await retryFailed(TEST_POD_ID);

      expect(mockUploadFile).toHaveBeenCalledTimes(1);
      const payload = await waitForUploadSessionMessage(fakeServer);
      expect(payload.uploadSessionId).toEqual(expect.any(String));
      expect(useUploadStore().getUploadState(TEST_POD_ID).status).toBe("idle");
    });
  });

  // ─────────────────────────────────────────────
  // 多 Pod 整合（E）
  // ─────────────────────────────────────────────

  describe("多 Pod 同時上傳互不影響", () => {
    it("兩個不同 podId 的 handleDrop 呼叫應各自獨立，互不影響進度", async () => {
      fakeServer = await connectUploadUserFlow();

      const composableA = usePodFileDrop(createOptions());
      const composableB = usePodFileDrop(createOptions());

      // 同時啟動兩個 Pod 的上傳
      await Promise.all([
        composableA.handleDrop("pod-A", [createFile("a.txt", 100)]),
        composableB.handleDrop("pod-B", [createFile("b.txt", 100)]),
      ]);

      await waitForExpect(() => {
        expect(
          fakeServer!.receivedMessages.filter(
            (message) => message.type === WebSocketRequestEvents.POD_CHAT_SEND,
          ),
        ).toHaveLength(2);
      });

      const sentPayloads = fakeServer.receivedMessages
        .filter(
          (message) => message.type === WebSocketRequestEvents.POD_CHAT_SEND,
        )
        .map((message) => expectMessagePayload<PodChatSendPayload>(message));

      expect(sentPayloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            podId: "pod-A",
            uploadSessionId: expect.any(String),
          }),
          expect.objectContaining({
            podId: "pod-B",
            uploadSessionId: expect.any(String),
          }),
        ]),
      );
      expect(useUploadStore().getUploadState("pod-A").status).toBe("idle");
      expect(useUploadStore().getUploadState("pod-B").status).toBe("idle");
    });
  });
});
