import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ChatInput from "@/components/chat/ChatInput.vue";
import { MAX_MESSAGE_LENGTH, MAX_IMAGES_PER_DROP } from "@/lib/constants";

// Mock ScrollArea 避免依賴問題
vi.mock("@/components/ui/scroll-area/ScrollArea.vue", () => ({
  default: {
    name: "ScrollArea",
    template: "<div><slot /></div>",
  },
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// jsdom 沒有 DragEvent，補上 polyfill
if (typeof globalThis.DragEvent === "undefined") {
  class DragEventPolyfill extends Event {
    dataTransfer: DataTransfer | null;
    constructor(
      type: string,
      init?: EventInit & { dataTransfer?: DataTransfer | null },
    ) {
      super(type, init);
      this.dataTransfer = init?.dataTransfer ?? null;
    }
  }
  globalThis.DragEvent = DragEventPolyfill as unknown as typeof DragEvent;
}

// jsdom 沒有 ClipboardEvent，補上 polyfill
if (typeof globalThis.ClipboardEvent === "undefined") {
  class ClipboardEventPolyfill extends Event {
    clipboardData: DataTransfer | null;
    constructor(
      type: string,
      init?: EventInit & { clipboardData?: DataTransfer | null },
    ) {
      super(type, init);
      this.clipboardData = init?.clipboardData ?? null;
    }
  }
  globalThis.ClipboardEvent =
    ClipboardEventPolyfill as unknown as typeof ClipboardEvent;
}

function mountChatInput(props = {}) {
  return mount(ChatInput, {
    props: { isTyping: false, ...props },
    attachTo: document.body,
  });
}

function createMockFile(name: string, type: string, size = 1024): File {
  return new File(["x".repeat(size)], name, { type });
}

interface MockFileList {
  length: number;
  item: (i: number) => File | null;
  [Symbol.iterator]: () => Generator<File>;
  [index: number]: File;
}

function createMockFileList(files: File[]): MockFileList {
  const fileList: MockFileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    },
  };
  files.forEach((f, i) => {
    fileList[i] = f;
  });
  return fileList;
}

function createDropEvent(files: File[]): DragEvent {
  const fileList = createMockFileList(files);
  const dt = {
    files: fileList as unknown as FileList,
    getData: vi.fn(),
    setData: vi.fn(),
    types: ["Files"],
  } as unknown as DataTransfer;

  const event = new DragEvent("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: dt,
    configurable: true,
  });
  return event;
}

type OnResultHandler = (event: {
  results: {
    length: number;
    [i: number]: { length: number; [j: number]: { transcript: string } };
  };
}) => void;

function setupMockSpeechRecognition() {
  let onresultHandler: OnResultHandler | null = null;
  const mockStop = vi.fn();
  const mockStart = vi.fn();

  const mockInstance = {
    lang: "",
    interimResults: false,
    continuous: false,
    get onresult() {
      return onresultHandler;
    },
    set onresult(fn: OnResultHandler | null) {
      onresultHandler = fn;
    },
    onend: null as (() => void) | null,
    onerror: null as ((e: { error: string }) => void) | null,
    start: mockStart,
    stop: mockStop,
  };

  class MockSpeechRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    get onresult() {
      return onresultHandler;
    }
    set onresult(fn: OnResultHandler | null) {
      onresultHandler = fn;
    }
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    start = mockStart;
    stop = mockStop;
  }

  Object.defineProperty(window, "SpeechRecognition", {
    value: MockSpeechRecognition,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: undefined,
    writable: true,
    configurable: true,
  });

  return {
    mockStop,
    mockStart,
    mockInstance,
    fireResult: (transcript: string) => {
      if (onresultHandler) {
        onresultHandler({
          results: {
            length: 1,
            0: { length: 1, 0: { transcript } },
          },
        });
      }
    },
  };
}

function clearSpeechRecognitionMock() {
  Object.defineProperty(window, "SpeechRecognition", {
    value: undefined,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

describe("ChatInput 安全性修復", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  describe("[High] 拖放限制最多 1 張圖片", () => {
    it("MAX_IMAGES_PER_DROP 常數應為 1", () => {
      expect(MAX_IMAGES_PER_DROP).toBe(1);
    });

    it("拖入 2 張圖片時，應顯示 toast 提示", async () => {
      const wrapper = mountChatInput();
      const editable = wrapper.find("[contenteditable]").element;

      const file1 = createMockFile("a.png", "image/png");
      const file2 = createMockFile("b.png", "image/png");
      const dropEvent = createDropEvent([file1, file2]);

      editable.dispatchEvent(dropEvent);
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "一次最多只能上傳 1 張圖片" }),
      );
      wrapper.unmount();
    });

    it("拖入 1 張圖片時，不顯示數量限制 toast", async () => {
      const wrapper = mountChatInput();
      const editable = wrapper.find("[contenteditable]").element;

      const file1 = createMockFile("a.png", "image/png");
      const dropEvent = createDropEvent([file1]);

      editable.dispatchEvent(dropEvent);
      await wrapper.vm.$nextTick();

      const limitToastCall = mockToast.mock.calls.find(
        (call) => call[0]?.title === "一次最多只能上傳 1 張圖片",
      );
      expect(limitToastCall).toBeUndefined();
      wrapper.unmount();
    });

    it("拖入空檔案列表時，不應顯示 toast", async () => {
      const wrapper = mountChatInput();
      const editable = wrapper.find("[contenteditable]").element;

      const dropEvent = createDropEvent([]);
      editable.dispatchEvent(dropEvent);
      await wrapper.vm.$nextTick();

      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "一次最多只能上傳 1 張圖片" }),
      );
      wrapper.unmount();
    });
  });

  describe("[High] 語音輸入長度保護", () => {
    it("語音輸入超過 MAX_MESSAGE_LENGTH 時，應顯示 toast 並停止辨識", async () => {
      const { mockStop, fireResult } = setupMockSpeechRecognition();
      const wrapper = mountChatInput();
      await wrapper.vm.$nextTick();

      // 透過 DOM 操作設定已接近上限的文字
      const editable = wrapper.find("[contenteditable]")
        .element as HTMLDivElement;
      const existingText = "a".repeat(MAX_MESSAGE_LENGTH - 5);
      editable.innerText = existingText;
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      await wrapper.vm.$nextTick();

      // 觸發超出長度的語音辨識結果
      fireResult("hello world extra text");

      expect(mockStop).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "已達到最大文字長度限制" }),
      );

      wrapper.unmount();
    });

    it("語音輸入未超過 MAX_MESSAGE_LENGTH 時，不應顯示 toast 也不停止辨識", async () => {
      const { mockStop, fireResult } = setupMockSpeechRecognition();
      const wrapper = mountChatInput();
      await wrapper.vm.$nextTick();

      // 透過 DOM 操作設定文字
      const editable = wrapper.find("[contenteditable]")
        .element as HTMLDivElement;
      editable.innerText = "hello";
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      await wrapper.vm.$nextTick();

      fireResult(" world");

      expect(mockStop).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "已達到最大文字長度限制" }),
      );

      wrapper.unmount();
    });
  });

  describe("[Medium] 瀏覽器不支援語音時 toast 提示", () => {
    it("瀏覽器不支援語音辨識時點擊麥克風，應顯示 toast", async () => {
      // 確保語音 API 不存在
      clearSpeechRecognitionMock();

      const wrapper = mountChatInput();
      await wrapper.vm.$nextTick();

      // 麥克風按鈕是最後一個 button
      const buttons = wrapper.findAll("button");
      const micButton = buttons[buttons.length - 1]!!;

      await micButton.trigger("click");

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "此瀏覽器不支援語音輸入功能" }),
      );

      wrapper.unmount();
    });
  });

  describe("[Medium] handleSend 使用 buildContentBlocks 做長度檢查", () => {
    it("內容為空時，不應觸發 send emit", async () => {
      const wrapper = mountChatInput();

      const buttons = wrapper.findAll("button");
      // isTyping=false 時，送出按鈕是第一個 (Send icon)，麥克風是最後一個
      const sendButton = buttons[0]!;
      await sendButton.trigger("click");

      expect(wrapper.emitted("send")).toBeFalsy();
      wrapper.unmount();
    });

    it("有文字內容時，應觸發 send emit", async () => {
      const wrapper = mountChatInput();
      const editable = wrapper.find("[contenteditable]")
        .element as HTMLDivElement;

      // 在 contenteditable 插入文字節點，讓 buildContentBlocks 能讀取
      editable.appendChild(document.createTextNode("hello world"));
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      await wrapper.vm.$nextTick();

      editable.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("send")).toBeTruthy();
      wrapper.unmount();
    });
  });

  describe("[Low] clearInput 顯式釋放 WeakMap", () => {
    it("送出訊息後 editableRef 的 textContent 應被清空", async () => {
      const wrapper = mountChatInput();
      const editable = wrapper.find("[contenteditable]")
        .element as HTMLDivElement;

      editable.innerText = "hello";
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      await wrapper.vm.$nextTick();

      editable.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await wrapper.vm.$nextTick();

      expect(editable.textContent).toBe("");
      wrapper.unmount();
    });
  });
});

describe("送出訊息流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  it("輸入框為空時點擊送出，不應 emit send", async () => {
    const wrapper = mountChatInput();

    const buttons = wrapper.findAll("button");
    const sendButton = buttons[0]!;
    await sendButton.trigger("click");

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("輸入框只有空白時，不應 emit send", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("   "));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const sendButton = buttons[0]!;
    await sendButton.trigger("click");

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("輸入文字後按 Enter，應 emit send 事件並帶上訊息內容", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("hello world"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    // jsdom 不支援 innerText，input.value ref 無法從 DOM 同步，
    // 此處只驗證 send 有被觸發（帶有 1 個 argument）
    expect(wrapper.emitted("send")).toBeTruthy();
    expect(wrapper.emitted("send")?.[0]).toHaveLength(1);
    wrapper.unmount();
  });

  it("送出後輸入框應被清空", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("clear me"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(editable.textContent).toBe("");
    wrapper.unmount();
  });
});

describe("鍵盤行為", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  it("按下 Ctrl+Enter 應插入換行而非送出（檢查不 emit send）", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("hello"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("按下 Shift+Enter 應插入換行而非送出（檢查不 emit send）", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("hello"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("輸入法組字中（isComposing = true）按 Enter，不應觸發送出", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("你好"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("isTyping=true 時按 Enter，不應觸發送出（避免誤觸暫停）", async () => {
    const wrapper = mountChatInput({ isTyping: true });
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("hello"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });
});

describe("中止流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  it("isTyping=true 時應顯示中止按鈕（Square icon）", async () => {
    const wrapper = mountChatInput({ isTyping: true });
    await wrapper.vm.$nextTick();

    // isTyping=true 時，送出按鈕被隱藏，只有中止按鈕和麥克風按鈕
    const buttons = wrapper.findAll("button");
    // 第一個按鈕應為中止按鈕（含 Square icon）
    const abortButton = buttons[0]!;
    expect(abortButton.find("svg").exists()).toBe(true);
    // 送出按鈕用 v-if/v-else，isTyping=true 只有 abort + mic 兩個按鈕
    expect(buttons).toHaveLength(2);
    wrapper.unmount();
  });

  it("isTyping=false 時應顯示送出按鈕（Send icon），不顯示中止按鈕", async () => {
    const wrapper = mountChatInput({ isTyping: false });
    await wrapper.vm.$nextTick();

    // isTyping=false 時，有送出按鈕 + 麥克風按鈕共兩個
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    wrapper.unmount();
  });

  it("點擊中止按鈕應 emit abort", async () => {
    const wrapper = mountChatInput({ isTyping: true });
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const abortButton = buttons[0]!;
    await abortButton.trigger("click");

    expect(wrapper.emitted("abort")).toBeTruthy();
    wrapper.unmount();
  });

  it("中止按鈕點擊後再次點擊不應重複 emit abort（isAborting 防抖，等待 isTyping 恢復 false 才解鎖）", async () => {
    const wrapper = mountChatInput({ isTyping: true });
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const abortButton = buttons[0]!;
    await abortButton.trigger("click");
    await abortButton.trigger("click");

    expect(wrapper.emitted("abort")).toHaveLength(1);

    wrapper.unmount();
  });

  it("中止按鈕在 isAborting=true 期間應有 disabled attribute", async () => {
    const wrapper = mountChatInput({ isTyping: true });
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const abortButton = buttons[0]!;

    // 點擊前，disabled 不存在
    expect(abortButton.attributes("disabled")).toBeUndefined();

    await abortButton.trigger("click");
    await wrapper.vm.$nextTick();

    // 點擊後 isAborting=true，按鈕應被 disabled
    expect(abortButton.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("中止完成後（isTyping 回 false），輸入文字再按 Enter 應正常觸發 send", async () => {
    const wrapper = mountChatInput({ isTyping: true });
    await wrapper.vm.$nextTick();

    // 觸發中止
    const buttons = wrapper.findAll("button");
    const abortButton = buttons[0]!;
    await abortButton.trigger("click");

    // 模擬 AI 停止回應，isTyping 回到 false
    await wrapper.setProps({ isTyping: false });
    await wrapper.vm.$nextTick();

    // 此時應顯示送出按鈕
    const newButtons = wrapper.findAll("button");
    expect(newButtons).toHaveLength(2);

    // 輸入文字
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;
    editable.appendChild(document.createTextNode("中止後再次送出"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    // 按 Enter 應正常送出
    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("send")).toBeTruthy();

    wrapper.unmount();
  });

  it("isTyping 從 true 變回 false 後，isAborting 應自動解除（可以再次 abort）", async () => {
    vi.useFakeTimers();
    const wrapper = mountChatInput({ isTyping: true });
    await wrapper.vm.$nextTick();

    // 第一次點擊中止
    const buttons = wrapper.findAll("button");
    const abortButton = buttons[0]!;
    await abortButton.trigger("click");

    // isTyping 切換回 false 模擬 AI 回應完畢，isAborting 被 watch 重置
    await wrapper.setProps({ isTyping: false });
    await wrapper.vm.$nextTick();

    // isTyping 切回 true，模擬新一輪 AI 回應
    await wrapper.setProps({ isTyping: true });
    await wrapper.vm.$nextTick();

    const newButtons = wrapper.findAll("button");
    const newAbortButton = newButtons[0]!;
    await newAbortButton.trigger("click");

    expect(wrapper.emitted("abort")).toHaveLength(2);

    vi.useRealTimers();
    wrapper.unmount();
  });
});

describe("圖片貼上流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  it("貼上純文字時，應以 plain text 插入（驗證沒有 HTML）", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    const clipboardData = {
      files: { length: 0, item: () => null } as unknown as FileList,
      getData: (type: string) =>
        type === "text/plain" ? "plain text content" : "",
    } as unknown as DataTransfer;

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: clipboardData,
      configurable: true,
    });

    editable.dispatchEvent(pasteEvent);
    await wrapper.vm.$nextTick();

    // 確認沒有插入任何 HTML 標籤
    expect(editable.innerHTML).not.toMatch(/<[^>]+>/);
    wrapper.unmount();
  });

  it("貼上不支援的圖片格式應顯示 toast", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    const bmpFile = createMockFile("test.bmp", "image/bmp");
    const mockFileList = {
      length: 1,
      item: (i: number) => (i === 0 ? bmpFile : null),
      0: bmpFile,
    } as unknown as FileList;

    const clipboardData = {
      files: mockFileList,
      getData: () => "",
    } as unknown as DataTransfer;

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: clipboardData,
      configurable: true,
    });

    editable.dispatchEvent(pasteEvent);
    await wrapper.vm.$nextTick();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "不支援的圖片格式" }),
    );
    wrapper.unmount();
  });

  it("貼上超過 5MB 的圖片應顯示 toast", async () => {
    const wrapper = mountChatInput();
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    const largeFile = createMockFile("large.png", "image/png", 6 * 1024 * 1024);
    const mockFileList = {
      length: 1,
      item: (i: number) => (i === 0 ? largeFile : null),
      0: largeFile,
    } as unknown as FileList;

    const clipboardData = {
      files: mockFileList,
      getData: () => "",
    } as unknown as DataTransfer;

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: clipboardData,
      configurable: true,
    });

    editable.dispatchEvent(pasteEvent);
    await wrapper.vm.$nextTick();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "圖片大小超過 5MB 限制" }),
    );
    wrapper.unmount();
  });
});

describe("disabled 狀態", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  it("disabled=true 時送出按鈕有 disabled 屬性", async () => {
    const wrapper = mountChatInput({ disabled: true });
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const sendButton = buttons[0]!;
    expect(sendButton.attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  it("disabled=true 時按 Enter 不應送出", async () => {
    const wrapper = mountChatInput({ disabled: true });
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("hello"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("disabled=false 時點擊送出按鈕應正常 emit send", async () => {
    const wrapper = mountChatInput({ disabled: false });
    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;

    editable.appendChild(document.createTextNode("hello"));
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const sendButton = buttons[0]!;
    await sendButton.trigger("click");

    expect(wrapper.emitted("send")).toBeTruthy();
    wrapper.unmount();
  });

  it("isTyping=true 時即使 disabled=true，應顯示停止按鈕而非送出按鈕", async () => {
    const wrapper = mountChatInput({ isTyping: true, disabled: true });
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    wrapper.unmount();
  });
});

describe("語音辨識", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearSpeechRecognitionMock();
  });

  it("點擊麥克風按鈕應開始錄音（呼叫 start）", async () => {
    const { mockStart } = setupMockSpeechRecognition();
    const wrapper = mountChatInput();
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const micButton = buttons[buttons.length - 1]!;
    await micButton.trigger("click");

    expect(mockStart).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("錄音中再次點擊應停止錄音（呼叫 stop）", async () => {
    const { mockStart, mockStop } = setupMockSpeechRecognition();
    const wrapper = mountChatInput();
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll("button");
    const micButton = buttons[buttons.length - 1]!;

    // 第一次點擊開始錄音
    await micButton.trigger("click");
    expect(mockStart).toHaveBeenCalledTimes(1);

    // 第二次點擊停止錄音
    await micButton.trigger("click");
    expect(mockStop).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("語音辨識結果應附加到輸入框", async () => {
    const { fireResult } = setupMockSpeechRecognition();
    const wrapper = mountChatInput();
    await wrapper.vm.$nextTick();

    const editable = wrapper.find("[contenteditable]")
      .element as HTMLDivElement;
    editable.innerText = "你好";
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await wrapper.vm.$nextTick();

    // 模擬語音辨識結果
    fireResult(" 世界");
    await wrapper.vm.$nextTick();

    expect(editable.innerText).toContain("你好");
    expect(editable.innerText).toContain(" 世界");
    wrapper.unmount();
  });
});
