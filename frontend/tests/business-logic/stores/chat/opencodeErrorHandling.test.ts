import { describe, it, expect, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useChatStore, resetChatActionsCache } from "@/stores/chat/chatStore";
import type { PodChatMessagePayload } from "@/types/websocket";

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

describe("opencode_auth_missing 錯誤訊息注入 Pod transcript", () => {
  setupStoreTest(() => {
    resetChatActionsCache();
  });

  function buildAuthMissingPayload(providerID: string): PodChatMessagePayload {
    return {
      podId: "pod-opencode",
      messageId: "msg-auth-error",
      content: `請在 terminal 執行 \`opencode auth login ${providerID}\` 後再試一次`,
      isPartial: false,
      role: "system",
      metadata: {
        provider: "opencode",
        code: "opencode_auth_missing",
        severity: "error",
        rawContent: "No auth credentials found",
      },
    };
  }

  it("收到 opencode_auth_missing 且 providerID 為 openai 時，注入的訊息應包含 openai", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("openai"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages).toHaveLength(1);
    expect(messages![0]!.content).toContain("openai");
  });

  it("收到 opencode_auth_missing 且 providerID 為 openai 時，注入的訊息應包含「opencode auth login」字樣", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("openai"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages![0]!.content).toContain("opencode auth login");
  });

  it("收到 opencode_auth_missing 時，注入的訊息 role 應為 system", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("anthropic"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages![0]!.role).toBe("system");
  });

  it("收到 opencode_auth_missing 時，metadata.code 應保留原始 code", () => {
    const chatStore = useChatStore();

    chatStore.handleChatMessage(buildAuthMissingPayload("openai"));

    const messages = chatStore.messagesByPodId.get("pod-opencode");
    expect(messages![0]!.metadata?.code).toBe("opencode_auth_missing");
  });

  it("非 opencode 錯誤代碼的訊息應原樣顯示，不做 i18n 替換", () => {
    const chatStore = useChatStore();
    const originalContent = "Authentication failed for some other reason";

    chatStore.handleChatMessage({
      podId: "pod-1",
      messageId: "msg-other",
      content: originalContent,
      isPartial: false,
      role: "system",
      metadata: {
        provider: "claude",
        code: "AUTH_ERROR",
        severity: "error",
        rawContent: originalContent,
      },
    });

    const messages = chatStore.messagesByPodId.get("pod-1");
    expect(messages![0]!.content).toBe(originalContent);
  });
});
