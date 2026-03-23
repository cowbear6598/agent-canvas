import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";

vi.mock("@/components/chat/ChatMessages.vue", () => ({
  default: {
    name: "ChatMessages",
    props: ["messages", "isTyping", "isLoadingHistory"],
    template: '<div data-testid="chat-messages"></div>',
  },
}));

vi.mock("@/components/run/RunStatusIcon.vue", () => ({
  default: {
    name: "RunStatusIcon",
    props: ["status"],
    template: '<span data-testid="run-status-icon"></span>',
  },
}));

vi.mock("@/stores/run/runStore", () => ({
  useRunStore: () => ({
    getActiveRunChatMessages: [],
    isLoadingPodMessages: false,
    getRunById: vi.fn(() => null),
  }),
}));

import RunChatModal from "@/components/run/RunChatModal.vue";

function mountModal() {
  return mount(RunChatModal, {
    props: {
      runId: "run-1",
      podId: "pod-1",
      podName: "Test Pod",
      runStatus: "completed" as const,
    },
    attachTo: document.body,
  });
}

describe("RunChatModal", () => {
  beforeEach(() => {
    const pinia = setupTestPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  it("按 ESC 應 emit close", () => {
    const wrapper = mountModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("按 ESC 時 event.stopPropagation 應被呼叫", () => {
    const wrapper = mountModal();

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
    document.dispatchEvent(event);

    expect(stopPropagationSpy).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("沒有 Dialog 開啟時，按 ESC 應 emit close", () => {
    const wrapper = mountModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it('有 Dialog 開啟時（DOM 存在 [data-state="open"][role="dialog"]），按 ESC 不應 emit close', () => {
    const wrapper = mountModal();

    // 模擬 reka-ui Dialog 開啟的 DOM 狀態
    const dialogEl = document.createElement("div");
    dialogEl.setAttribute("data-state", "open");
    dialogEl.setAttribute("role", "dialog");
    document.body.appendChild(dialogEl);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toBeFalsy();

    // 清理插入的 DOM 元素
    dialogEl.remove();
    wrapper.unmount();
  });

  it("點擊 overlay 應 emit close", async () => {
    const wrapper = mountModal();

    const overlay = wrapper.find(".modal-overlay");
    await overlay.trigger("click");

    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("點擊 modal 內容區域不應 emit close", async () => {
    const wrapper = mountModal();

    const content = wrapper.find(".chat-window");
    await content.trigger("click");

    expect(wrapper.emitted("close")).toBeFalsy();
    wrapper.unmount();
  });
});
