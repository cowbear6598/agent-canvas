/**
 * CanvasPod 元件測試（合併版）
 *
 * 涵蓋：
 * - render smoke
 * - podStatusClass 白名單 / pod-glow-selected
 * - provider 漸層 class / unknown provider fallback badge + 雙擊守門
 * - 拖曳高亮（dragenter / dragleave CSS class）
 * - 上傳中互動封鎖（PodActions isUploading、contextmenu、PodAnchors v-if、PodUploadOverlay）
 * - MCP / Plugin popover 開關與 busy prop 傳遞
 * - PodSlots mcpActiveCount / pluginActiveCount 計數傳遞
 * - handleModelChange 成功更新 podStore
 *
 * 細節行為已在 composable 測試涵蓋：
 * - usePodFileDrop.test.ts — dragEvent 驗證、handleDrop 流程、retryFailed
 * - usePodCapabilities.test.ts — capabilities 邏輯
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia } from "pinia";
import { setupTestPinia } from "../../helpers/mockStoreFactory";
import CanvasPod from "@/components/pod/CanvasPod.vue";
import { usePodStore } from "@/stores/pod/podStore";
import { useSelectionStore } from "@/stores/pod/selectionStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useUploadStore } from "@/stores/upload/uploadStore";
import type { Pod } from "@/types";

// ── 邊界 mock：WS 與 Toast ─────────────────────────────────────────────────
// 使用 vi.hoisted 確保 mock factory 能在模組初始化前取得 spy 實例

const { mockCreateWebSocketRequest, mockToast } = vi.hoisted(() => ({
  mockCreateWebSocketRequest: vi.fn().mockResolvedValue({}),
  mockToast: vi.fn(),
}));

vi.mock("@/services/websocket", async () => {
  const actual = await vi.importActual<typeof import("@/services/websocket")>(
    "@/services/websocket",
  );
  return {
    ...actual,
    createWebSocketRequest: (...args: unknown[]) =>
      mockCreateWebSocketRequest(...args),
  };
});

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── 複雜子元件 stub（有外部 API 呼叫，不適合在元件測試環境中執行）──────────────

vi.mock("@/components/pod/PluginPopover.vue", () => ({
  default: {
    name: "PluginPopover",
    template:
      "<div class='plugin-popover-stub' @click=\"$emit('close')\"></div>",
    props: ["podId", "anchorRect", "busy", "provider"],
    emits: ["close"],
  },
}));

vi.mock("@/components/pod/McpPopover.vue", () => ({
  default: {
    name: "McpPopover",
    template:
      "<div class='mcp-popover-stub' :data-pod-id='podId' :data-busy='String(busy)' :data-provider='provider' @click=\"$emit('close')\"></div>",
    props: ["podId", "anchorRect", "busy", "provider"],
    emits: ["close"],
  },
}));

vi.mock("@/components/canvas/ScheduleModal.vue", () => ({
  default: {
    name: "ScheduleModal",
    template: "<div></div>",
    props: ["open", "podId", "existingSchedule"],
  },
}));

// ── 工具函式 ───────────────────────────────────────────────────────────────

function mkPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: "pod-1",
    name: "Test Pod",
    x: 0,
    y: 0,
    output: [],
    rotation: 0,
    multiInstance: false,
    provider: "claude",
    providerConfig: { model: "claude-sonnet-4-5" },
    ...overrides,
  };
}

const mountPod = (pod: Pod) =>
  mount(CanvasPod, { props: { pod }, attachTo: document.body });

/** 注入 claude + codex capabilities，模擬後端 metadata 已載入（含 loaded=true） */
function injectCapabilities() {
  const store = useProviderCapabilityStore();
  store.syncFromPayload([
    {
      name: "claude",
      capabilities: {
        chat: true,
        plugin: true,
        repository: true,
        command: true,
        mcp: true,
      },
    },
    {
      name: "codex",
      capabilities: {
        chat: true,
        plugin: true,
        repository: true,
        command: true,
        mcp: true,
      },
    },
  ]);
  // syncFromPayload 本身不設 loaded，手動設定以模擬 loadFromBackend 完成
  store.loaded = true;
}

/**
 * 注入 gemini capabilities（chat only），並同時保留 claude/codex，
 * 模擬 Gemini 相關測試所需的 metadata 環境。
 */
function injectGeminiCapabilities() {
  const store = useProviderCapabilityStore();
  store.syncFromPayload([
    {
      name: "claude",
      capabilities: {
        chat: true,
        plugin: true,
        repository: true,
        command: true,
        mcp: true,
      },
    },
    {
      name: "codex",
      capabilities: {
        chat: true,
        plugin: true,
        repository: true,
        command: true,
        mcp: true,
      },
    },
    {
      name: "gemini",
      capabilities: {
        chat: true,
        plugin: false,
        repository: false,
        command: false,
        mcp: false,
      },
    },
  ]);
  store.loaded = true;
}

// ── 全域 beforeEach ────────────────────────────────────────────────────────

beforeEach(() => {
  setActivePinia(setupTestPinia());
  vi.clearAllMocks();
  mockCreateWebSocketRequest.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Render smoke
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod render smoke", () => {
  it("有效 pod prop 應正常掛載並渲染 pod-doodle", () => {
    const wrapper = mountPod(mkPod());
    expect(wrapper.find(".pod-doodle").exists()).toBe(true);
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. podStatusClass 白名單
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod podStatusClass 白名單", () => {
  it.each([
    { status: "chatting", cls: "pod-status-chatting" },
    { status: "summarizing", cls: "pod-status-summarizing" },
    { status: "error", cls: "pod-status-error" },
    { status: "idle", cls: "pod-status-idle" },
  ])('status="$status" → pod-glow-layer 含 $cls', ({ status, cls }) => {
    const wrapper = mountPod(mkPod({ status: status as Pod["status"] }));
    expect(wrapper.find(".pod-glow-layer").classes()).toContain(cls);
    wrapper.unmount();
  });

  it("未知 status 不應套用任何 pod-status-* class", () => {
    const wrapper = mountPod(mkPod({ status: "unknown" as Pod["status"] }));
    expect(
      wrapper
        .find(".pod-glow-layer")
        .classes()
        .some((c) => c.startsWith("pod-status-")),
    ).toBe(false);
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. pod-glow-selected
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod pod-glow-selected", () => {
  it("pod 被選取後 .pod-inner-highlight 含 pod-glow-selected", async () => {
    const wrapper = mountPod(mkPod({ id: "pod-sel" }));
    useSelectionStore().toggleElement({ type: "pod", id: "pod-sel" });
    await nextTick();
    expect(wrapper.find(".pod-inner-highlight").classes()).toContain(
      "pod-glow-selected",
    );
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. provider 漸層 class
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod provider 漸層 class", () => {
  it.each([
    { provider: "claude", expectedCls: "pod-provider-claude" },
    { provider: "codex", expectedCls: "pod-provider-codex" },
  ])(
    "provider=$provider → pod-doodle 含 $expectedCls",
    async ({ provider, expectedCls }) => {
      const wrapper = mountPod(
        mkPod({ provider: provider as Pod["provider"] }),
      );
      injectCapabilities();
      await nextTick();
      expect(wrapper.find(".pod-doodle").classes()).toContain(expectedCls);
      wrapper.unmount();
    },
  );

  it("未知 provider → pod-doodle 不含任何 pod-provider-* class", async () => {
    const wrapper = mountPod(mkPod({ provider: "gone" as Pod["provider"] }));
    injectCapabilities();
    await nextTick();
    expect(
      wrapper
        .find(".pod-doodle")
        .classes()
        .some((c) => c.startsWith("pod-provider-")),
    ).toBe(false);
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. unknown provider fallback badge + 雙擊守門
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod unknown provider", () => {
  it("store 載入後 provider 未知時顯示 unknown-provider-badge", async () => {
    const wrapper = mountPod(
      mkPod({ provider: "deprecated" as Pod["provider"] }),
    );
    injectCapabilities();
    await nextTick();
    expect(
      wrapper.find("[data-testid='unknown-provider-badge']").exists(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("store 載入後 provider 已知（claude）時不顯示 badge", async () => {
    const wrapper = mountPod(mkPod({ provider: "claude" }));
    injectCapabilities();
    await nextTick();
    expect(
      wrapper.find("[data-testid='unknown-provider-badge']").exists(),
    ).toBe(false);
    wrapper.unmount();
  });

  it("store 尚未載入（loaded=false）時不顯示 badge（避免時序誤判）", async () => {
    const wrapper = mountPod(
      mkPod({ provider: "unknown-p" as Pod["provider"] }),
    );
    // 不呼叫 injectCapabilities → loaded 維持 false
    await nextTick();
    expect(
      wrapper.find("[data-testid='unknown-provider-badge']").exists(),
    ).toBe(false);
    wrapper.unmount();
  });

  it("未知 provider 雙擊應顯示 toast 並阻止進入對話", async () => {
    const wrapper = mountPod(
      mkPod({ provider: "deprecated" as Pod["provider"] }),
    );
    injectCapabilities();
    await nextTick();
    await wrapper.find(".pod-doodle").trigger("dblclick");
    // 未知 provider 雙擊應顯示 toast（title 含 "Provider"，description 說明不可用）
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("Provider") }),
    );
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. 拖曳高亮 class
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod 拖曳高亮", () => {
  it("dragenter 後套用 pod-glow-drop-target，dragleave 後移除", async () => {
    const wrapper = mountPod(mkPod({ status: "idle" }));
    injectCapabilities();
    await nextTick();

    wrapper.element.dispatchEvent(new Event("dragenter", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".pod-inner-highlight").classes()).toContain(
      "pod-glow-drop-target",
    );

    const leaveEvent = new Event("dragleave", { bubbles: true }) as DragEvent;
    Object.defineProperty(leaveEvent, "currentTarget", {
      value: wrapper.element,
      configurable: true,
    });
    Object.defineProperty(leaveEvent, "relatedTarget", {
      value: document.createElement("span"),
      configurable: true,
    });
    wrapper.element.dispatchEvent(leaveEvent);
    await nextTick();
    expect(wrapper.find(".pod-inner-highlight").classes()).not.toContain(
      "pod-glow-drop-target",
    );

    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. 上傳中互動封鎖
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod 上傳中互動封鎖", () => {
  /** 直接設定 uploadStore state，使 isUploading(podId) getter 回傳 true */
  function setUploading(podId: string) {
    const uploadStore = useUploadStore();
    uploadStore.uploadStateByPodId[podId] = {
      status: "uploading",
      uploadSessionId: "s1",
      files: [],
      aggregateProgress: 50,
    };
  }

  beforeEach(() => injectCapabilities());

  it("上傳中 PodActions 應收到 isUploading=true", async () => {
    const wrapper = mountPod(mkPod({ id: "pod-upload" }));
    setUploading("pod-upload");
    await nextTick();
    expect(
      wrapper.findComponent({ name: "PodActions" }).props("isUploading"),
    ).toBe(true);
    wrapper.unmount();
  });

  it("上傳中右鍵選單不應觸發 contextmenu emit", async () => {
    const wrapper = mountPod(mkPod({ id: "pod-1" }));
    setUploading("pod-1");
    await nextTick();
    await wrapper.find(".pod-doodle").trigger("contextmenu");
    expect(wrapper.emitted("contextmenu")).toBeFalsy();
    wrapper.unmount();
  });

  it("上傳中 PodAnchors 應從 DOM 移除（v-if=false）", async () => {
    const wrapper = mountPod(mkPod({ id: "pod-1" }));
    setUploading("pod-1");
    await nextTick();
    expect(wrapper.findComponent({ name: "PodAnchors" }).exists()).toBe(false);
    wrapper.unmount();
  });

  it("上傳中應渲染 PodUploadOverlay 封鎖聊天區", async () => {
    const wrapper = mountPod(mkPod({ id: "pod-1" }));
    setUploading("pod-1");
    await nextTick();
    expect(wrapper.findComponent({ name: "PodUploadOverlay" }).exists()).toBe(
      true,
    );
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. MCP / Plugin popover 開關與 props
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod MCP / Plugin popover", () => {
  beforeEach(() => injectCapabilities());

  it("點擊 .pod-mcp-slot 後 McpPopover 應渲染", async () => {
    const wrapper = mountPod(mkPod());
    await nextTick();
    await wrapper.find(".pod-mcp-slot").trigger("click");
    expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);
    wrapper.unmount();
  });

  it("McpPopover emit close 後 popover 應消失", async () => {
    const wrapper = mountPod(mkPod());
    await nextTick();
    await wrapper.find(".pod-mcp-slot").trigger("click");
    await wrapper.find(".mcp-popover-stub").trigger("click");
    expect(wrapper.find(".mcp-popover-stub").exists()).toBe(false);
    wrapper.unmount();
  });

  it("McpPopover 應接收正確 podId 與 provider", async () => {
    const wrapper = mountPod(mkPod({ id: "pod-mcp", provider: "claude" }));
    await nextTick();
    await wrapper.find(".pod-mcp-slot").trigger("click");
    const stub = wrapper.find(".mcp-popover-stub");
    expect(stub.attributes("data-pod-id")).toBe("pod-mcp");
    expect(stub.attributes("data-provider")).toBe("claude");
    wrapper.unmount();
  });

  it("Pod busy（chatting）時 McpPopover busy 應為 true", async () => {
    const wrapper = mountPod(mkPod({ status: "chatting" as Pod["status"] }));
    await nextTick();
    await wrapper.find(".pod-mcp-slot").trigger("click");
    expect(wrapper.find(".mcp-popover-stub").attributes("data-busy")).toBe(
      "true",
    );
    wrapper.unmount();
  });

  it("開啟 MCP popover 時 Plugin popover 不應渲染", async () => {
    const wrapper = mountPod(mkPod());
    await nextTick();
    await wrapper.find(".pod-mcp-slot").trigger("click");
    expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);
    expect(wrapper.find(".plugin-popover-stub").exists()).toBe(false);
    wrapper.unmount();
  });

  it("第二次點擊 .pod-mcp-slot 應 toggle 關閉 McpPopover", async () => {
    const wrapper = mountPod(mkPod());
    await nextTick();
    await wrapper.find(".pod-mcp-slot").trigger("click");
    expect(wrapper.find(".mcp-popover-stub").exists()).toBe(true);
    await wrapper.find(".pod-mcp-slot").trigger("click");
    expect(wrapper.find(".mcp-popover-stub").exists()).toBe(false);
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. PodSlots 計數 props
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod PodSlots 計數 props", () => {
  it("pod.mcpServerNames 有 2 個時 PodSlots 應收到 mcpActiveCount=2", () => {
    injectCapabilities();
    const wrapper = mountPod(mkPod({ mcpServerNames: ["a", "b"] }));
    expect(
      wrapper.findComponent({ name: "PodSlots" }).props("mcpActiveCount"),
    ).toBe(2);
    wrapper.unmount();
  });

  it("pod.pluginIds 有 3 個時 PodSlots 應收到 pluginActiveCount=3", () => {
    injectCapabilities();
    const wrapper = mountPod(mkPod({ pluginIds: ["p1", "p2", "p3"] }));
    expect(
      wrapper.findComponent({ name: "PodSlots" }).props("pluginActiveCount"),
    ).toBe(3);
    wrapper.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10.5 Gemini provider — 漸層 class 與 capability disabled 行為
// ─────────────────────────────────────────────────────────────────────────

describe("CanvasPod Gemini provider", () => {
  // B1：Pod provider 為 gemini 時，.pod-doodle 含 pod-provider-gemini
  it("B1：provider 為 gemini 時 pod-doodle 應含 pod-provider-gemini class", async () => {
    const pod = mkPod({ provider: "gemini" as Pod["provider"] });
    // 需把 pod 寫入 podStore，usePodCapabilities 才能透過 getPodById 取得正確 provider
    usePodStore().pods = [pod];
    const wrapper = mountPod(pod);
    injectGeminiCapabilities();
    await nextTick();
    expect(wrapper.find(".pod-doodle").classes()).toContain(
      "pod-provider-gemini",
    );
    wrapper.unmount();
  });

  // B2：Pod provider 從 claude 切換為 gemini 後，class 由 pod-provider-claude 更新為 pod-provider-gemini
  it("B2：provider 從 claude 切換為 gemini 後 class 應從 pod-provider-claude 更新為 pod-provider-gemini", async () => {
    const pod = mkPod({ id: "pod-switch", provider: "claude" });
    const podStore = usePodStore();
    podStore.pods = [pod];

    const wrapper = mountPod(pod);
    injectCapabilities();
    await nextTick();
    expect(wrapper.find(".pod-doodle").classes()).toContain(
      "pod-provider-claude",
    );

    // 更新 store 中的 pod provider 為 gemini，同時確保 gemini metadata 已注入
    podStore.pods[0]!.provider = "gemini" as Pod["provider"];
    injectGeminiCapabilities();
    await nextTick();
    expect(wrapper.find(".pod-doodle").classes()).not.toContain(
      "pod-provider-claude",
    );
    expect(wrapper.find(".pod-doodle").classes()).toContain(
      "pod-provider-gemini",
    );
    wrapper.unmount();
  });

  // B3：Gemini Pod 的 plugin / mcp / repository / command 插槽仍渲染，但收到 disabled 相關 props
  it("B3：Gemini Pod 的四個插槽仍渲染，plugin/mcp capabilityDisabled=true、repository/command disabled=true，disabled-tooltip 為通用文案", async () => {
    const pod = mkPod({ provider: "gemini" as Pod["provider"] });
    // 需把 pod 寫入 podStore，usePodCapabilities 才能透過 getPodById 取得正確 provider
    usePodStore().pods = [pod];
    const wrapper = mountPod(pod);
    injectGeminiCapabilities();
    await nextTick();

    // 四個插槽 DOM 仍存在
    expect(wrapper.find(".pod-plugin-slot").exists()).toBe(true);
    expect(wrapper.find(".pod-mcp-slot").exists()).toBe(true);
    expect(wrapper.find(".pod-repository-slot").exists()).toBe(true);
    expect(wrapper.find(".pod-command-slot").exists()).toBe(true);

    // PodSlots 渲染後，透過 PodPluginSlot / PodMcpSlot 元件驗證 capability-disabled prop
    const podSlots = wrapper.findComponent({ name: "PodSlots" });
    const podPluginSlot = podSlots.findComponent({ name: "PodPluginSlot" });
    const podMcpSlot = podSlots.findComponent({ name: "PodMcpSlot" });
    expect(podPluginSlot.props("capabilityDisabled")).toBe(true);
    expect(podMcpSlot.props("capabilityDisabled")).toBe(true);

    // PodSingleBindSlot（repository 與 command）應收到 disabled=true
    const singleBindSlots = podSlots.findAllComponents({
      name: "PodSingleBindSlot",
    });
    expect(singleBindSlots.length).toBeGreaterThanOrEqual(2);
    for (const slot of singleBindSlots) {
      expect(slot.props("disabled")).toBe(true);
      // disabled-tooltip 為通用文案
      expect(slot.props("disabledTooltip")).toBe("此 Provider 不支援此功能");
    }

    wrapper.unmount();
  });
});

describe("CanvasPod handleModelChange", () => {
  it("後端回傳成功應更新 podStore.providerConfig.model", async () => {
    const { useCanvasStore } = await import("@/stores/canvasStore");
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1"; // 讓 sendCanvasAction 能取得 canvasId

    const pod = mkPod({ id: "pod-m", provider: "claude" });
    const podStore = usePodStore();
    podStore.pods = [pod];
    mockCreateWebSocketRequest.mockResolvedValueOnce({
      pod: { providerConfig: { model: "haiku" } },
    });
    injectCapabilities();
    const wrapper = mountPod(pod);
    await nextTick();

    wrapper
      .findComponent({ name: "PodModelSelector" })
      .vm.$emit("update:model", "haiku");
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(podStore.getPodById("pod-m")?.providerConfig.model).toBe("haiku");
    wrapper.unmount();
  });
});
