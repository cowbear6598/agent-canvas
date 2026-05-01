import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { createMockPod, createMockConnection } from "../../helpers/factories";
import { usePodStore } from "@/stores/pod";
import { useConnectionStore } from "@/stores/connectionStore";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import ChatModal from "@/components/chat/ChatModal.vue";

// ── WS 邊界 mock ───────────────────────────────────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── 子元件 stub（避免複雜渲染樹干擾 ChatModal 邏輯測試）────────
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

vi.mock("@/components/chat/ChatWorkflowBlockedHint.vue", () => ({
  default: {
    name: "ChatWorkflowBlockedHint",
    template: '<div data-testid="workflow-blocked-hint"></div>',
  },
}));

vi.mock("@/components/integration/ChatIntegrationBlockedHint.vue", () => ({
  default: {
    name: "ChatIntegrationBlockedHint",
    props: ["provider"],
    template: "<div :data-testid=\"provider + '-blocked-hint'\"></div>",
  },
}));

vi.mock("@/components/chat/ChatMultiInstanceInput.vue", () => ({
  default: {
    name: "ChatMultiInstanceInput",
    props: ["podId"],
    emits: ["send", "close"],
    template: '<div data-testid="multi-instance-input"></div>',
  },
}));

// ── runStore（fire-and-forget，不屬於此元件行為）────────────────
vi.mock("@/stores/run/runStore", () => ({
  useRunStore: () => ({ openHistoryPanel: vi.fn() }),
}));

// ── multiInstanceGuard（第三方工具函式，可注入控制）────────────
const mockIsMultiInstanceSourcePod = vi.fn(() => false);
vi.mock("@/utils/multiInstanceGuard", () => ({
  isMultiInstanceSourcePod: (...args: unknown[]) =>
    mockIsMultiInstanceSourcePod.apply(
      null,
      args as Parameters<typeof mockIsMultiInstanceSourcePod>,
    ),
}));

// ── 輔助：設定 workflow 連線（控制 getPodWorkflowRole）──────────

/** head: pod-1 → pod-2；tail: pod-2 (= target of pod-1) */
function setupWorkflowConnection(headId: string, tailId: string) {
  const connectionStore = useConnectionStore();
  connectionStore.connections = [
    createMockConnection({
      id: "conn-1",
      sourcePodId: headId,
      targetPodId: tailId,
      status: "idle",
    }),
  ];
}

function mountChatModal(podOverrides = {}) {
  const pod = createMockPod({ id: "test-pod-1", ...podOverrides });
  return mount(ChatModal, { props: { pod } });
}

// ── 測試 ─────────────────────────────────────────────────────

describe("ChatModal ESC 鍵行為", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
  });

  afterEach(() => {
    document
      .querySelectorAll('[data-state="open"][role="dialog"]')
      .forEach((el) => el.remove());
  });

  it("按 ESC 時無 Dialog 開啟，應觸發 close emit", () => {
    const wrapper = mountChatModal();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("按 ESC 時有 reka-ui Dialog 開啟中，不應觸發 close emit", () => {
    const wrapper = mountChatModal();

    const dialogEl = document.createElement("div");
    dialogEl.setAttribute("data-state", "open");
    dialogEl.setAttribute("role", "dialog");
    document.body.appendChild(dialogEl);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toBeFalsy();
    dialogEl.remove();
    wrapper.unmount();
  });

  // 其他鍵不觸發、unmount 後不觸發等通用行為，由 useEscapeClose.test.ts 統一覆蓋
});

describe("Workflow Input 限制", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
  });

  it.each([
    ["independent", "chat-input", false],
    ["head", "chat-input", false],
    ["tail", "chat-input", false],
    ["middle", "workflow-blocked-hint", true],
  ])(
    "role=%s → %s 存在，workflow-blocked-hint=%s",
    (role, expectedTestId, hasHint) => {
      // 設定連線使 pod 取得對應 role
      if (role === "head") {
        setupWorkflowConnection("test-pod-1", "other-pod");
      } else if (role === "tail") {
        setupWorkflowConnection("other-pod", "test-pod-1");
      } else if (role === "middle") {
        const connectionStore = useConnectionStore();
        connectionStore.connections = [
          createMockConnection({
            sourcePodId: "upstream",
            targetPodId: "test-pod-1",
          }),
          createMockConnection({
            sourcePodId: "test-pod-1",
            targetPodId: "downstream",
          }),
        ];
      }
      // independent：不設連線，預設空

      const wrapper = mountChatModal();

      expect(wrapper.find(`[data-testid="${expectedTestId}"]`).exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-testid="workflow-blocked-hint"]').exists(),
      ).toBe(hasHint);

      wrapper.unmount();
    },
  );
});

describe("isWorkflowBusy", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
  });

  it("head Pod 在 workflow 執行中且自己不在 chatting，ChatInput 收到 disabled=true", async () => {
    // 設定 pod 為 idle（非 chatting），另一個 pod 為 chatting → BFS 判斷 workflow 執行中
    const podStore = usePodStore();
    podStore.pods = [
      createMockPod({ id: "test-pod-1", status: "idle" }),
      createMockPod({ id: "tail-pod", status: "chatting" }),
    ];
    setupWorkflowConnection("test-pod-1", "tail-pod");

    const pod = createMockPod({ id: "test-pod-1", status: "idle" });
    const wrapper = mount(ChatModal, { props: { pod } });
    await wrapper.vm.$nextTick();

    expect(
      wrapper.find('[data-testid="chat-input"]').attributes("data-disabled"),
    ).toBe("true");
    wrapper.unmount();
  });

  it("head Pod 自己在 chatting 時，ChatInput 不應 disabled（應顯示停止按鈕）", async () => {
    const podStore = usePodStore();
    podStore.pods = [
      createMockPod({ id: "test-pod-1", status: "chatting" }),
      createMockPod({ id: "tail-pod", status: "idle" }),
    ];
    setupWorkflowConnection("test-pod-1", "tail-pod");

    const pod = createMockPod({ id: "test-pod-1", status: "chatting" });
    const wrapper = mount(ChatModal, { props: { pod } });
    await wrapper.vm.$nextTick();

    expect(
      wrapper.find('[data-testid="chat-input"]').attributes("data-disabled"),
    ).not.toBe("true");
    wrapper.unmount();
  });

  it("independent Pod 在 workflow 執行中時，ChatInput 不應 disabled", async () => {
    // independent pod：無連線，另有其他 pod 執行中但不相關
    const podStore = usePodStore();
    podStore.pods = [createMockPod({ id: "test-pod-1", status: "idle" })];
    // 不設置任何連線

    const wrapper = mountChatModal();
    await wrapper.vm.$nextTick();

    expect(
      wrapper.find('[data-testid="chat-input"]').attributes("data-disabled"),
    ).not.toBe("true");
    wrapper.unmount();
  });

  it("tail Pod 在 workflow 執行中且自己不在 chatting，ChatInput 收到 disabled=true", async () => {
    const podStore = usePodStore();
    podStore.pods = [
      createMockPod({ id: "head-pod", status: "chatting" }),
      createMockPod({ id: "test-pod-1", status: "idle" }),
    ];
    setupWorkflowConnection("head-pod", "test-pod-1");

    const pod = createMockPod({ id: "test-pod-1", status: "idle" });
    const wrapper = mount(ChatModal, { props: { pod } });
    await wrapper.vm.$nextTick();

    expect(
      wrapper.find('[data-testid="chat-input"]').attributes("data-disabled"),
    ).toBe("true");
    wrapper.unmount();
  });
});

describe("Integration 綁定 Input 限制", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
  });

  it("有 slack binding 時顯示 slack-blocked-hint，不顯示 ChatInput", () => {
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

  it("有 slack binding 且同時為 middle Pod 時，Integration 提示優先於 Workflow 提示", () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [
      createMockConnection({
        sourcePodId: "upstream",
        targetPodId: "test-pod-1",
      }),
      createMockConnection({
        sourcePodId: "test-pod-1",
        targetPodId: "downstream",
      }),
    ];

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
    wrapper.unmount();
  });

  it("integrationBindings 為空時，維持原本邏輯（顯示 ChatInput）", () => {
    const wrapper = mountChatModal();

    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("Multi-Instance 模式與 Integration Binding 互動", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
  });

  it("multi-instance 且無 integration binding：顯示 ChatMultiInstanceInput，不顯示 blocked-hint", () => {
    mockIsMultiInstanceSourcePod.mockReturnValue(true);
    const wrapper = mountChatModal();

    expect(wrapper.find('[data-testid="multi-instance-input"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-input"]').exists()).toBe(false);
    expect(wrapper.html()).not.toContain("blocked-hint");
    wrapper.unmount();
  });

  it("multi-instance 且有 integration binding：integration 優先，不顯示 ChatMultiInstanceInput", () => {
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

  it("一般模式有 integration binding：顯示 ChatIntegrationBlockedHint，不顯示 ChatInput", () => {
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

describe("聊天送出錯誤", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    mockIsMultiInstanceSourcePod.mockReturnValue(false);
  });

  it("sendMessage 拋錯時，應改寫為 transcript system message", async () => {
    const chatStore = useChatStore();
    vi.spyOn(chatStore, "sendMessage").mockRejectedValue(
      new Error("Authentication failed"),
    );

    const wrapper = mountChatModal();
    wrapper.findComponent({ name: "ChatInput" }).vm.$emit("send", "hello");
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    const messages = chatStore.messagesByPodId.get("test-pod-1");
    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toMatchObject({
      role: "system",
      content: "Authentication failed",
      metadata: {
        severity: "error",
        rawContent: "Authentication failed",
      },
    });
  });
});
