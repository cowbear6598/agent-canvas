import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ManagedMcpModal from "@/components/settings/ManagedMcpModal.vue";
import type { ManagedMcpRegistryItem } from "@/types/mcp";
import { setupStoreTest } from "../../helpers/testSetup";

const {
  mockListManagedMcpRegistry,
  mockSaveManagedMcpRegistry,
  mockDeleteManagedMcpRegistry,
} = vi.hoisted(() => ({
  mockListManagedMcpRegistry: vi.fn(),
  mockSaveManagedMcpRegistry: vi.fn(),
  mockDeleteManagedMcpRegistry: vi.fn(),
}));

vi.mock("@/services/managedMcpApi", () => ({
  listManagedMcpRegistry: mockListManagedMcpRegistry,
  saveManagedMcpRegistry: mockSaveManagedMcpRegistry,
  deleteManagedMcpRegistry: mockDeleteManagedMcpRegistry,
  invalidateManagedMcpRegistryCache: vi.fn(),
  invalidatePodMcpAvailabilityCache: vi.fn(),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    props: ["open"],
    emits: ["update:open"],
    template: '<div v-if="open"><slot /></div>',
  },
  DialogContent: { name: "DialogContent", template: "<div><slot /></div>" },
  DialogHeader: { name: "DialogHeader", template: "<div><slot /></div>" },
  DialogTitle: { name: "DialogTitle", template: "<div><slot /></div>" },
  DialogDescription: {
    name: "DialogDescription",
    template: "<div><slot /></div>",
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    props: ["disabled", "variant"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" :data-variant="variant" @click="$emit(\'click\')"><slot /></button>',
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: {
    name: "Input",
    props: ["modelValue", "placeholder", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" :placeholder="placeholder" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: { name: "ScrollArea", template: "<div><slot /></div>" },
}));

function createRegistryItem(
  overrides: Partial<ManagedMcpRegistryItem> = {},
): ManagedMcpRegistryItem {
  return {
    id: "mcp-1",
    name: "alpha",
    transport: "stdio",
    enabled: true,
    command: "node server.js",
    args: ["--watch"],
    cwd: "/tmp/alpha",
    env: { NODE_ENV: "test" },
    url: null,
    status: "healthy",
    lastError: null,
    createdAt: "2026-05-17T10:00:00.000Z",
    updatedAt: "2026-05-17T10:05:00.000Z",
    ...overrides,
  };
}

function mountModal() {
  return mount(ManagedMcpModal, {
    props: {
      open: true,
      "onUpdate:open": vi.fn(),
    },
  });
}

describe("ManagedMcpModal", () => {
  setupStoreTest();

  it("列出 registry entries", async () => {
    mockListManagedMcpRegistry.mockResolvedValue([
      createRegistryItem({ id: "mcp-1", name: "alpha" }),
      createRegistryItem({
        id: "mcp-2",
        name: "beta",
        transport: "http",
        command: null,
        args: [],
        cwd: null,
        env: {},
        url: "https://beta.example.com/mcp",
      }),
    ]);

    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.text()).toContain("alpha");
    expect(wrapper.text()).toContain("beta");
    expect(mockListManagedMcpRegistry).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("切換 transport 時顯示對應欄位", async () => {
    mockListManagedMcpRegistry.mockResolvedValue([]);

    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.find('[data-testid="managed-mcp-command"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="managed-mcp-url"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="managed-mcp-arg-add"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="managed-mcp-env-add"]').exists()).toBe(
      true,
    );

    await wrapper
      .get('[data-testid="managed-mcp-transport"]')
      .setValue("http");
    await flushPromises();

    expect(wrapper.find('[data-testid="managed-mcp-command"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="managed-mcp-url"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it("儲存後刷新清單", async () => {
    const alpha = createRegistryItem({ id: "mcp-1", name: "alpha" });
    const beta = createRegistryItem({
      id: "mcp-2",
      name: "beta",
      command: "node beta.js",
      args: [],
      cwd: null,
      env: {},
    });

    mockListManagedMcpRegistry
      .mockResolvedValueOnce([alpha])
      .mockResolvedValueOnce([alpha, beta]);
    mockSaveManagedMcpRegistry.mockResolvedValue(beta);

    const wrapper = mountModal();
    await flushPromises();

    await wrapper.get('[data-testid="managed-mcp-new"]').trigger("click");
    await wrapper.get('[data-testid="managed-mcp-name"]').setValue("beta");
    await wrapper
      .get('[data-testid="managed-mcp-command"]')
      .setValue("node beta.js");
    await wrapper.get('[data-testid="managed-mcp-arg-add"]').trigger("click");
    await wrapper
      .get('[data-testid="managed-mcp-arg-input"]')
      .setValue("--watch");
    await wrapper.get('[data-testid="managed-mcp-env-add"]').trigger("click");
    await wrapper
      .get('[data-testid="managed-mcp-env-key-input"]')
      .setValue("NODE_ENV");
    await wrapper
      .get('[data-testid="managed-mcp-env-value-input"]')
      .setValue("test");
    await wrapper.get('[data-testid="managed-mcp-save"]').trigger("click");
    await flushPromises();

    expect(mockSaveManagedMcpRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "beta",
        transport: "stdio",
        command: "node beta.js",
        args: ["--watch"],
        env: { NODE_ENV: "test" },
      }),
    );
    expect(mockListManagedMcpRegistry).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("beta");

    wrapper.unmount();
  });

  it("error 狀態會顯示 last error", async () => {
    mockListManagedMcpRegistry.mockResolvedValue([
      createRegistryItem({
        id: "mcp-9",
        name: "broken-http",
        transport: "http",
        command: null,
        args: [],
        cwd: null,
        env: {},
        url: "https://broken.example.com/mcp",
        status: "error",
        lastError: "Connection refused",
      }),
    ]);

    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.get('[data-testid="managed-mcp-last-error"]').text()).toContain(
      "Connection refused",
    );

    wrapper.unmount();
  });
});
