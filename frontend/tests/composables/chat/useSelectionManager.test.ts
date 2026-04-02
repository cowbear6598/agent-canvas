import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { useSelectionManager } from "@/composables/chat/useSelectionManager";

function makeImageAtom(): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.type = "image";
  span.className = "image-atom";
  span.textContent = "[image]";
  return span;
}

function makeRange(startContainer: Node, startOffset: number): Range {
  const range = document.createRange();
  range.setStart(startContainer, startOffset);
  range.collapse(true);
  return range;
}

describe("useSelectionManager", () => {
  describe("findImageAtomBefore", () => {
    it("前一個節點為 image atom 時回傳該節點", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const { findImageAtomBefore } = useSelectionManager({ editableRef });

      const div = document.createElement("div");
      const imageAtom = makeImageAtom();
      const textNode = document.createTextNode("文字");
      div.appendChild(imageAtom);
      div.appendChild(textNode);

      // startContainer 是 div（ELEMENT_NODE），startOffset 是 1（指向第一個子節點之後）
      const range = makeRange(div, 1);

      const result = findImageAtomBefore(range);

      expect(result).toBe(imageAtom);
    });

    it("前一個節點不是 image atom 時回傳 null", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const { findImageAtomBefore } = useSelectionManager({ editableRef });

      const div = document.createElement("div");
      const plainSpan = document.createElement("span");
      plainSpan.textContent = "普通 span";
      div.appendChild(plainSpan);

      // startContainer 是 div，startOffset 1 指向 plainSpan 之後
      const range = makeRange(div, 1);

      const result = findImageAtomBefore(range);

      expect(result).toBeNull();
    });

    it("text node offset 為 0 且 previousSibling 為 image atom 時回傳", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const { findImageAtomBefore } = useSelectionManager({ editableRef });

      const div = document.createElement("div");
      const imageAtom = makeImageAtom();
      const textNode = document.createTextNode("後文字");
      div.appendChild(imageAtom);
      div.appendChild(textNode);

      // startContainer 是 textNode（TEXT_NODE），offset 0 表示游標在文字節點最前面
      const range = makeRange(textNode, 0);

      const result = findImageAtomBefore(range);

      expect(result).toBe(imageAtom);
    });

    it("text node offset 不為 0 時回傳 null", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const { findImageAtomBefore } = useSelectionManager({ editableRef });

      const div = document.createElement("div");
      const imageAtom = makeImageAtom();
      const textNode = document.createTextNode("後文字");
      div.appendChild(imageAtom);
      div.appendChild(textNode);

      // startContainer 是 textNode，offset 不為 0
      const range = makeRange(textNode, 2);

      const result = findImageAtomBefore(range);

      expect(result).toBeNull();
    });

    it("element node offset 為 0 時回傳 null", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const { findImageAtomBefore } = useSelectionManager({ editableRef });

      const div = document.createElement("div");
      const imageAtom = makeImageAtom();
      div.appendChild(imageAtom);

      // startOffset 0 表示游標在所有子節點之前
      const range = makeRange(div, 0);

      const result = findImageAtomBefore(range);

      expect(result).toBeNull();
    });
  });

  describe("moveCursorToEnd", () => {
    it("editableRef 為 null 時不應 crash", () => {
      const editableRef = ref<HTMLDivElement | null>(null);
      const { moveCursorToEnd } = useSelectionManager({ editableRef });

      expect(() => moveCursorToEnd()).not.toThrow();
    });

    it("editableRef 有值時應將游標移至末尾", () => {
      const div = document.createElement("div");
      div.textContent = "文字內容";
      document.body.appendChild(div);

      const editableRef = ref<HTMLDivElement | null>(div);
      const { moveCursorToEnd } = useSelectionManager({ editableRef });

      const mockSelection = {
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, "getSelection").mockReturnValue(
        mockSelection as unknown as Selection,
      );

      expect(() => moveCursorToEnd()).not.toThrow();
      expect(mockSelection.removeAllRanges).toHaveBeenCalled();
      expect(mockSelection.addRange).toHaveBeenCalled();

      document.body.removeChild(div);
    });
  });

  describe("insertNodeAtCursor", () => {
    it("range 在 editableRef 內時應插入節點並觸發 input 事件", () => {
      const div = document.createElement("div");
      div.textContent = "初始文字";
      document.body.appendChild(div);

      const editableRef = ref<HTMLDivElement | null>(div);
      const { insertNodeAtCursor } = useSelectionManager({ editableRef });

      // 建立一個 range 包含在 div 內部
      const range = document.createRange();
      range.setStart(div, 0);
      range.collapse(true);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, "getSelection").mockReturnValue(
        mockSelection as unknown as Selection,
      );

      const inputHandler = vi.fn();
      div.addEventListener("input", inputHandler);

      const newSpan = document.createElement("span");
      newSpan.textContent = "插入節點";

      insertNodeAtCursor(newSpan);

      expect(inputHandler).toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it("range 不在 editableRef 內時應 append 到末尾並觸發 input 事件", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      const editableRef = ref<HTMLDivElement | null>(div);
      const { insertNodeAtCursor } = useSelectionManager({ editableRef });

      // 建立一個不在 div 內的 range
      const outsideDiv = document.createElement("div");
      document.body.appendChild(outsideDiv);
      const outsideRange = document.createRange();
      outsideRange.setStart(outsideDiv, 0);
      outsideRange.collapse(true);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(outsideRange),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, "getSelection").mockReturnValue(
        mockSelection as unknown as Selection,
      );

      const inputHandler = vi.fn();
      div.addEventListener("input", inputHandler);

      const newNode = document.createTextNode("附加文字");
      insertNodeAtCursor(newNode);

      // 節點應被 append 到 div 末尾
      expect(div.contains(newNode)).toBe(true);
      expect(inputHandler).toHaveBeenCalled();

      document.body.removeChild(div);
      document.body.removeChild(outsideDiv);
    });
  });

  describe("insertLineBreak", () => {
    it("應插入 br 並觸發 input 事件", () => {
      const div = document.createElement("div");
      div.textContent = "文字";
      document.body.appendChild(div);

      const editableRef = ref<HTMLDivElement | null>(div);
      const { insertLineBreak } = useSelectionManager({ editableRef });

      const range = document.createRange();
      range.setStart(div, 1);
      range.collapse(true);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, "getSelection").mockReturnValue(
        mockSelection as unknown as Selection,
      );

      const inputHandler = vi.fn();
      div.addEventListener("input", inputHandler);

      const mockEvent = {
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      insertLineBreak(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(inputHandler).toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it("selection rangeCount 為 0 時不應 crash", () => {
      const div = document.createElement("div");
      const editableRef = ref<HTMLDivElement | null>(div);
      const { insertLineBreak } = useSelectionManager({ editableRef });

      const mockSelection = {
        rangeCount: 0,
        getRangeAt: vi.fn(),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, "getSelection").mockReturnValue(
        mockSelection as unknown as Selection,
      );

      const mockEvent = {
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent;

      expect(() => insertLineBreak(mockEvent)).not.toThrow();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });
  });

  describe("handleTextPaste", () => {
    it("應把 plain text 插入並呼叫 onSyncInput", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      const editableRef = ref<HTMLDivElement | null>(div);
      const { handleTextPaste } = useSelectionManager({ editableRef });

      const range = document.createRange();
      range.setStart(div, 0);
      range.collapse(true);

      const mockSelection = {
        rangeCount: 1,
        getRangeAt: vi.fn().mockReturnValue(range),
        removeAllRanges: vi.fn(),
        addRange: vi.fn(),
      };
      vi.spyOn(window, "getSelection").mockReturnValue(
        mockSelection as unknown as Selection,
      );

      const onSyncInput = vi.fn();
      const pasteText = "貼上的文字";
      const mockEvent = {
        clipboardData: {
          getData: vi.fn().mockReturnValue(pasteText),
        },
      } as unknown as ClipboardEvent;

      handleTextPaste(mockEvent, onSyncInput);

      expect(onSyncInput).toHaveBeenCalledOnce();

      document.body.removeChild(div);
    });

    it("clipboardData 沒有 text 時不應呼叫 onSyncInput", () => {
      const div = document.createElement("div");
      const editableRef = ref<HTMLDivElement | null>(div);
      const { handleTextPaste } = useSelectionManager({ editableRef });

      const onSyncInput = vi.fn();
      const mockEvent = {
        clipboardData: {
          getData: vi.fn().mockReturnValue(""),
        },
      } as unknown as ClipboardEvent;

      handleTextPaste(mockEvent, onSyncInput);

      expect(onSyncInput).not.toHaveBeenCalled();
    });
  });
});
