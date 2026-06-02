import { describe, expect, it, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { usePodStore } from "@/stores/pod/podStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { createMockPod } from "@tests/helpers/factories";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import PodContextMenu from "@/components/canvas/PodContextMenu.vue";
import i18n from "@/i18n";

vi.mock("@/services/podApi", () => ({
  downloadPodDirectory: vi.fn(),
}));

vi.mock("@/composables/canvas/useDownloadProgress", () => ({
  useDownloadProgress: () => ({
    addTask: vi.fn(),
    updateProgress: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
  }),
}));

async function mountPodContextMenu() {
  const mounted = await mountUserFlowApp({
    component: PodContextMenu,
    props: {
      position: { x: 100, y: 120 },
      podId: "pod-1",
    },
  });

  const podStore = usePodStore();
  const providerCapabilityStore = useProviderCapabilityStore();

  podStore.pods = [
    createMockPod({
      id: "pod-1",
      provider: "claude",
      providerConfig: { model: "sonnet" },
      integrationBindings: [
        {
          provider: "slack",
          appId: "app-1",
          resourceId: "channel-1",
          extra: {},
        },
      ],
    }),
  ];

  providerCapabilityStore.syncFromPayload([
    {
      name: "claude",
      defaultOptions: { model: "sonnet" },
      availableModels: [{ label: "Sonnet", value: "sonnet" }],
    },
    {
      name: "codex",
      defaultOptions: { model: "gpt-5.4" },
      availableModels: [{ label: "GPT-5.4", value: "gpt-5.4" }],
    },
    {
      name: "opencode",
      defaultOptions: {},
      availableModels: [],
    },
  ]);

  await nextTick();

  return mounted;
}

function getButtonByText(
  wrapper: Awaited<ReturnType<typeof mountPodContextMenu>>["wrapper"],
  text: string,
) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes(text));
}

function getToggleRow(
  wrapper: Awaited<ReturnType<typeof mountPodContextMenu>>["wrapper"],
  testId: string,
) {
  return wrapper.get(`[data-testid="${testId}"]`);
}

describe("pod context menu userflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("展開 provider 子選單後，點擊 provider 項目會送出切換事件並關閉選單", async () => {
    const { wrapper, unmount } = await mountPodContextMenu();

    const submenuGroups = wrapper.findAll(".relative");
    await submenuGroups[0]?.trigger("mouseenter");
    await nextTick();

    expect(wrapper.text()).toContain("Claude");
    expect(wrapper.text()).toContain("Codex");
    expect(wrapper.text()).toContain("OpenCode");

    await getButtonByText(wrapper, "Codex")?.trigger("click");

    expect(wrapper.emitted("switch-provider")).toEqual([
      ["pod-1", "codex", { model: "gpt-5.4" }],
    ]);
    expect(wrapper.emitted("close")).toHaveLength(1);

    unmount();
  });

  it("展開 integrations 子選單後，點擊已綁定 provider 會走 disconnect handler", async () => {
    const { wrapper, unmount } = await mountPodContextMenu();

    const submenuGroups = wrapper.findAll(".relative");
    await submenuGroups[1]?.trigger("mouseenter");
    await nextTick();

    const disconnectSlackLabel = i18n.global.t(
      "canvas.podContextMenu.disconnect",
      { label: "Slack" },
    );
    expect(wrapper.text()).toContain(disconnectSlackLabel);

    await getButtonByText(wrapper, disconnectSlackLabel)?.trigger("click");

    expect(wrapper.emitted("disconnect-integration")).toEqual([
      ["pod-1", "slack"],
    ]);
    expect(wrapper.emitted("close")).toHaveLength(1);

    unmount();
  });

  it("memory 已啟用且已有記憶時，右鍵選單會提供 toggle 與清除入口", async () => {
    const { wrapper, unmount } = await mountPodContextMenu();
    const podStore = usePodStore();

    podStore.pods = [
      createMockPod({
        id: "pod-1",
        memoryEnabled: true,
        hasPodMemory: true,
      }),
    ];

    await nextTick();

    const podMemoryLabel = i18n.global.t("canvas.podContextMenu.podMemory");
    const clearMemoryLabel = i18n.global.t("canvas.podContextMenu.clearMemory");
    const viewPodMemoryLabel = i18n.global.t(
      "canvas.podContextMenu.viewPodMemory",
    );

    expect(wrapper.text()).toContain(podMemoryLabel);

    await getToggleRow(wrapper, "pod-memory-toggle-row").trigger("click");
    expect(wrapper.emitted("set-memory-enabled")).toEqual([["pod-1", false]]);
    expect(wrapper.emitted("close")).toBeUndefined();

    await getButtonByText(wrapper, viewPodMemoryLabel)?.trigger("click");
    expect(wrapper.emitted("view-pod-memory")).toEqual([["pod-1"]]);
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.setProps({ podId: "pod-1" });
    await nextTick();
    await getButtonByText(wrapper, clearMemoryLabel)?.trigger("click");
    expect(wrapper.emitted("clear-memory")).toEqual([["pod-1"]]);
    expect(wrapper.emitted("close")).toHaveLength(2);

    unmount();
  });

  it("綁定 repository 時，右鍵選單會提供 repo memory toggle", async () => {
    const { wrapper, unmount } = await mountPodContextMenu();
    const podStore = usePodStore();

    podStore.pods = [
      createMockPod({
        id: "pod-1",
        repositoryId: "repo-1",
        repoMemoryEnabled: false,
        hasRepoMemory: true,
      }),
    ];

    await nextTick();

    const repoMemoryLabel = i18n.global.t("canvas.podContextMenu.repoMemory");
    const viewRepoMemoryLabel = i18n.global.t(
      "canvas.podContextMenu.viewRepoMemory",
    );
    const clearRepoMemoryLabel = i18n.global.t(
      "canvas.podContextMenu.clearRepoMemory",
    );

    expect(wrapper.text()).toContain(repoMemoryLabel);

    await getToggleRow(wrapper, "repo-memory-toggle-row").trigger("click");
    expect(wrapper.emitted("set-repo-memory-enabled")).toEqual([
      ["repo-1", true],
    ]);
    expect(wrapper.emitted("close")).toBeUndefined();

    await getButtonByText(wrapper, viewRepoMemoryLabel)?.trigger("click");
    expect(wrapper.emitted("view-repo-memory")).toEqual([["repo-1"]]);
    expect(wrapper.emitted("close")).toHaveLength(1);

    await wrapper.setProps({ podId: "pod-1" });
    await nextTick();
    await getButtonByText(wrapper, clearRepoMemoryLabel)?.trigger("click");
    expect(wrapper.emitted("clear-repo-memory")).toEqual([["repo-1"]]);
    expect(wrapper.emitted("close")).toHaveLength(2);

    unmount();
  });

  it("未綁定 repository 時，repo memory 相關項目應顯示但為 disabled", async () => {
    const { wrapper, unmount } = await mountPodContextMenu();
    const podStore = usePodStore();

    podStore.pods = [
      createMockPod({
        id: "pod-1",
        repositoryId: null,
        repoMemoryEnabled: false,
        hasRepoMemory: false,
      }),
    ];

    await nextTick();

    const repoToggleRow = getToggleRow(wrapper, "repo-memory-toggle-row");
    const viewRepoMemoryLabel = i18n.global.t(
      "canvas.podContextMenu.viewRepoMemory",
    );
    const clearRepoMemoryLabel = i18n.global.t(
      "canvas.podContextMenu.clearRepoMemory",
    );

    expect(repoToggleRow.classes()).toContain("cursor-not-allowed");

    const viewRepoMemoryButton = getButtonByText(wrapper, viewRepoMemoryLabel);
    const clearRepoMemoryButton = getButtonByText(wrapper, clearRepoMemoryLabel);

    expect(viewRepoMemoryButton?.attributes("disabled")).toBeDefined();
    expect(clearRepoMemoryButton?.attributes("disabled")).toBeDefined();

    await repoToggleRow.trigger("click");
    await viewRepoMemoryButton?.trigger("click");
    await clearRepoMemoryButton?.trigger("click");

    expect(wrapper.emitted("set-repo-memory-enabled")).toBeUndefined();
    expect(wrapper.emitted("view-repo-memory")).toBeUndefined();
    expect(wrapper.emitted("clear-repo-memory")).toBeUndefined();

    unmount();
  });
});
