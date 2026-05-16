import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import { webSocketMockFactory } from "../../helpers/mockWebSocket";
import { usePodStore } from "@/stores/pod";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import PodSlots from "@/components/pod/PodSlots.vue";

vi.mock("@/services/websocket", () => webSocketMockFactory());

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

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
    template:
      '<div class="single-bind-slot-stub" ' +
      ':data-disabled="String(disabled)" ' +
      ':data-disabled-tooltip="disabledTooltip" ' +
      "@click=\"$emit('note-dropped', 'note-1')\" " +
      "@dblclick=\"$emit('note-removed')\"></div>",
  },
}));

vi.mock("@/components/pod/PodGoalSlot.vue", () => ({
  default: {
    name: "PodGoalSlot",
    props: ["podId", "goalStatus", "todoCount", "disabled", "disabledTooltip"],
    emits: ["click"],
    template:
      '<button class="pod-goal-slot" :data-disabled="String(disabled)" @click="$emit(\'click\', $event)"></button>',
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
      "disabled",
      "disabledTooltip",
    ],
    emits: ["click"],
    template:
      '<button class="pod-mcp-slot" :data-disabled="String(disabled)" @click="$emit(\'click\', $event)"></button>',
  },
}));

vi.mock("@/components/pod/PodPluginSlot.vue", () => ({
  default: {
    name: "PodPluginSlot",
    props: [
      "podId",
      "podRotation",
      "activeCount",
      "provider",
      "disabled",
      "disabledTooltip",
    ],
    emits: ["click"],
    template:
      '<button class="pod-plugin-slot" :data-disabled="String(disabled)" @click="$emit(\'click\', $event)"></button>',
  },
}));

vi.mock("@/components/pod/PodThinkingSlot.vue", () => ({
  default: {
    name: "PodThinkingSlot",
    props: [
      "podId",
      "podRotation",
      "currentLevel",
      "currentModel",
      "provider",
      "disabled",
      "disabledTooltip",
    ],
    emits: ["click"],
    template:
      '<button class="pod-thinking-slot" :data-disabled="String(disabled)" @click="$emit(\'click\', $event)"></button>',
  },
}));

vi.mock("@/stores/note", () => ({
  useRepositoryStore: () => ({
    draggedNoteId: null,
    isItemBoundToPod: vi.fn(),
  }),
}));

function injectCapabilities() {
  useProviderCapabilityStore().syncFromPayload([
    {
      name: "claude",
      capabilities: {
        chat: true,
        plugin: true,
        repository: true,
        mcp: true,
        goal: true,
      },
    },
    {
      name: "opencode",
      capabilities: {
        chat: true,
        plugin: false,
        repository: true,
        mcp: true,
        goal: true,
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
      goalStatus: "ready",
      goalTodoCount: 2,
      ...overrides,
    },
  });
}

describe("PodSlots", () => {
  setupStoreTest();

  it("claude provider 應渲染 repository 與 goal slot，且皆可用", () => {
    usePodStore().pods = [
      {
        id: "pod-claude",
        name: "Claude Pod",
        x: 0,
        y: 0,
        rotation: 0,
        repositoryId: null,
        goal: { todos: [{ id: "goal-1", text: "ship it" }] },
        goalStatus: "ready",
        canExecute: true,
        schedule: null,
        mcpServerNames: [],
        pluginIds: [],
        provider: "claude",
        providerConfig: { model: "opus" },
      },
    ];
    injectCapabilities();

    const wrapper = mountPodSlots("pod-claude");
    const singleSlots = wrapper.findAll(".single-bind-slot-stub");

    expect(singleSlots).toHaveLength(1);
    expect(singleSlots[0]!.attributes("data-disabled")).toBe("false");
    expect(wrapper.find(".pod-goal-slot").attributes("data-disabled")).toBe(
      "false",
    );
  });

  it("opencode provider 在 plugin=false 時仍渲染 plugin slot 但 disabled", () => {
    usePodStore().pods = [
      {
        id: "pod-opencode",
        name: "Opencode Pod",
        x: 0,
        y: 0,
        rotation: 0,
        repositoryId: null,
        goal: { todos: [{ id: "goal-1", text: "ship it" }] },
        goalStatus: "ready",
        canExecute: true,
        schedule: null,
        mcpServerNames: [],
        pluginIds: [],
        provider: "opencode",
        providerConfig: { model: "anthropic/claude-sonnet-4" },
      },
    ];
    injectCapabilities();

    const wrapper = mountPodSlots("pod-opencode", { provider: "opencode" });

    expect(wrapper.find(".pod-plugin-slot").attributes("data-disabled")).toBe(
      "true",
    );
    expect(wrapper.find(".pod-mcp-slot").exists()).toBe(true);
    expect(wrapper.find(".pod-goal-slot").exists()).toBe(true);
  });

  it("應轉發 repository / goal / plugin / mcp 事件", async () => {
    usePodStore().pods = [
      {
        id: "pod-1",
        name: "Pod 1",
        x: 0,
        y: 0,
        rotation: 0,
        repositoryId: null,
        goal: { todos: [{ id: "goal-1", text: "ship it" }] },
        goalStatus: "ready",
        canExecute: true,
        schedule: null,
        mcpServerNames: [],
        pluginIds: [],
        provider: "claude",
        providerConfig: { model: "opus" },
      },
    ];
    injectCapabilities();

    const wrapper = mountPodSlots("pod-1");
    const repositorySlot = wrapper.find(".single-bind-slot-stub");

    await repositorySlot.trigger("click");
    await repositorySlot.trigger("dblclick");
    await wrapper.find(".pod-goal-slot").trigger("click");
    await wrapper.find(".pod-plugin-slot").trigger("click");
    await wrapper.find(".pod-mcp-slot").trigger("click");

    expect(wrapper.emitted("repository-dropped")).toBeTruthy();
    expect(wrapper.emitted("repository-removed")).toBeTruthy();
    expect(wrapper.emitted("goal-clicked")).toBeTruthy();
    expect(wrapper.emitted("plugin-clicked")).toBeTruthy();
    expect(wrapper.emitted("mcp-clicked")).toBeTruthy();
  });
});
