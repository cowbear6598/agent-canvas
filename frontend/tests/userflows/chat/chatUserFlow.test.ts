import { describe, it, expect, afterEach, vi } from "vitest";
import { computed, defineComponent, h } from "vue";
import ChatInput from "@/components/chat/ChatInput.vue";
import ChatMessages from "@/components/chat/ChatMessages.vue";
import TypingIndicator from "@/components/chat/TypingIndicator.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import { usePodStore } from "@/stores/pod/podStore";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type { ContentBlock, PodChatSendPayload } from "@/types/websocket";
import { createMockPod } from "@tests/helpers/factories";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import { startFakeWebSocketServer } from "@tests/helpers/fakeWebSocketServer";
import {
  connectChatStoreToFakeServer,
  disconnectChatStoreFromFakeServer,
  expectMessagePayload,
  waitForExpect,
} from "@tests/helpers/chatWebSocketFlowTestUtils";

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

Element.prototype.scrollIntoView = vi.fn();

const POD_ID = "pod-chat-userflow";
const CANVAS_ID = "canvas-chat-userflow";

const ChatUserFlowHarness = defineComponent({
  name: "ChatUserFlowHarness",
  setup() {
    const chatStore = useChatStore();
    const messages = computed(() => chatStore.getMessages(POD_ID));
    const isTyping = computed(() => chatStore.isTyping(POD_ID));

    return () =>
      h("div", [
        h(ChatMessages, {
          messages: messages.value,
          isTyping: isTyping.value,
        }),
        h(ChatInput, {
          isTyping: isTyping.value,
          onSend: (message: string, contentBlocks?: ContentBlock[]) =>
            chatStore.sendMessage(POD_ID, message, contentBlocks),
          onAbort: () => chatStore.abortChat(POD_ID),
        }),
      ]);
  },
});

async function mountChatUserFlow() {
  const mounted = await mountUserFlowApp({
    component: ChatUserFlowHarness,
    attachTo: document.body,
  });

  resetChatActionsCache();
  useCanvasStore().activeCanvasId = CANVAS_ID;
  usePodStore().pods = [createMockPod({ id: POD_ID })];

  return mounted;
}

async function sendFromInput(
  wrapper: Awaited<ReturnType<typeof mountChatUserFlow>>["wrapper"],
  text: string,
) {
  const editable = wrapper.find(".chat-input-editable");
  editable.element.textContent = text;
  await editable.trigger("input");
  await wrapper.find("button.bg-doodle-green").trigger("click");
}

describe("chat userflow", () => {
  let fakeServer: ReturnType<typeof startFakeWebSocketServer> | undefined;

  afterEach(async () => {
    await disconnectChatStoreFromFakeServer(fakeServer);
    fakeServer = undefined;
    document.body.innerHTML = "";
  });

  it("使用者送出訊息後，optimistic typing、串流事件、完成事件會更新畫面", async () => {
    const mounted = await mountChatUserFlow();
    fakeServer = startFakeWebSocketServer();
    await connectChatStoreToFakeServer(fakeServer);

    await sendFromInput(mounted.wrapper, "請整理任務");

    const sentMessage = await fakeServer.waitForMessage(
      (candidate) => candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
    );
    expect(expectMessagePayload<PodChatSendPayload>(sentMessage)).toMatchObject(
      {
        canvasId: CANVAS_ID,
        podId: POD_ID,
        message: "請整理任務",
      },
    );
    expect(mounted.wrapper.findComponent(TypingIndicator).exists()).toBe(true);

    fakeServer.emit(WebSocketResponseEvents.RUN_MESSAGE, {
      runId: "run-1",
      canvasId: CANVAS_ID,
      podId: POD_ID,
      messageId: "assistant-1",
      content: "正在整理",
      isPartial: true,
      role: "assistant",
    });

    await waitForExpect(() => {
      expect(mounted.wrapper.text()).toContain("正在整理");
      expect(mounted.wrapper.findComponent(TypingIndicator).exists()).toBe(true);
    });

    fakeServer.emit(WebSocketResponseEvents.RUN_CHAT_COMPLETE, {
      runId: "run-1",
      canvasId: CANVAS_ID,
      podId: POD_ID,
      messageId: "assistant-1",
      fullContent: "正在整理，已完成",
    });

    await waitForExpect(() => {
      expect(mounted.wrapper.text()).toContain("正在整理，已完成");
      expect(mounted.wrapper.findComponent(TypingIndicator).exists()).toBe(
        false,
      );
    });

    mounted.unmount();
  });

  it("使用者送出訊息後，錯誤事件會停止 optimistic typing 並在畫面呈現 system 訊息", async () => {
    const mounted = await mountChatUserFlow();
    fakeServer = startFakeWebSocketServer();
    await connectChatStoreToFakeServer(fakeServer);

    await sendFromInput(mounted.wrapper, "請執行會失敗的任務");
    await fakeServer.waitForMessage(
      (candidate) => candidate.type === WebSocketRequestEvents.POD_CHAT_SEND,
    );
    expect(mounted.wrapper.findComponent(TypingIndicator).exists()).toBe(true);

    fakeServer.emit(WebSocketResponseEvents.POD_ERROR, {
      podId: POD_ID,
      error: "Provider authentication failed",
      code: "AUTH_ERROR",
    });

    await waitForExpect(() => {
      expect(mounted.wrapper.findComponent(TypingIndicator).exists()).toBe(
        false,
      );
      expect(mounted.wrapper.text()).toContain("Provider authentication failed");
      expect(mounted.wrapper.text()).toContain("AUTH_ERROR");
    });

    mounted.unmount();
  });
});
