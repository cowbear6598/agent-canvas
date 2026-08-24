import { flushPromises, mount } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import McpPopover from "@/components/pod/McpPopover.vue";
import { usePodStore } from "@/stores/pod";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const { mockListPodMcpAvailability, mockUpdatePodMcpServers } = vi.hoisted(
  () => ({
    mockListPodMcpAvailability: vi.fn(),
    mockUpdatePodMcpServers: vi.fn(),
  }),
);

vi.mock("@/services/managedMcpApi", () => ({
  listPodMcpAvailability: mockListPodMcpAvailability,
  invalidatePodMcpAvailabilityCache: vi.fn(),
}));

vi.mock("@/services/mcpApi", () => ({
  updatePodMcpServers: mockUpdatePodMcpServers,
}));

vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: vi.fn(() => "canvas-1"),
}));

const switchStub = {
  name: "Switch",
  props: ["modelValue", "disabled"],
  emits: ["update:modelValue"],
  template: `<button class="switch-stub" :data-checked="String(modelValue)" :disabled="disabled" @click="$emit('update:modelValue', !modelValue)" />`,
};

describe("pod MCP popover userflow", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
    mockUpdatePodMcpServers.mockResolvedValue(undefined);
    mockListPodMcpAvailability.mockResolvedValue([
      {
        key: "plugin:openai%2Fdocs:docs",
        name: "docs",
        source: "official",
        transport: "stdio",
        status: "healthy",
        selected: false,
        selectable: true,
        disabledReason: null,
        lastError: null,
      },
      {
        key: "user:local",
        name: "local",
        source: "user",
        transport: "http",
        status: "disabled",
        selected: false,
        selectable: false,
        disabledReason: null,
        disabledReasonKey: "codexGloballyDisabled",
        lastError: null,
      },
      {
        key: "canvas:system:agent_canvas",
        name: "agent_canvas",
        source: "canvas",
        transport: "stdio",
        status: "healthy",
        selected: false,
        selectable: true,
        disabledReason: null,
        lastError: null,
        system: true,
        locked: false,
      },
      ...["agent_canvas_goal", "agent_canvas_plugin"].map((name) => ({
        key: `canvas:system:${name}`,
        name,
        source: "canvas" as const,
        transport: "stdio" as const,
        status: "healthy" as const,
        selected: true,
        selectable: false,
        disabledReason: null,
        lastError: null,
        system: true,
        locked: true,
      })),
    ]);
  });

  it("依畫布、官方、使用者分組，且預設只有兩個畫布內建 MCP 固定啟用", async () => {
    const podStore = usePodStore();
    podStore.pods = [
      {
        id: "pod-1",
        name: "Pod 1",
        x: 0,
        y: 0,
        rotation: 0,
        provider: "codex",
        providerConfig: { model: "gpt-5.6-luna" },
        mcpServerNames: [],
        codexMcpServerKeys: [],
        agentCanvasMcpEnabled: false,
      },
    ];

    const wrapper = mount(McpPopover, {
      attachTo: document.body,
      props: {
        podId: "pod-1",
        anchorRect: new DOMRect(100, 100, 20, 20),
        provider: "codex",
      },
      global: {
        stubs: {
          ScrollArea: { template: "<div><slot /></div>" },
          Switch: switchStub,
          Teleport: true,
        },
      },
    });
    await flushPromises();

    const text = wrapper.text();
    expect(text.indexOf("畫布")).toBeLessThan(text.indexOf("官方"));
    expect(text.indexOf("官方")).toBeLessThan(text.indexOf("使用者"));
    expect(wrapper.find('[data-testid="mcp-source-official"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="mcp-source-user"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mcp-source-canvas"]').exists()).toBe(
      true,
    );
    expect(text).toContain("已由 Codex 全域設定停用");
    expect(wrapper.findAll('[data-testid="mcp-locked-badge"]')).toHaveLength(2);
    expect(wrapper.findAll('.switch-stub').map((item) => item.attributes("data-checked"))).toEqual([
      "false",
      "false",
      "false",
    ]);

    await wrapper
      .find('[data-testid="mcp-source-official"] .switch-stub')
      .trigger("click");
    await flushPromises();

    expect(podStore.getPodById("pod-1")?.codexMcpServerKeys).toEqual([
      "plugin:openai%2Fdocs:docs",
    ]);
    expect(mockUpdatePodMcpServers).toHaveBeenCalledWith(
      "canvas-1",
      "pod-1",
      [],
      undefined,
      ["plugin:openai%2Fdocs:docs"],
    );
  });
});
