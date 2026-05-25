import { describe, expect, it, vi, beforeEach } from "vitest";
import { useOpencodeProviderPanel } from "@/composables/settings/useOpencodeProviderPanel";
import type { OpencodeProviderInfo } from "@/types/opencode";

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, payload?: Record<string, string>) =>
      payload?.reason ? `${key}:${payload.reason}` : key,
  }),
}));

const makeProvider = (
  overrides?: Partial<OpencodeProviderInfo>,
): OpencodeProviderInfo => ({
  id: "openai",
  name: "OpenAI",
  models: [{ id: "gpt-4o", name: "GPT-4o" }],
  ...overrides,
});

describe("useOpencodeProviderPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("載入 provider 清單後會把已連線 provider 排在前面並支援搜尋", async () => {
    const listOpencodeProviders = vi.fn().mockResolvedValue({
      all: [
        makeProvider({ id: "anthropic", name: "Anthropic" }),
        makeProvider({ id: "openai", name: "OpenAI" }),
      ],
      default: {},
      connected: ["openai"],
    });

    const panel = useOpencodeProviderPanel({ listOpencodeProviders });

    await panel.loadFromBackend();

    expect(panel.loadState.value).toBe("loaded");
    expect(panel.connectedProviders.value.map((provider) => provider.id)).toEqual([
      "openai",
    ]);
    expect(
      panel.sortedFilteredProviders.value.map((provider) => provider.id),
    ).toEqual(["openai", "anthropic"]);

    panel.providerSearch.value = "anth";

    expect(
      panel.sortedFilteredProviders.value.map((provider) => provider.id),
    ).toEqual(["anthropic"]);
  });

  it("重啟 OpenCode 成功後會沿用既有 API 流程重新載入 provider", async () => {
    const listOpencodeProviders = vi
      .fn()
      .mockResolvedValueOnce({
        all: [makeProvider({ id: "openai", name: "OpenAI" })],
        default: {},
        connected: [],
      })
      .mockResolvedValueOnce({
        all: [makeProvider({ id: "openai", name: "OpenAI" })],
        default: {},
        connected: ["openai"],
      });
    const restartOpencodeServer = vi.fn().mockResolvedValue(undefined);

    const panel = useOpencodeProviderPanel({
      listOpencodeProviders,
      restartOpencodeServer,
    });

    await panel.loadFromBackend();
    await panel.handleRestartOpencode();

    expect(restartOpencodeServer).toHaveBeenCalledTimes(1);
    expect(listOpencodeProviders).toHaveBeenCalledTimes(2);
    expect(panel.isConnectedProvider("openai")).toBe(true);
    expect(toastMock).toHaveBeenCalledWith({
      title: "llmProvider.opencode.providerList.restartSuccess",
    });
  });
});
