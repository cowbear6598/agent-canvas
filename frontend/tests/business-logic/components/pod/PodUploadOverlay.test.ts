import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PodUploadOverlay from "@/components/pod/PodUploadOverlay.vue";
import i18n from "@/i18n";
import { useUploadStore } from "@/stores/upload/uploadStore";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const { retryFailed } = vi.hoisted(() => ({
  retryFailed: vi.fn(),
}));

vi.mock("@/composables/pod/usePodFileDrop", () => ({
  usePodFileDrop: () => ({ retryFailed }),
}));

function mountFailedOverlay() {
  const podId = "pod-upload-failed";
  const uploadStore = useUploadStore();
  uploadStore.startUpload(podId, [new File(["content"], "背水一戰.zip")]);
  const fileEntry = uploadStore.getUploadState(podId).files[0];
  if (!fileEntry) throw new Error("測試上傳檔案狀態未建立");
  uploadStore.markFileFailed(
    podId,
    fileEntry.id,
    "ATTACHMENT_INVALID_ARCHIVE",
  );
  uploadStore.finalizeUpload(podId);

  return mount(PodUploadOverlay, {
    props: { podId },
    global: {
      plugins: [i18n],
      stubs: {
        ScrollArea: { template: "<div><slot /></div>" },
      },
    },
  });
}

describe("PodUploadOverlay", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    retryFailed.mockReset();
  });

  it("失敗狀態應完整覆蓋 Pod，並使用手繪風格的重試按鈕", async () => {
    const wrapper = mountFailedOverlay();
    const overlay = wrapper.get('[data-testid="pod-upload-overlay"]');

    expect(overlay.classes()).toEqual(
      expect.arrayContaining(["absolute", "inset-0", "z-[70]", "overflow-hidden"]),
    );
    expect(wrapper.text()).toContain("背水一戰.zip");

    const retryButton = wrapper.get(".pod-upload-retry-button");
    await retryButton.trigger("click");
    expect(retryFailed).toHaveBeenCalledWith("pod-upload-failed");
  });
});
