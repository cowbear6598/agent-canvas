import { describe, it, expect, afterEach, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";

const mockToast = vi.fn();

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

import { useSpeechRecognition } from "@/composables/chat/useSpeechRecognition";

// 建立符合 ISpeechRecognition 介面的 mock class
function makeMockRecognitionClass(
  mockStart: ReturnType<typeof vi.fn>,
  mockStop: ReturnType<typeof vi.fn>,
) {
  return class MockSpeechRecognition {
    lang = "";
    interimResults = false;
    continuous = false;
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    start = mockStart;
    stop = mockStop;
  };
}

// 將 composable 包裝在 Vue 元件中，讓 onMounted 正確觸發
function mountComposable(options: {
  disabled?: boolean;
  currentText?: string;
}) {
  const disabled = ref(options.disabled ?? false);
  const currentText = ref(options.currentText ?? "");
  const updateText = vi.fn((text: string) => {
    currentText.value = text;
  });

  let composable: ReturnType<typeof useSpeechRecognition>;

  const TestComponent = defineComponent({
    setup() {
      composable = useSpeechRecognition({ disabled, currentText, updateText });
      return {};
    },
    template: "<div></div>",
  });

  mount(TestComponent);

  return {
    disabled,
    currentText,
    updateText,
    getComposable: () => composable,
  };
}

describe("useSpeechRecognition", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>)
      .webkitSpeechRecognition;
  });

  describe("toggleListening", () => {
    it("recognition 為 null 時呼叫 toast 並不 crash", () => {
      // 確保 window 上沒有 SpeechRecognition（recognition 會是 null）
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>)
        .webkitSpeechRecognition;

      const { getComposable } = mountComposable({ disabled: false });

      expect(() => {
        getComposable().toggleListening();
      }).not.toThrow();

      expect(mockToast).toHaveBeenCalledOnce();
    });

    it("disabled 為 true 時提前返回，不呼叫 toast", () => {
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>)
        .webkitSpeechRecognition;

      const { getComposable } = mountComposable({ disabled: true });

      getComposable().toggleListening();

      expect(mockToast).not.toHaveBeenCalled();
    });

    it("disabled 為 true 時提前返回，isListening 不改變", () => {
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        makeMockRecognitionClass(mockStart, mockStop);

      const { getComposable } = mountComposable({ disabled: true });
      const composable = getComposable();

      expect(composable.isListening.value).toBe(false);
      composable.toggleListening();
      expect(composable.isListening.value).toBe(false);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("recognition 存在且未在聆聽時，呼叫 start 並設 isListening 為 true", () => {
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        makeMockRecognitionClass(mockStart, mockStop);

      const { getComposable } = mountComposable({ disabled: false });
      const composable = getComposable();

      composable.toggleListening();

      expect(mockStart).toHaveBeenCalledOnce();
      expect(composable.isListening.value).toBe(true);
    });

    it("recognition 存在且正在聆聽時，呼叫 stop 並設 isListening 為 false", () => {
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        makeMockRecognitionClass(mockStart, mockStop);

      const { getComposable } = mountComposable({ disabled: false });
      const composable = getComposable();

      composable.toggleListening();
      expect(composable.isListening.value).toBe(true);

      composable.toggleListening();

      expect(mockStop).toHaveBeenCalledOnce();
      expect(composable.isListening.value).toBe(false);
    });
  });

  describe("onresult 事件", () => {
    it("收到 transcript 時應正確 append 文字", () => {
      let capturedRecognition: InstanceType<
        ReturnType<typeof makeMockRecognitionClass>
      > | null = null;
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      const MockClass = makeMockRecognitionClass(mockStart, mockStop);

      // 攔截建立的 recognition 實例
      class TrackingMockClass extends MockClass {
        constructor() {
          super();
          capturedRecognition = this;
        }
      }
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        TrackingMockClass;

      const { updateText, currentText, getComposable } = mountComposable({
        disabled: false,
        currentText: "初始文字",
      });

      // 確保 recognition 已初始化
      getComposable().toggleListening();
      expect(capturedRecognition).not.toBeNull();

      // 模擬 onresult 事件
      const fakeEvent = {
        results: {
          length: 1,
          0: { 0: { transcript: "新文字" } },
        },
      };
      capturedRecognition!.onresult?.(fakeEvent);

      expect(updateText).toHaveBeenCalledWith("初始文字新文字");
      expect(currentText.value).toBe("初始文字新文字");
    });

    it("累積文字超過 MAX_MESSAGE_LENGTH 時應截斷並呼叫 toast", () => {
      let capturedRecognition: InstanceType<
        ReturnType<typeof makeMockRecognitionClass>
      > | null = null;
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      const MockClass = makeMockRecognitionClass(mockStart, mockStop);

      class TrackingMockClass extends MockClass {
        constructor() {
          super();
          capturedRecognition = this;
        }
      }
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        TrackingMockClass;

      // 建立接近 MAX_MESSAGE_LENGTH (10000) 的初始文字（9995 字元）
      const longText = "a".repeat(9995);
      const { updateText, getComposable } = mountComposable({
        disabled: false,
        currentText: longText,
      });

      getComposable().toggleListening();
      expect(capturedRecognition).not.toBeNull();

      // transcript 加上現有文字超過 10000（9995 + 10 = 10005 > 10000）
      const fakeEvent = {
        results: {
          length: 1,
          0: { 0: { transcript: "0123456789" } },
        },
      };
      capturedRecognition!.onresult?.(fakeEvent);

      // 應截斷至 MAX_MESSAGE_LENGTH
      expect(updateText).toHaveBeenCalled();
      const calledWith = (updateText as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as string;
      expect(calledWith.length).toBe(10000);

      // 應呼叫 toast 提示
      expect(mockToast).toHaveBeenCalled();

      // 應呼叫 stop 停止語音辨識
      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe("onend 事件", () => {
    it("onend 觸發時應將 isListening 設為 false", () => {
      let capturedRecognition: InstanceType<
        ReturnType<typeof makeMockRecognitionClass>
      > | null = null;
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      const MockClass = makeMockRecognitionClass(mockStart, mockStop);

      class TrackingMockClass extends MockClass {
        constructor() {
          super();
          capturedRecognition = this;
        }
      }
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        TrackingMockClass;

      const { getComposable } = mountComposable({ disabled: false });
      const composable = getComposable();

      // 先開始聆聽
      composable.toggleListening();
      expect(composable.isListening.value).toBe(true);

      // 模擬 onend 事件
      capturedRecognition!.onend?.();

      expect(composable.isListening.value).toBe(false);
    });
  });

  describe("onerror 事件", () => {
    it("onerror 觸發時應將 isListening 設為 false", () => {
      let capturedRecognition: InstanceType<
        ReturnType<typeof makeMockRecognitionClass>
      > | null = null;
      const mockStart = vi.fn();
      const mockStop = vi.fn();
      const MockClass = makeMockRecognitionClass(mockStart, mockStop);

      class TrackingMockClass extends MockClass {
        constructor() {
          super();
          capturedRecognition = this;
        }
      }
      (window as unknown as Record<string, unknown>).SpeechRecognition =
        TrackingMockClass;

      const { getComposable } = mountComposable({ disabled: false });
      const composable = getComposable();

      // 先開始聆聽
      composable.toggleListening();
      expect(composable.isListening.value).toBe(true);

      // 模擬 onerror 事件
      capturedRecognition!.onerror?.({ error: "network" });

      expect(composable.isListening.value).toBe(false);
    });
  });
});
