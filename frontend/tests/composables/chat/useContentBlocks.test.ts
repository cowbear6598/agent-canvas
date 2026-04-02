import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { useContentBlocks } from "@/composables/chat/useContentBlocks";
import type { ImageAttachment } from "@/composables/chat/useImageAttachment";

function makeEditable(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.contentEditable = "true";
  div.innerHTML = html;
  return div;
}

function makeImageAtom(
  imageDataMap: WeakMap<HTMLElement, ImageAttachment>,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.type = "image";
  span.className = "image-atom";
  span.textContent = "[image]";
  imageDataMap.set(span, { mediaType: "image/png", base64Data: "abc123" });
  return span;
}

describe("useContentBlocks", () => {
  describe("buildContentBlocks", () => {
    it("editableRef 為 null 時回傳空陣列", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const { buildContentBlocks } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const result = buildContentBlocks();

      expect(result).toEqual([]);
    });

    it("純文字 DOM 轉成單一 text block", () => {
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const div = makeEditable("Hello World");
      const editableRef = ref<HTMLDivElement | null>(div);
      const { buildContentBlocks } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const result = buildContentBlocks();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: "text", text: "Hello World" });
    });

    it("含 image atom 的 DOM 轉成 text-image-text 交替 blocks", () => {
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const div = document.createElement("div");
      div.contentEditable = "true";

      div.appendChild(document.createTextNode("前文字"));
      div.appendChild(makeImageAtom(imageDataMap));
      div.appendChild(document.createTextNode("後文字"));

      const editableRef = ref<HTMLDivElement | null>(div);
      const { buildContentBlocks } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const result = buildContentBlocks();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: "text", text: "前文字" });
      expect(result[1]).toMatchObject({
        type: "image",
        mediaType: "image/png",
        base64Data: "abc123",
      });
      expect(result[2]).toEqual({ type: "text", text: "後文字" });
    });
  });

  describe("extractTextFromBlocks", () => {
    it("只合併 type 為 text 的 block", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const { extractTextFromBlocks } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const blocks = [
        { type: "text" as const, text: "第一段" },
        {
          type: "image" as const,
          mediaType: "image/png" as const,
          base64Data: "abc",
        },
        { type: "text" as const, text: "第二段" },
      ];

      const result = extractTextFromBlocks(blocks);

      expect(result).toBe("第一段第二段");
    });

    it("沒有 text block 時回傳空字串", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const { extractTextFromBlocks } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const blocks = [
        {
          type: "image" as const,
          mediaType: "image/png" as const,
          base64Data: "abc",
        },
      ];

      const result = extractTextFromBlocks(blocks);

      expect(result).toBe("");
    });
  });

  describe("countTextLength", () => {
    it("純文字節點正確計算長度", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const { countTextLength } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const textNode = document.createTextNode("Hello");

      expect(countTextLength(textNode)).toBe(5);
    });

    it("br 節點計 1", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const { countTextLength } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const br = document.createElement("br");

      expect(countTextLength(br)).toBe(1);
    });

    it("image atom 計 0", () => {
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const editableRef = ref<HTMLDivElement | null>(null);
      const { countTextLength } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const imageAtom = makeImageAtom(imageDataMap);

      expect(countTextLength(imageAtom)).toBe(0);
    });

    it("包含文字和 br 的容器節點正確累加", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const imageDataMap = new WeakMap<HTMLElement, ImageAttachment>();
      const { countTextLength } = useContentBlocks({
        editableRef,
        imageDataMap,
      });

      const div = document.createElement("div");
      div.appendChild(document.createTextNode("abc"));
      div.appendChild(document.createElement("br"));
      div.appendChild(document.createTextNode("de"));

      // 'abc'=3 + br=1 + 'de'=2 = 6
      expect(countTextLength(div)).toBe(6);
    });
  });
});
