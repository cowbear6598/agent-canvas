import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import { setupStoreTest } from "../../helpers/testSetup";

vi.mock("@/components/ui/ConnectionStatus.vue", () => ({
  default: { name: "ConnectionStatus", template: "<div />" },
}));

vi.mock("@/components/integration/IntegrationSelectModal.vue", () => ({
  default: {
    name: "IntegrationSelectModal",
    props: ["open"],
    template: "<div />",
  },
}));

vi.mock("@/components/integration/IntegrationAppsModal.vue", () => ({
  default: {
    name: "IntegrationAppsModal",
    props: ["open", "provider"],
    template: "<div />",
  },
}));

vi.mock("@/components/settings/GlobalSettingsModal.vue", () => ({
  default: {
    name: "GlobalSettingsModal",
    props: ["open"],
    template: "<div />",
  },
}));

vi.mock("@/components/settings/LlmProviderModal.vue", () => ({
  default: {
    name: "LlmProviderModal",
    props: ["open"],
    template: "<div />",
  },
}));

vi.mock("@/components/settings/ManagedMcpModal.vue", () => ({
  default: {
    name: "ManagedMcpModal",
    props: ["open"],
    emits: ["update:open"],
    template:
      '<div class="managed-mcp-modal-stub" :data-open="String(open)"><button v-if="open" class="managed-mcp-close" @click="$emit(\'update:open\', false)">close</button></div>',
  },
}));

describe("AppHeader", () => {
  setupStoreTest();

  it("點擊 Header MCP 按鈕會開啟 modal", async () => {
    const wrapper = mount(AppHeader);

    await wrapper.get("[data-managed-mcp-toggle]").trigger("click");
    await nextTick();

    expect(wrapper.get(".managed-mcp-modal-stub").attributes("data-open")).toBe(
      "true",
    );

    wrapper.unmount();
  });

  it("modal 關閉後 Header 狀態恢復", async () => {
    const wrapper = mount(AppHeader);

    await wrapper.get("[data-managed-mcp-toggle]").trigger("click");
    await nextTick();
    await wrapper.get(".managed-mcp-close").trigger("click");
    await nextTick();

    expect(wrapper.get(".managed-mcp-modal-stub").attributes("data-open")).toBe(
      "false",
    );

    wrapper.unmount();
  });
});
