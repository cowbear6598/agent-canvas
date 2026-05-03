import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { usePodStore } from "@/stores/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import PodSlots from "@/components/pod/PodSlots.vue";

// ── WS 邊界 mock ───────────────────────────────────────────────
vi.mock("@/services/websocket", () => webSocketMockFactory());

// ── vue-i18n ───────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// ── 真實子元件有複雜 DnD 行為，僅 stub 互動邊界 ─────────────────
vi.mock("@/components/pod/PodSingleBindSlot.vue", () => ({
  default: {
    name: "PodSingleBindSlot",
    props: [
      "podId",
      "boundNote",
      "store",
      "label",
      "slotClass",
      "podRotation",
      "disabled",
      "disabledTooltip",
    ],
    emits: ["note-dropped", "note-removed"],
    // data-disabled 透過 template 呈現，讓測試可斷言
    template:
      '<div class="single-bind-slot-stub" ' +
      ':data-disabled="String(disabled)" ' +
      ':data-disabled-tooltip="disabledTooltip" ' +
      "@click=\"$emit('note-dropped', 'note-1')\" " +
      "@dblclick=\"$emit('note-removed')\"></div>",
  },
}));

vi.mock("@/components/pod/PodMcpSlot.vue", () => ({
  default: {
    name: "PodMcpSlot",
    props: [
      "podId",
      "podRotation",
      "activeCount",
      "provider",
      "capabilityDisabled",
      "disabledTooltip",
    ],
    emits: ["click"],
    template:
      '<button class="pod-mcp-slot" ' +
      ':data-capability-disabled="String(capabilityDisabled)" ' +
      "@click=\"$emit('click', $event)\"></button>",
  },
}));

// ── @/stores/note 內部的 DnD 邏輯不屬於此測試範疇，stub 整個模組 ─
vi.mock("@/stores/note", () => ({
  useRepositoryStore: () => ({
    draggedNoteId: null,
    isItemBoundToPod: vi.fn(),
  }),
  useCommandStore: () => ({ draggedNoteId: null, isItemBoundToPod: vi.fn() }),
}));

// ── PodPluginSlot 含有 Teleport 位置計算邏輯，stub 保留 click ─────
vi.mock("@/components/pod/PodPluginSlot.vue", () => ({
  default: {
    name: "PodPluginSlot",
    props: [
      "podId",
      "podRotation",
      "activeCount",
      "provider",
      "capabilityDisabled",
      "disabledTooltip",
    ],
    emits: ["click"],
    template:
      '<button class="pod-plugin-slot" ' +
      ':data-capability-disabled="String(capabilityDisabled)" ' +
      "@click=\"$emit('click', $event)\"></button>",
  },
}));

// ── 輔助：建立 capability（claude = 全開，codex = 只開 command） ──

function setupClaude() {
  const capabilityStore = useProviderCapabilityStore();
  capabilityStore.syncFromPayload([
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
  ]);
}

function setupCodex() {
  const capabilityStore = useProviderCapabilityStore();
  capabilityStore.syncFromPayload([
    {
      name: "codex",
      capabilities: {
        chat: true,
        plugin: false,
        repository: false,
        command: true,
        mcp: false,
      },
    },
  ]);
}

function setupGemini() {
  const capabilityStore = useProviderCapabilityStore();
  capabilityStore.syncFromPayload([
    {
      name: "gemini",
      capabilities: {
        chat: true,
        plugin: false,
        repository: true,
        command: true,
        mcp: false,
      },
    },
  ]);
}

function mountPodSlots(podId: string, overrides: Record<string, unknown> = {}) {
  return mount(PodSlots, {
    props: {
      podId,
      podRotation: 0,
      pluginActiveCount: 0,
      mcpActiveCount: 0,
      provider: "claude",
      currentModel: "opus",
      currentThinkingLevel: undefined,
      boundRepositoryNote: undefined,
      boundCommandNote: undefined,
      ...overrides,
    },
  });
}

// ── 測試 ─────────────────────────────────────────────────────

describe("PodSlots", () => {
  setupStoreTest();

  describe("Codex provider：Command 以外 slot 為 disabled", () => {
    it("Repository disabled=true、Command disabled=false；MCP capabilityDisabled=true", () => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-codex",
          name: "Codex Pod",
          x: 0,
          y: 0,
          rotation: 0,
          status: "idle",
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: [],
          multiInstance: false,
          provider: "codex",
          providerConfig: { model: "o4-mini" },
        },
      ];
      setupCodex();

      const wrapper = mountPodSlots("pod-codex", { provider: "codex" });
      const singleSlots = wrapper.findAll(".single-bind-slot-stub");

      expect(singleSlots).toHaveLength(2);
      expect(singleSlots[0]!.attributes("data-disabled")).toBe("true"); // Repository
      expect(singleSlots[1]!.attributes("data-disabled")).toBe("false"); // Command

      const mcpSlot = wrapper.find(".pod-mcp-slot");
      expect(mcpSlot.attributes("data-capability-disabled")).toBe("true");

      // disabled tooltip 使用 i18n key（t = identity）
      expect(singleSlots[0]!.attributes("data-disabled-tooltip")).toBe(
        "pod.slot.providerDisabled",
      );

      wrapper.unmount();
    });
  });

  describe("Claude provider：全部 slot 為 enabled", () => {
    it("所有 single-bind slot disabled=false；MCP capabilityDisabled=false", () => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-claude",
          name: "Claude Pod",
          x: 0,
          y: 0,
          rotation: 0,
          status: "idle",
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: [],
          multiInstance: false,
          provider: "claude",
          providerConfig: { model: "opus" },
        },
      ];
      setupClaude();

      const wrapper = mountPodSlots("pod-claude");
      const singleSlots = wrapper.findAll(".single-bind-slot-stub");

      expect(singleSlots).toHaveLength(2);
      for (const slot of singleSlots) {
        expect(slot.attributes("data-disabled")).toBe("false");
      }
      expect(
        wrapper.find(".pod-mcp-slot").attributes("data-capability-disabled"),
      ).toBe("false");

      wrapper.unmount();
    });
  });

  describe("emit 事件轉發", () => {
    beforeEach(() => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-1",
          name: "Pod 1",
          x: 0,
          y: 0,
          rotation: 0,
          status: "idle",
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: [],
          multiInstance: false,
          provider: "claude",
          providerConfig: { model: "opus" },
        },
      ];
      setupClaude();
    });

    it.each([
      [
        "Repository slot note-dropped → repository-dropped",
        0,
        "click",
        "repository-dropped",
      ],
      [
        "Repository slot note-removed → repository-removed",
        0,
        "dblclick",
        "repository-removed",
      ],
      [
        "Command slot note-dropped → command-dropped",
        1,
        "click",
        "command-dropped",
      ],
      [
        "Command slot note-removed → command-removed",
        1,
        "dblclick",
        "command-removed",
      ],
    ])("%s", async (_label, slotIdx, triggerEvent, expectedEmit) => {
      const wrapper = mountPodSlots("pod-1");
      const singleSlots = wrapper.findAll(".single-bind-slot-stub");

      await singleSlots[slotIdx]!.trigger(triggerEvent);

      expect(wrapper.emitted(expectedEmit)).toBeTruthy();
      wrapper.unmount();
    });

    it("MCP slot click → emit mcp-clicked 帶 MouseEvent", async () => {
      const wrapper = mountPodSlots("pod-1");
      await wrapper.find(".pod-mcp-slot").trigger("click");

      expect(wrapper.emitted("mcp-clicked")).toBeTruthy();
      expect(wrapper.emitted("mcp-clicked")![0]![0]).toBeInstanceOf(MouseEvent);
      wrapper.unmount();
    });

    it("Plugin slot click → emit plugin-clicked 帶 MouseEvent", async () => {
      const wrapper = mountPodSlots("pod-1");
      await wrapper.find(".pod-plugin-slot").trigger("click");

      expect(wrapper.emitted("plugin-clicked")).toBeTruthy();
      expect(wrapper.emitted("plugin-clicked")![0]![0]).toBeInstanceOf(
        MouseEvent,
      );
      wrapper.unmount();
    });
  });

  describe("Gemini provider：Repository 與 Command 為 enabled，Plugin 與 MCP 為 capabilityDisabled", () => {
    it("Repository disabled=false、Command disabled=false；MCP capabilityDisabled=true、Plugin capabilityDisabled=true", () => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-gemini",
          name: "Gemini Pod",
          x: 0,
          y: 0,
          rotation: 0,
          status: "idle",
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: [],
          multiInstance: false,
          provider: "gemini",
          providerConfig: { model: "gemini-2.0-flash" },
        },
      ];
      setupGemini();

      const wrapper = mountPodSlots("pod-gemini", { provider: "gemini" });
      const singleSlots = wrapper.findAll(".single-bind-slot-stub");

      expect(singleSlots).toHaveLength(2);
      expect(singleSlots[0]!.attributes("data-disabled")).toBe("false"); // Repository
      expect(singleSlots[1]!.attributes("data-disabled")).toBe("false"); // Command

      expect(
        wrapper.find(".pod-mcp-slot").attributes("data-capability-disabled"),
      ).toBe("true");
      expect(
        wrapper.find(".pod-plugin-slot").attributes("data-capability-disabled"),
      ).toBe("true");

      wrapper.unmount();
    });
  });

  describe("Gemini provider：emit 事件轉發與 Claude/Codex 一致", () => {
    beforeEach(() => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-gemini-emit",
          name: "Gemini Pod Emit",
          x: 0,
          y: 0,
          rotation: 0,
          status: "idle",
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: [],
          multiInstance: false,
          provider: "gemini",
          providerConfig: { model: "gemini-2.0-flash" },
        },
      ];
      setupGemini();
    });

    it.each([
      [
        "Repository slot note-dropped → repository-dropped",
        0,
        "click",
        "repository-dropped",
      ],
      [
        "Repository slot note-removed → repository-removed",
        0,
        "dblclick",
        "repository-removed",
      ],
      [
        "Command slot note-dropped → command-dropped",
        1,
        "click",
        "command-dropped",
      ],
      [
        "Command slot note-removed → command-removed",
        1,
        "dblclick",
        "command-removed",
      ],
    ])("%s", async (_label, slotIdx, triggerEvent, expectedEmit) => {
      const wrapper = mountPodSlots("pod-gemini-emit", { provider: "gemini" });
      const singleSlots = wrapper.findAll(".single-bind-slot-stub");

      await singleSlots[slotIdx]!.trigger(triggerEvent);

      expect(wrapper.emitted(expectedEmit)).toBeTruthy();
      wrapper.unmount();
    });
  });

  describe("Gemini metadata 未載入：Repository / Command slot 為 disabled", () => {
    it("未呼叫 setupGemini，兩個 single-bind slot data-disabled=true 且 disabledTooltip 為 pod.slot.providerDisabled", () => {
      const podStore = usePodStore();
      podStore.pods = [
        {
          id: "pod-gemini-no-cap",
          name: "Gemini Pod No Cap",
          x: 0,
          y: 0,
          rotation: 0,
          status: "idle",
          output: [],
          repositoryId: null,
          commandId: null,
          schedule: null,
          mcpServerNames: [],
          pluginIds: [],
          multiInstance: false,
          provider: "gemini",
          providerConfig: { model: "gemini-2.0-flash" },
        },
      ];
      // 故意不呼叫 setupGemini()，capability store 無 gemini 資料 → 保守 fallback

      const wrapper = mountPodSlots("pod-gemini-no-cap", {
        provider: "gemini",
      });
      const singleSlots = wrapper.findAll(".single-bind-slot-stub");

      expect(singleSlots).toHaveLength(2);
      expect(singleSlots[0]!.attributes("data-disabled")).toBe("true");
      expect(singleSlots[1]!.attributes("data-disabled")).toBe("true");
      expect(singleSlots[0]!.attributes("data-disabled-tooltip")).toBe(
        "pod.slot.providerDisabled",
      );
      expect(singleSlots[1]!.attributes("data-disabled-tooltip")).toBe(
        "pod.slot.providerDisabled",
      );

      wrapper.unmount();
    });
  });
});
