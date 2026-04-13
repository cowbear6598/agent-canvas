import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import { createMockPod } from "../../helpers/factories";
import ChatModal from "@/components/chat/ChatModal.vue";

// Mock 子元件，避免它們本身的依賴影響測試
vi.mock("@/components/chat/ChatHeader.vue", () => ({
  default: {
    name: "ChatHeader",
    props: ["pod"],
    emits: ["close"],
    template:
      '<div data-testid="chat-header"><button @click="$emit(\'close\')">關閉</button></div>',
  },
}));

vi.mock("@/components/chat/ChatMessages.vue", () => ({
  default: {
    name: "ChatMessages",
    props: ["messages", "isTyping", "isLoadingHistory"],
    template: '<div data-testid="chat-messages"></div>',
  },
}));

vi.mock("@/components/chat/ChatInput.vue", () => ({
  default: {
    name: "ChatInput",
    props: ["isTyping", "disabled"],
    emits: ["send", "abort"],
    template: '<div data-testid="chat-input" :data-disabled="disabled"></div>',
  },
}));

// Mock ChatWorkflowBlockedHint
vi.mock("@/components/chat/ChatWorkflowBlockedHint.vue", () => ({
  default: {
    name: "ChatWorkflowBlockedHint",
    template: '<div data-testid="workflow-blocked-hint"></div>',
  },
}));

// Mock ChatIntegrationBlockedHint
vi.mock("@/components/integration/ChatIntegrationBlockedHint.vue", () => ({
  default: {
    name: "ChatIntegrationBlockedHint",
    props: ["provider"],
    template: "<div :data-testid=\"provider + '-blocked-hint'\"></div>",
  },
}));

// Mock ChatMultiInstanceInput
vi.mock("@/components/chat/ChatMultiInstanceInput.vue", () => ({
  default: {
    name: "ChatMultiInstanceInput",
    props: ["podId"],
    emits: ["send", "close"],
    template: '<div data-testid="multi-instance-input"></div>',
  },
}));

// Mock chatStore，避免 websocket 依賴
const mockIsTyping = vi.fn(() => false);
vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({
    getMessages: vi.fn(() => []),
    isTyping: mockIsTyping,
    isHistoryLoading: vi.fn(() => false),
    sendMessage: vi.fn(),
    abortChat: vi.fn(),
  }),
}));

// Mock connectionStore
const mockGetPodWorkflowRole = vi.fn(() => "independent");
const mockIsPartOfRunningWorkflow = vi.fn(() => false);
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => ({
    getPodWorkflowRole: mockGetPodWorkflowRole,
    isPartOfRunningWorkflow: mockIsPartOfRunningWorkflow,
    connections: [],
  }),
}));

// Mock runStore，避免 run 相關依賴
vi.mock("@/stores/run/runStore", () => ({
  useRunStore: () => ({
    openHistoryPanel: vi.fn(),
  }),
}));

// Mock multiInstanceGuard，讓測試可控制 isMultiInstanceSourcePod 的回傳值
const mockIsMultiInstanceSourcePod = vi.fn(() => false);
vi.mock("@/utils/multiInstanceGuard", () => ({
  isMultiInstanceSourcePod: (...args: unknown[]) => {
    return mockIsMultiInstanceSourcePod.apply(
      null,
      args as Parameters<typeof mockIsMultiInstanceSourcePod>,
    );
  },
}));

function mountChatModal() {
  const pod = createMockPod({ id: "test-pod-1" });
  return mount(ChatModal, {
    props: { pod },
  });
}

describe("ChatModal ESC 鍵行為", () => {
  setupStoreTest();

  afterEach(() => {
    // 清理可能殘留在 document.body 的測試 DOM 元素
    const openDialogs = document.querySelectorAll(
      '[data-state="open"][role="dialog"]',
    );
    openDialogs.forEach((el) => el.remove());
  });

  it("按 ESC 時無 Dialog 開啟，應觸發 close emit", async () => {
    const wrapper = mountChatModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
  });

  it("按 ESC 時有 reka-ui Dialog 開啟中，不應觸發 close emit", async () => {
    const wrapper = mountChatModal();

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

  it("按其他鍵（如 Enter），不應觸發 close emit", async () => {
    const wrapper = mountChatModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(wrapper.emitted("close")).toBeFalsy();

    wrapper.unmount();
  });

  it("元件 unmount 後按 ESC，listener 應已被移除，不應觸發任何事件", async () => {
    const wrapper = mountChatModal();

    // 先確認 mount 後 ESC 有效
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);

    // unmount 後 listener 應已被移除
    wrapper.unmount();

    // 使用 spy 確認 emit 不再被呼叫
    const emitSpy = vi.spyOn(wrapper.vm, "$emit" as never);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    // unmount 後不應再有新的 close emit
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe("Workflow Input 限制", () => {
  setupStoreTest(() => {
    mockGetPodWorkflowRole.mockReturnValue("independent");
    mockIsPartOfRunningWorkflow.mockReturnValue(false);
    mockIsTyping.mockReturnValue(false);
  });

  it("getPodWorkflowRole 回傳 independent → 存在 ChatInput，不存在提示", () => {
    mockGetPodWorkflowRole.mockReturnValue("independent");
    const wrapper = mountChatModal();

    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="workflow-blocked-hint"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });

  it("getPodWorkflowRole 回傳 middle → 存在提示，不存在 ChatInput", () => {
    mockGetPodWorkflowRole.mockReturnValue("middle");
    const wrapper = mountChatModal();

    expect(wrapper.find('[data-testid="workflow-blocked-hint"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("getPodWorkflowRole 回傳 head → 存在 ChatInput", () => {
    mockGetPodWorkflowRole.mockReturnValue("head");
    const wrapper = mountChatModal();

    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="workflow-blocked-hint"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });

  it("getPodWorkflowRole 回傳 tail → 存在 ChatInput", () => {
    mockGetPodWorkflowRole.mockReturnValue("tail");
    const wrapper = mountChatModal();

    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="workflow-blocked-hint"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });
});

describe("isWorkflowBusy", () => {
  setupStoreTest(() => {
    mockIsTyping.mockReturnValue(false);
    mockIsPartOfRunningWorkflow.mockReturnValue(false);
    mockGetPodWorkflowRole.mockReturnValue("independent");
  });

  it("workflow 執行中且頭 Pod 自己不在 typing 時，ChatInput 收到 disabled=true", async () => {
    mockGetPodWorkflowRole.mockReturnValue("head");
    mockIsPartOfRunningWorkflow.mockReturnValue(true);
    mockIsTyping.mockReturnValue(false);

    const wrapper = mountChatModal();
    await wrapper.vm.$nextTick();

    const chatInput = wrapper.find('[data-testid="chat-input"]');
    expect(chatInput.attributes("data-disabled")).toBe("true");

    wrapper.unmount();
  });

  it("頭 Pod 自己在 typing 時（status=chatting），ChatInput 不應收到 disabled（應顯示停止按鈕）", async () => {
    mockGetPodWorkflowRole.mockReturnValue("head");
    mockIsPartOfRunningWorkflow.mockReturnValue(true);
    mockIsTyping.mockReturnValue(true);

    const pod = createMockPod({ id: "test-pod-1", status: "chatting" });
    const wrapper = mount(ChatModal, { props: { pod } });
    await wrapper.vm.$nextTick();

    const chatInput = wrapper.find('[data-testid="chat-input"]');
    expect(chatInput.attributes("data-disabled")).not.toBe("true");

    wrapper.unmount();
  });

  it("workflow 執行中且尾 Pod 自己不在 typing 時，ChatInput 收到 disabled=true", async () => {
    mockGetPodWorkflowRole.mockReturnValue("tail");
    mockIsPartOfRunningWorkflow.mockReturnValue(true);
    mockIsTyping.mockReturnValue(false);

    const wrapper = mountChatModal();
    await wrapper.vm.$nextTick();

    const chatInput = wrapper.find('[data-testid="chat-input"]');
    expect(chatInput.attributes("data-disabled")).toBe("true");

    wrapper.unmount();
  });

  it("independent Pod 在 workflow 執行中時，ChatInput 不應收到 disabled", async () => {
    mockGetPodWorkflowRole.mockReturnValue("independent");
    mockIsPartOfRunningWorkflow.mockReturnValue(true);
    mockIsTyping.mockReturnValue(false);

    const wrapper = mountChatModal();
    await wrapper.vm.$nextTick();

    const chatInput = wrapper.find('[data-testid="chat-input"]');
    expect(chatInput.attributes("data-disabled")).not.toBe("true");

    wrapper.unmount();
  });

  it("tail Pod 自己在 typing 時（status=chatting），ChatInput 不應收到 disabled=true", async () => {
    mockGetPodWorkflowRole.mockReturnValue("tail");
    mockIsPartOfRunningWorkflow.mockReturnValue(true);
    mockIsTyping.mockReturnValue(true);

    const pod = createMockPod({ id: "test-pod-1", status: "chatting" });
    const wrapper = mount(ChatModal, { props: { pod } });
    await wrapper.vm.$nextTick();

    const chatInput = wrapper.find('[data-testid="chat-input"]');
    expect(chatInput.attributes("data-disabled")).not.toBe("true");

    wrapper.unmount();
  });
});

describe("Integration 綁定 Input 限制", () => {
  setupStoreTest(() => {
    mockGetPodWorkflowRole.mockReturnValue("independent");
    mockIsPartOfRunningWorkflow.mockReturnValue(false);
    mockIsTyping.mockReturnValue(false);
  });

  it("integrationBindings 有 slack binding 時，應顯示 slack-blocked-hint，不顯示 ChatInput", () => {
    const pod = createMockPod({
      id: "test-pod-1",
      integrationBindings: [
        { provider: "slack", appId: "app-1", resourceId: "ch-1", extra: {} },
      ],
    });
    const wrapper = mount(ChatModal, { props: { pod } });

    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("integrationBindings 有 slack binding 且同時為 middle Pod 時，Integration 提示優先於 Workflow 提示", () => {
    mockGetPodWorkflowRole.mockReturnValue("middle");
    const pod = createMockPod({
      id: "test-pod-1",
      integrationBindings: [
        { provider: "slack", appId: "app-1", resourceId: "ch-1", extra: {} },
      ],
    });
    const wrapper = mount(ChatModal, { props: { pod } });

    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="workflow-blocked-hint"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("integrationBindings 為空時，維持原本邏輯", () => {
    const pod = createMockPod({ id: "test-pod-1" });
    const wrapper = mount(ChatModal, { props: { pod } });

    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(true);

    wrapper.unmount();
  });
});

describe("Multi-Instance 模式與 Integration Binding 互動", () => {
  setupStoreTest(() => {
    mockGetPodWorkflowRole.mockReturnValue("independent");
    mockIsPartOfRunningWorkflow.mockReturnValue(false);
    mockIsTyping.mockReturnValue(false);
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
  });

  it("multi-instance 模式且無 integration binding：應顯示 ChatMultiInstanceInput，不顯示 ChatIntegrationBlockedHint", () => {
    mockIsMultiInstanceSourcePod.mockReturnValue(true);
    const pod = createMockPod({ id: "test-pod-1" });
    const wrapper = mount(ChatModal, { props: { pod } });

    expect(wrapper.find('[data-testid="multi-instance-input"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false);
    // ChatIntegrationBlockedHint 以 provider 命名 testid，確認任何 blocked-hint 皆不存在
    expect(wrapper.html()).not.toContain("blocked-hint");

    wrapper.unmount();
  });

  it("multi-instance 模式且有 integration binding：integration binding 優先，不顯示 ChatMultiInstanceInput，應顯示 ChatIntegrationBlockedHint", () => {
    mockIsMultiInstanceSourcePod.mockReturnValue(true);
    const pod = createMockPod({
      id: "test-pod-1",
      integrationBindings: [
        { provider: "webhook", appId: "test-app", resourceId: "", extra: {} },
      ],
    });
    const wrapper = mount(ChatModal, { props: { pod } });

    expect(wrapper.find('[data-testid="multi-instance-input"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="webhook-blocked-hint"]').exists()).toBe(
      true,
    );

    wrapper.unmount();
  });

  it("一般模式（非 multi-instance）且有 integration binding：應顯示 ChatIntegrationBlockedHint，不顯示 ChatInput", () => {
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
    const pod = createMockPod({
      id: "test-pod-1",
      integrationBindings: [
        { provider: "webhook", appId: "test-app", resourceId: "", extra: {} },
      ],
    });
    const wrapper = mount(ChatModal, { props: { pod } });

    expect(wrapper.find('[data-testid="webhook-blocked-hint"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="multi-instance-input"]').exists()).toBe(
      false,
    );

    wrapper.unmount();
  });
});
