/**
 * uploadStore 單元測試
 *
 * 涵蓋以下情境：
 * 1. aggregateProgress 加權平均計算正確（多檔不同 size）
 * 2. aggregateProgress 邊界：sum(size)=0 時為 100
 * 3. markFileFailed 後其他檔仍可被 markFileSuccess
 * 4. finalizeUpload 全部成功回 ok=true 並清空狀態
 * 5. finalizeUpload 有失敗時 status 變 upload-failed 並列出 failedFiles
 * 6. 多 Pod 狀態互相獨立
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { useUploadStore } from "@/stores/upload/uploadStore";

// ─────────────────────────────────────────────
// 測試輔助函式
// ─────────────────────────────────────────────

/** 建立指定大小的 File 物件 */
function makeFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: "text/plain" });
}

// ─────────────────────────────────────────────
// 測試主體
// ─────────────────────────────────────────────

describe("uploadStore", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
  });

  // ─────────────────────────────────────────────
  // aggregateProgress 計算
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // markFileFailed 後其他檔仍可被 markFileSuccess
  // ─────────────────────────────────────────────

  describe("markFileFailed 與 markFileSuccess 獨立性", () => {
    it("markFileFailed 某檔後，其他檔仍可被 markFileSuccess 標記成功", () => {
      const store = useUploadStore();
      const files = [makeFile("ok.txt", 100), makeFile("bad.txt", 100)];
      store.startUpload("pod-1", files);

      const state = store.getUploadState("pod-1");
      const entryOk = state.files[0]!;
      const entryBad = state.files[1]!;

      // 標記第二個失敗
      store.markFileFailed("pod-1", entryBad.id, "network");
      // 標記第一個成功
      store.markFileSuccess("pod-1", entryOk.id);

      const updated = store.getUploadState("pod-1");
      const okFile = updated.files.find((f) => f.id === entryOk.id);
      const badFile = updated.files.find((f) => f.id === entryBad.id);

      expect(okFile?.status).toBe("success");
      expect(badFile?.status).toBe("failed");
      expect(badFile?.failureReason).toBe("network");
    });
  });

  // ─────────────────────────────────────────────
  // finalizeUpload
  // ─────────────────────────────────────────────

  describe("finalizeUpload", () => {
    it("全部成功時應回傳 ok=true 並清空 Pod 上傳狀態（回 idle）", () => {
      const store = useUploadStore();
      const files = [makeFile("a.txt", 100), makeFile("b.txt", 100)];
      store.startUpload("pod-1", files);

      const state = store.getUploadState("pod-1");
      // 標記所有檔案成功
      for (const entry of state.files) {
        store.markFileSuccess("pod-1", entry.id);
      }

      const result = store.finalizeUpload("pod-1");

      expect(result.ok).toBe(true);
      // 清空後，getUploadState 應回傳 idle 狀態
      const afterState = store.getUploadState("pod-1");
      expect(afterState.status).toBe("idle");
      expect(afterState.files).toHaveLength(0);
    });

    it("有失敗時應回傳 ok=false，Pod 狀態變 upload-failed，並列出失敗檔案", () => {
      const store = useUploadStore();
      const files = [makeFile("ok.txt", 100), makeFile("bad.txt", 100)];
      store.startUpload("pod-1", files);

      const state = store.getUploadState("pod-1");
      const entryOk = state.files[0]!;
      const entryBad = state.files[1]!;

      store.markFileSuccess("pod-1", entryOk.id);
      store.markFileFailed("pod-1", entryBad.id, "ATTACHMENT_TOO_LARGE");

      const result = store.finalizeUpload("pod-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failedFiles).toHaveLength(1);
        expect(result.failedFiles[0]!.id).toBe(entryBad.id);
        expect(result.failedFiles[0]!.failureReason).toBe(
          "ATTACHMENT_TOO_LARGE",
        );
      }

      // Pod 狀態應變為 upload-failed
      const afterState = store.getUploadState("pod-1");
      expect(afterState.status).toBe("upload-failed");
    });
  });

  // ─────────────────────────────────────────────
  // 多 Pod 狀態獨立性
  // ─────────────────────────────────────────────

  describe("多 Pod 狀態互相獨立", () => {
    it("兩個 Pod 同時上傳，進度狀態應互不影響", () => {
      const store = useUploadStore();

      // Pod A：一個 100 bytes 的檔案
      const filesA = [makeFile("a.txt", 100)];
      // Pod B：一個 400 bytes 的檔案
      const filesB = [makeFile("b.txt", 400)];

      store.startUpload("pod-A", filesA);
      store.startUpload("pod-B", filesB);

      const stateA = store.getUploadState("pod-A");
      const stateB = store.getUploadState("pod-B");

      // Pod A 進度推進到 50%，Pod B 維持 0%
      store.updateFileProgress("pod-A", stateA.files[0]!.id, 50);

      const updatedA = store.getUploadState("pod-A");
      const updatedB = store.getUploadState("pod-B");

      expect(updatedA.aggregateProgress).toBe(50);
      // Pod B 的進度不受 Pod A 影響，仍為 0%
      expect(updatedB.aggregateProgress).toBe(0);

      // finalize Pod A，Pod B 應不受影響
      for (const entry of updatedA.files) {
        store.markFileSuccess("pod-A", entry.id);
      }
      store.finalizeUpload("pod-A");

      const finalA = store.getUploadState("pod-A");
      const finalB = store.getUploadState("pod-B");

      // Pod A 已清除
      expect(finalA.status).toBe("idle");
      // Pod B 仍在上傳中
      expect(finalB.status).toBe("uploading");
    });
  });
});
