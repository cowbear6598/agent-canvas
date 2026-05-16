import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, nextTick } from "vue";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import { usePodCapabilities } from "@/composables/pod/usePodCapabilities";
import { usePodStore } from "@/stores/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { createMockPod } from "../../helpers/factories";

vi.mock("@/services/websocket", async () => {
  const actual = await vi.importActual<typeof import("@/services/websocket")>(
    "@/services/websocket",
  );
  return {
    ...actual,
    createWebSocketRequest: vi.fn().mockResolvedValue({ providers: [] }),
  };
});

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

const CLAUDE_CAPABILITIES = {
  chat: true,
  plugin: true,
  repository: true,
  mcp: true,
  goal: true,
};

const CODEX_CAPABILITIES = {
  chat: true,
  plugin: true,
  repository: true,
  mcp: true,
  goal: true,
};

const OPENCODE_CAPABILITIES = {
  chat: true,
  plugin: false,
  repository: true,
  mcp: true,
  goal: true,
};

const CONSERVATIVE_FALLBACK = {
  chat: true,
  plugin: false,
  repository: false,
  mcp: false,
  goal: false,
};

function injectCapabilities() {
  useProviderCapabilityStore().syncFromPayload([
    { name: "claude", capabilities: CLAUDE_CAPABILITIES },
    { name: "codex", capabilities: CODEX_CAPABILITIES },
    { name: "opencode", capabilities: OPENCODE_CAPABILITIES },
  ]);
}

function setupPod(provider: "claude" | "codex" | "opencode", podId = "pod-1") {
  usePodStore().pods = [createMockPod({ id: podId, provider })];
  return ref(podId);
}

describe("usePodCapabilities", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
  });

  it("claude pod 應回傳完整 claude capabilities", () => {
    injectCapabilities();
    const podId = setupPod("claude");
    const {
      capabilities,
      isCodex,
      isPluginEnabled,
      isRepositoryEnabled,
      isGoalEnabled,
      isMcpEnabled,
    } = usePodCapabilities(podId);

    expect(capabilities.value).toEqual(CLAUDE_CAPABILITIES);
    expect(isCodex.value).toBe(false);
    expect(isPluginEnabled.value).toBe(true);
    expect(isRepositoryEnabled.value).toBe(true);
    expect(isGoalEnabled.value).toBe(true);
    expect(isMcpEnabled.value).toBe(true);
  });

  it("codex pod 應回傳 codex capabilities 並標記 isCodex=true", () => {
    injectCapabilities();
    const podId = setupPod("codex");
    const { capabilities, isCodex, isGoalEnabled } = usePodCapabilities(podId);

    expect(capabilities.value).toEqual(CODEX_CAPABILITIES);
    expect(isCodex.value).toBe(true);
    expect(isGoalEnabled.value).toBe(true);
  });

  it("opencode pod 在 plugin=false 時應反映 disabled 狀態", () => {
    injectCapabilities();
    const podId = setupPod("opencode");
    const {
      capabilities,
      isPluginEnabled,
      isRepositoryEnabled,
      isGoalEnabled,
      isMcpEnabled,
    } = usePodCapabilities(podId);

    expect(capabilities.value).toEqual(OPENCODE_CAPABILITIES);
    expect(isPluginEnabled.value).toBe(false);
    expect(isRepositoryEnabled.value).toBe(true);
    expect(isGoalEnabled.value).toBe(true);
    expect(isMcpEnabled.value).toBe(true);
  });

  it("pod 不存在時應退回保守 fallback", () => {
    const podId = ref("missing-pod");
    const {
      capabilities,
      isCodex,
      isPluginEnabled,
      isRepositoryEnabled,
      isGoalEnabled,
      isMcpEnabled,
    } = usePodCapabilities(podId);

    expect(capabilities.value).toEqual(CONSERVATIVE_FALLBACK);
    expect(isCodex.value).toBe(false);
    expect(isPluginEnabled.value).toBe(false);
    expect(isRepositoryEnabled.value).toBe(false);
    expect(isGoalEnabled.value).toBe(false);
    expect(isMcpEnabled.value).toBe(false);
  });

  it("podId 變更時應重新計算 provider capabilities", async () => {
    injectCapabilities();
    usePodStore().pods = [
      createMockPod({ id: "pod-claude", provider: "claude" }),
      createMockPod({ id: "pod-codex", provider: "codex" }),
    ];

    const podId = ref("pod-claude");
    const { isCodex, capabilities } = usePodCapabilities(podId);

    expect(isCodex.value).toBe(false);
    expect(capabilities.value).toEqual(CLAUDE_CAPABILITIES);

    podId.value = "pod-codex";
    await nextTick();

    expect(isCodex.value).toBe(true);
    expect(capabilities.value).toEqual(CODEX_CAPABILITIES);
  });

  it("capability store 更新後，goal / plugin 等 flags 應同步更新", async () => {
    injectCapabilities();
    const podId = setupPod("claude");
    const capabilityStore = useProviderCapabilityStore();
    const { isPluginEnabled, isGoalEnabled } = usePodCapabilities(podId);

    expect(isPluginEnabled.value).toBe(true);
    expect(isGoalEnabled.value).toBe(true);

    capabilityStore.syncFromPayload([
      {
        name: "claude",
        capabilities: {
          ...CLAUDE_CAPABILITIES,
          plugin: false,
          goal: false,
        },
      },
    ]);
    await nextTick();

    expect(isPluginEnabled.value).toBe(false);
    expect(isGoalEnabled.value).toBe(false);
  });
});
