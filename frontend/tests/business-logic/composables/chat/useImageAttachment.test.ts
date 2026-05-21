import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, type Ref } from "vue";

const mockToast = vi.fn();

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

import { useImageAttachment } from "@/composables/chat/useImageAttachment";
import { MAX_IMAGE_SIZE_BYTES, MAX_IMAGES_PER_DROP } from "@/lib/constants";

function makeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new ArrayBuffer(size)], { type });
  return new File([blob], name, { type });
}

function makeFileList(files: File[]): FileList {
  // jsdom 不支援 DataTransfer，手動建立符合 FileList 介面的物件
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    ...Object.fromEntries(files.map((f, i) => [i, f])),
    [Symbol.iterator]: function* () {
      yield* files;
    },
  } as unknown as FileList;
}

describe("useImageAttachment", () => {
  let editableRef: Ref<HTMLDivElement | null>;
  let insertNodeAtCursor: (node: Node) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    editableRef = ref<HTMLDivElement | null>(null);
    insertNodeAtCursor = vi.fn();
  });

  describe("isValidImageType", () => {
    it.each(["image/jpeg", "image/png", "image/gif", "image/webp"])(
      "%s 回傳 true",
      (mimeType) => {
        const { isValidImageType } = useImageAttachment({
          editableRef,
          insertNodeAtCursor,
        });
        expect(isValidImageType(mimeType)).toBe(true);
      },
    );

    it("text/plain 回傳 false", () => {
      const { isValidImageType } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });
      expect(isValidImageType("text/plain")).toBe(false);
    });

    it("application/pdf 回傳 false", () => {
      const { isValidImageType } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });
      expect(isValidImageType("application/pdf")).toBe(false);
    });
  });

  describe("insertImageAtCursor", () => {
    it("檔案大小超過限制時呼叫 toast 並提前返回", async () => {
      const { insertImageAtCursor } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });
      const oversizedFile = makeFile(
        "big.png",
        "image/png",
        MAX_IMAGE_SIZE_BYTES + 1,
      );

      await insertImageAtCursor(oversizedFile);

      expect(mockToast).toHaveBeenCalledOnce();
      expect(insertNodeAtCursor).not.toHaveBeenCalled();
    });

    it("格式不支援時呼叫 toast 並提前返回", async () => {
      const { insertImageAtCursor } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });
      const unsupportedFile = makeFile("doc.pdf", "application/pdf", 100);

      await insertImageAtCursor(unsupportedFile);

      expect(mockToast).toHaveBeenCalledOnce();
      expect(insertNodeAtCursor).not.toHaveBeenCalled();
    });
  });

  describe("handleDrop", () => {
    it("超過張數限制時呼叫 toast", async () => {
      const { handleDrop } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });

      // 建立超過 MAX_IMAGES_PER_DROP 數量的圖片檔案
      const files: File[] = [];
      for (let i = 0; i <= MAX_IMAGES_PER_DROP; i++) {
        files.push(makeFile(`img${i}.png`, "image/png", 100));
      }
      const fileList = makeFileList(files);

      // jsdom 不支援 DragEvent，直接建立符合介面的 mock 物件
      const event = {
        preventDefault: vi.fn(),
        dataTransfer: { files: fileList },
      } as unknown as DragEvent;

      await handleDrop(event);

      expect(mockToast).toHaveBeenCalledOnce();
    });
  });

  describe("findImageFile", () => {
    it("FileList 無圖片時回傳 undefined", () => {
      const { findImageFile } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });
      const fileList = makeFileList([makeFile("doc.txt", "text/plain", 10)]);

      const result = findImageFile(fileList);

      expect(result).toBeUndefined();
    });

    it("FileList 為 null 時回傳 undefined", () => {
      const { findImageFile } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });

      const result = findImageFile(null);

      expect(result).toBeUndefined();
    });

    it("FileList 有圖片時回傳圖片檔案", () => {
      const { findImageFile } = useImageAttachment({
        editableRef,
        insertNodeAtCursor,
      });
      const imageFile = makeFile("photo.png", "image/png", 100);
      const fileList = makeFileList([
        makeFile("doc.txt", "text/plain", 10),
        imageFile,
      ]);

      const result = findImageFile(fileList);

      expect(result).toBe(imageFile);
    });
  });
});
