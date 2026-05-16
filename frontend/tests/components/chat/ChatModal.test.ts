import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { createMockPod, createMockConnection } from "../../helpers/factories";
import { useConnectionStore } from "@/stores/connectionStore";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import ChatModal from "@/components/chat/ChatModal.vue";

vi.mock("@/services/websocket", () => webSocketMockFactory());

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

const openHistoryPanelSpy = vi.fn();
vi.mock("@/stores/run/runStore", () => ({
  useRunStore: () => ({ openHistoryPanel: openHistoryPanelSpy }),
}));

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

describe("ChatModal ESC 鍵行為", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    openHistoryPanelSpy.mockClear();
  });

  afterEach(() => {
    document
      .querySelectorAll('[data-state="open"][role="dialog"]')
      .forEach((el) => el.remove());
  });

  it("按 ESC 時無 Dialog 開啟,應觸發 close emit", () => {
    const wrapper = mountChatModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("按 ESC 時有 reka-ui Dialog 開啟中,不應觸發 close emit", () => {
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
});

describe("Workflow Input 限制", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    openHistoryPanelSpy.mockClear();
  });

  it.each([
    ["independent", "chat-launch-textarea", false],
    ["head", "chat-launch-textarea", false],
    ["tail", "chat-launch-textarea", false],
    ["middle", "workflow-blocked-hint", true],
  ])(
    "role=%s → %s 存在,workflow-blocked-hint=%s",
    (role, expectedTestId, hasHint) => {
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

describe("Integration 綁定 Input 限制", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    openHistoryPanelSpy.mockClear();
  });

  it("有 slack binding 時顯示 slack-blocked-hint,不顯示 textarea", () => {
    const wrapper = mountChatModal({
      integrationBindings: [
        { provider: "slack", appId: "app-1", resourceId: "ch-1", extra: {} },
      ],
    });
    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="chat-launch-textarea"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("integration 提示優先於 workflow 提示（中段 Pod + slack binding）", () => {
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
    const wrapper = mountChatModal({
      integrationBindings: [
        { provider: "slack", appId: "app-1", resourceId: "ch-1", extra: {} },
      ],
    });
    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="workflow-blocked-hint"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
});

describe("送出訊息 → 啟動 Run 流程", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
    openHistoryPanelSpy.mockClear();
  });

  it("有內容時點送出 → 呼叫 chatStore.sendMessage、openHistoryPanel,並關閉 modal", async () => {
    const chatStore = useChatStore();
    const sendSpy = vi
      .spyOn(chatStore, "sendMessage")
      .mockResolvedValue(undefined);

    const wrapper = mountChatModal();
    const textarea = wrapper.find<HTMLTextAreaElement>(
      '[data-testid="chat-launch-textarea"]',
    );
    await textarea.setValue("hello");
    await wrapper.find('[data-testid="chat-launch-send"]').trigger("click");
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(sendSpy).toHaveBeenCalledWith("test-pod-1", "hello");
    expect(openHistoryPanelSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("空字串時點送出 → 不呼叫 sendMessage、不關閉 modal", async () => {
    const chatStore = useChatStore();
    const sendSpy = vi.spyOn(chatStore, "sendMessage");

    const wrapper = mountChatModal();
    await wrapper
      .find<HTMLTextAreaElement>('[data-testid="chat-launch-textarea"]')
      .setValue("   ");
    await wrapper.find('[data-testid="chat-launch-send"]').trigger("click");
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(sendSpy).not.toHaveBeenCalled();
    expect(openHistoryPanelSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toBeFalsy();
    wrapper.unmount();
  });
});
