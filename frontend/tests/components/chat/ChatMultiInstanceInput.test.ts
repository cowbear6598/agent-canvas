import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ChatMultiInstanceInput from "@/components/chat/ChatMultiInstanceInput.vue";

function mountInput(podId = "pod-1") {
  return mount(ChatMultiInstanceInput, {
    props: { podId },
    attachTo: document.body,
  });
}

describe("ChatMultiInstanceInput", () => {
  it("應渲染輸入框和送出按鈕", () => {
    const wrapper = mountInput();
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find("button").exists()).toBe(true);
    wrapper.unmount();
  });

  it("輸入框為空時點擊送出，不應 emit send", async () => {
    const wrapper = mountInput();
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("輸入框只有空白時，不應 emit send", async () => {
    const wrapper = mountInput();
    await wrapper.find("textarea").setValue("   ");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("send")).toBeFalsy();
    wrapper.unmount();
  });

  it("輸入有效文字後點擊送出，應 emit send 帶 trimmed 訊息", async () => {
    const wrapper = mountInput();
    await wrapper.find("textarea").setValue("  hello world  ");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("send")).toBeTruthy();
    expect(wrapper.emitted("send")?.[0]).toEqual(["hello world"]);
    wrapper.unmount();
  });

  it("按 Enter 鍵應觸發送出", async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("測試訊息");
    const el = textarea.element as HTMLTextAreaElement;
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("send")).toBeTruthy();
    expect(wrapper.emitted("send")?.[0]).toEqual(["測試訊息"]);
    wrapper.unmount();
  });

  it("送出後輸入框應清空", async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("hello");
    await wrapper.find("button").trigger("click");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("");
    wrapper.unmount();
  });

  it("應顯示 Multi-Instance 說明文字", () => {
    const wrapper = mountInput();
    expect(wrapper.text()).toContain("Multi-Instance");
    wrapper.unmount();
  });

  it("輸入法組字中（isComposing = true）按 Enter，不應觸發送出", async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("你好");
    const el = textarea.element as HTMLTextAreaElement;
    el.dispatchEvent(
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

  it("按 Shift+Enter 應換行而非送出（不應 emit send）", async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("hello");
    const el = textarea.element as HTMLTextAreaElement;
    el.dispatchEvent(
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

  it("按 Ctrl+Enter 應換行而非送出（不應 emit send）", async () => {
    const wrapper = mountInput();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("hello");
    const el = textarea.element as HTMLTextAreaElement;
    el.dispatchEvent(
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
});
