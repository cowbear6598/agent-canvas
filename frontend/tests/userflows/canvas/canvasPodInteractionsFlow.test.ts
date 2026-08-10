import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useViewportStore } from "@/stores/pod";
import { useUploadStore } from "@/stores/upload/uploadStore";
import type { Pod } from "@/types";
import type { Connection } from "@/types/connection";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const { mockToast, acceptedDropPodIds, disabledDropAttempts } = vi.hoisted(
  () => ({
    mockToast: vi.fn(),
    acceptedDropPodIds: [] as string[],
    disabledDropAttempts: [] as boolean[],
  }),
);

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}));

vi.mock("@/composables/useSendCanvasAction", () => ({
  useSendCanvasAction: () => ({
    sendCanvasAction: vi.fn(),
  }),
}));

vi.mock("@/composables/pod/usePodFileDrop", async () => {
  const { ref } = await import("vue");
  return {
    usePodFileDrop: (options: { disabled: () => boolean }) => ({
      isDragOver: ref(false),
      handleDragEnter: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDropEvent: vi.fn(async (event: DragEvent, podId: string) => {
        event.preventDefault();
        const disabled = options.disabled();
        disabledDropAttempts.push(disabled);
        if (!disabled) acceptedDropPodIds.push(podId);
      }),
    }),
  };
});

function makePod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Pod 1",
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "sonnet" },
    pluginIds: [],
    ...overrides,
  };
}

function connectionToPod(podId: string): Connection {
  return {
    id: `conn-${podId}`,
    sourcePodId: "source-pod",
    sourceAnchor: "right",
    targetPodId: podId,
    targetAnchor: "left",
    decideStatus: "none",
    triggerMode: "auto",
    direct: false,
  };
}

function createDropEvent(): DragEvent {
  return new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
}

function mountPod(pod: Pod) {
  return mount(CanvasPod, {
    props: { pod },
    attachTo: document.body,
    global: {
      stubs: {
        PodModelSelector: { template: "<div />" },
        PodHeader: { template: "<div />" },
        PodUploadOverlay: {
          template: '<div data-testid="upload-overlay" />',
        },
        PodAnchors: { template: '<div data-testid="pod-anchors" />' },
        PodActions: { template: '<div data-testid="pod-actions" />' },
        IntegrationStatusIcon: { template: "<div />" },
        ScheduleModal: { template: "<div />" },
        PluginPopover: {
          props: ["podId", "anchorRect"],
          template: '<div data-testid="plugin-popover" />',
        },
        McpPopover: {
          props: ["podId", "anchorRect"],
          template: '<div data-testid="mcp-popover" />',
        },
        ThinkingPopover: {
          props: ["podId", "anchorRect"],
          template: '<div data-testid="thinking-popover" />',
        },
        PodSlots: {
          emits: ["plugin-clicked", "mcp-clicked", "thinking-clicked"],
          template: `
            <div>
              <button class="plugin-slot" @click="$emit('plugin-clicked', $event)">plugins</button>
              <button class="mcp-slot" @click="$emit('mcp-clicked', $event)">mcp</button>
              <button class="thinking-slot" @click="$emit('thinking-clicked', $event)">thinking</button>
            </div>
          `,
        },
      },
    },
  });
}

describe("CanvasPod user interactions", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    const providerCapabilityStore = useProviderCapabilityStore();
    providerCapabilityStore.syncFromPayload([
      {
        name: "claude",
        availableModels: [{ label: "Sonnet", value: "sonnet" }],
      },
    ]);
    providerCapabilityStore.loaded = true;
    acceptedDropPodIds.length = 0;
    disabledDropAttempts.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("使用者開啟 Plugin、MCP、Thinking popover 後，移動畫布會關閉已開啟的 popover", async () => {
    const wrapper = mountPod(
      makePod({ pluginIds: ["plugin-a"], mcpServerNames: ["server-a"] }),
    );

    await wrapper.find(".plugin-slot").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="plugin-popover"]').exists()).toBe(true);

    await wrapper.find(".mcp-slot").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="mcp-popover"]').exists()).toBe(true);

    await wrapper.find(".thinking-slot").trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="thinking-popover"]').exists()).toBe(
      true,
    );

    const viewportStore = useViewportStore();
    viewportStore.setOffset(24, 36);
    await flushPromises();

    expect(wrapper.find('[data-testid="plugin-popover"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mcp-popover"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="thinking-popover"]').exists()).toBe(
      false,
    );
  });

  it("使用者拖放檔案到可互動 pod 時，drop 事件會帶入目前 pod id", async () => {
    const wrapper = mountPod(makePod({ id: "pod-drop" }));

    await wrapper.find(".absolute.select-none").element.dispatchEvent(
      createDropEvent(),
    );
    await nextTick();

    expect(disabledDropAttempts).toEqual([false]);
    expect(acceptedDropPodIds).toEqual(["pod-drop"]);
  });

  it("未知 provider 會阻擋雙擊進入對話與檔案拖放", async () => {
    const wrapper = mountPod(
      makePod({ id: "pod-unknown", provider: "missing-provider" as any }),
    );

    await wrapper.find(".pod-doodle").trigger("dblclick");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "此 Provider 已下線或尚未支援，無法開啟對話",
      }),
    );

    await wrapper.find(".absolute.select-none").element.dispatchEvent(
      createDropEvent(),
    );
    await nextTick();

    expect(disabledDropAttempts).toEqual([true]);
    expect(acceptedDropPodIds).toEqual([]);
  });

  it("下游 chain pod 會阻擋檔案拖放", async () => {
    const connectionStore = useConnectionStore();
    connectionStore.connections = [connectionToPod("pod-target")];
    const wrapper = mountPod(makePod({ id: "pod-target" }));

    await wrapper.find(".absolute.select-none").element.dispatchEvent(
      createDropEvent(),
    );
    await nextTick();

    expect(disabledDropAttempts).toEqual([true]);
    expect(acceptedDropPodIds).toEqual([]);
  });

  it("上傳失敗待重試時，overlay 應覆蓋完整 Pod 並封鎖其他互動", async () => {
    const podId = "pod-upload-failed";
    const wrapper = mountPod(makePod({ id: podId }));
    const uploadStore = useUploadStore();
    uploadStore.startUpload(podId, [new File(["content"], "broken.zip")]);
    const fileEntry = uploadStore.getUploadState(podId).files[0];
    if (!fileEntry) throw new Error("測試上傳檔案狀態未建立");
    uploadStore.markFileFailed(
      podId,
      fileEntry.id,
      "ATTACHMENT_INVALID_ARCHIVE",
    );
    uploadStore.finalizeUpload(podId);
    await nextTick();

    expect(
      wrapper.find('.pod-doodle > [data-testid="upload-overlay"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="pod-anchors"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pod-actions"]').exists()).toBe(false);

    await wrapper.find(".absolute.select-none").element.dispatchEvent(
      createDropEvent(),
    );
    await nextTick();

    expect(disabledDropAttempts).toEqual([true]);
    expect(acceptedDropPodIds).toEqual([]);
  });
});
