import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import IntegrationsHubModal from "@/components/settings/IntegrationsHubModal.vue";
import LlmProviderModal from "@/components/settings/LlmProviderModal.vue";
import { setupTestPinia } from "@tests/helpers/mockStoreFactory";

const dialogStub = defineComponent({
  props: {
    open: {
      type: Boolean,
      default: false,
    },
  },
  template: `<div v-if="open"><slot /></div>`,
});

const passthroughStub = defineComponent({
  template: `<div><slot /></div>`,
});

function createModalStub(testId: string) {
  return defineComponent({
    props: {
      open: {
        type: Boolean,
        default: false,
      },
      provider: {
        type: String,
        default: "",
      },
      showBackButton: {
        type: Boolean,
        default: false,
      },
    },
    emits: ["back"],
    template: `
      <div
        :data-testid="'${testId}'"
        :data-open="open ? 'true' : 'false'"
        :data-provider="provider"
        :data-show-back="showBackButton ? 'true' : 'false'"
      >
        <button
          v-if="showBackButton"
          :data-testid="'${testId}-back'"
          @click="$emit('back')"
        >
          back
        </button>
      </div>
    `,
  });
}

const integrationsHubHarnessStub = defineComponent({
  props: {
    open: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    "update:open",
    "select-global-settings",
    "select-integration-manager",
    "select-mcp",
    "select-plugin",
    "select-opencode",
    "select-model-settings",
  ],
  template: `
    <div v-if="open" data-testid="integrations-hub-harness">
      <button data-testid="hub-open-global-settings" @click="$emit('select-global-settings')">global</button>
      <button data-testid="hub-open-integration-manager" @click="$emit('select-integration-manager')">integration</button>
      <button data-testid="hub-open-mcp" @click="$emit('select-mcp')">mcp</button>
      <button data-testid="hub-open-plugin" @click="$emit('select-plugin')">plugin</button>
      <button data-testid="hub-open-model-settings" @click="$emit('select-model-settings')">model</button>
      <button data-testid="hub-open-opencode" @click="$emit('select-opencode')">opencode</button>
    </div>
  `,
});

function mountHeader() {
  return mount(AppHeader, {
    attachTo: document.body,
    global: {
      stubs: {
        ConnectionStatus: true,
        Dialog: dialogStub,
        DialogContent: passthroughStub,
        DialogDescription: passthroughStub,
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        GlobalSettingsModal: createModalStub("global-settings-modal"),
        IntegrationAppsModal: createModalStub("integration-apps-modal"),
        IntegrationSelectModal: createModalStub("integration-select-modal"),
        IntegrationsHubModal: integrationsHubHarnessStub,
        LlmProviderModal: createModalStub("opencode-settings-modal"),
        ManagedMcpModal: createModalStub("managed-mcp-modal"),
        ManagedPluginModal: createModalStub("managed-plugin-modal"),
        ModelSettingsModal: createModalStub("model-settings-modal"),
      },
    },
  });
}

async function openIntegrationsHub(
  wrapper: ReturnType<typeof mountHeader>,
): Promise<void> {
  await wrapper.get("[data-integrations-hub-toggle]").trigger("click");
  await flushPromises();
}

async function selectHubCard(
  wrapper: ReturnType<typeof mountHeader>,
  triggerId: string,
): Promise<void> {
  await openIntegrationsHub(wrapper);
  await wrapper.get(`[data-testid="${triggerId}"]`).trigger("click");
  await flushPromises();
}

describe("integrations hub userflow", () => {
  beforeEach(() => {
    setActivePinia(setupTestPinia());
    vi.clearAllMocks();
  });

  it("header 只保留管理中心入口，並可透過 hub emit 導流到所有管理視窗", async () => {
    const wrapper = mountHeader();

    await flushPromises();

    const headerTitles = wrapper
      .findAll("header button[title]")
      .map((button) => button.attributes("title"));

    expect(headerTitles).toContain("管理中心");
    expect(headerTitles).toContain("歷程");
    expect(headerTitles).not.toContain("全域設定");
    expect(headerTitles).not.toContain("整合服務管理");
    expect(
      wrapper.get("[data-testid='global-settings-modal']").attributes(
        "data-open",
      ),
    ).toBe("false");
    expect(
      wrapper.get("[data-testid='integration-select-modal']").attributes(
        "data-open",
      ),
    ).toBe("false");

    await selectHubCard(wrapper, "hub-open-global-settings");
    expect(
      wrapper.get("[data-testid='global-settings-modal']").attributes(
        "data-open",
      ),
    ).toBe("true");
    expect(
      wrapper.get("[data-testid='global-settings-modal']").attributes(
        "data-show-back",
      ),
    ).toBe("true");
    await wrapper.get("[data-testid='global-settings-modal-back']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='integrations-hub-harness']").exists()).toBe(
      true,
    );

    await selectHubCard(wrapper, "hub-open-integration-manager");
    expect(
      wrapper.get("[data-testid='integration-select-modal']").attributes(
        "data-open",
      ),
    ).toBe("true");
    expect(
      wrapper.get("[data-testid='integration-select-modal']").attributes(
        "data-show-back",
      ),
    ).toBe("true");
    await wrapper.get("[data-testid='integration-select-modal-back']").trigger(
      "click",
    );
    await flushPromises();
    expect(wrapper.find("[data-testid='integrations-hub-harness']").exists()).toBe(
      true,
    );

    await selectHubCard(wrapper, "hub-open-mcp");
    expect(
      wrapper.get("[data-testid='managed-mcp-modal']").attributes("data-open"),
    ).toBe("true");

    await selectHubCard(wrapper, "hub-open-plugin");
    expect(
      wrapper.get("[data-testid='managed-plugin-modal']").attributes(
        "data-open",
      ),
    ).toBe("true");

    await selectHubCard(wrapper, "hub-open-model-settings");
    expect(
      wrapper.get("[data-testid='model-settings-modal']").attributes(
        "data-open",
      ),
    ).toBe("true");

    await selectHubCard(wrapper, "hub-open-opencode");
    expect(
      wrapper.get("[data-testid='opencode-settings-modal']").attributes(
        "data-open",
      ),
    ).toBe("true");
  });

  it("管理中心顯示新分組且各入口 emit 正確事件", async () => {
    const wrapper = mount(IntegrationsHubModal, {
      props: {
        open: true,
      },
      global: {
        stubs: {
          Dialog: dialogStub,
          DialogContent: passthroughStub,
          DialogDescription: passthroughStub,
          DialogHeader: passthroughStub,
          DialogTitle: passthroughStub,
        },
      },
    });

    expect(wrapper.text()).not.toContain("全域設定 / 整合服務管理");
    expect(wrapper.text()).not.toContain("MCP / Skill / Model 設定");
    expect(wrapper.text()).toContain("外部服務");
    expect(wrapper.text()).toContain("OpenCode");
    expect(wrapper.text()).not.toContain("選擇要管理的整合類別");

    await wrapper.get('[data-testid="integrations-hub-card-global-settings"]').trigger("click");
    expect(wrapper.emitted("select-global-settings")).toHaveLength(1);

    await wrapper.setProps({ open: true });
    await wrapper.get('[data-testid="integrations-hub-card-integration-manager"]').trigger("click");
    expect(wrapper.emitted("select-integration-manager")).toHaveLength(1);

    await wrapper.setProps({ open: true });
    await wrapper.get('[data-testid="integrations-hub-card-mcp"]').trigger("click");
    expect(wrapper.emitted("select-mcp")).toHaveLength(1);

    await wrapper.setProps({ open: true });
    await wrapper.get('[data-testid="integrations-hub-card-plugin"]').trigger("click");
    expect(wrapper.emitted("select-plugin")).toHaveLength(1);

    await wrapper.setProps({ open: true });
    await wrapper.get('[data-testid="integrations-hub-card-model-settings"]').trigger("click");
    expect(wrapper.emitted("select-model-settings")).toHaveLength(1);

    await wrapper.setProps({ open: true });
    await wrapper.get('[data-testid="integrations-hub-card-opencode"]').trigger("click");
    expect(wrapper.emitted("select-opencode")).toHaveLength(1);
  });

  it("OpenCode modal 開啟後直接顯示設定頁，並顯示返回按鈕", () => {
    const wrapper = mount(LlmProviderModal, {
      props: {
        open: true,
        showBackButton: true,
      },
      global: {
        stubs: {
          Dialog: dialogStub,
          DialogContent: passthroughStub,
          DialogDescription: passthroughStub,
          DialogHeader: passthroughStub,
          DialogTitle: passthroughStub,
          ModalBackButton: {
            emits: ["click"],
            template:
              '<button data-testid="opencode-modal-back" @click="$emit(\'click\')">返回</button>',
          },
          OpencodeSettingsPanel: {
            template: '<div data-testid="opencode-settings-panel">panel</div>',
          },
        },
      },
    });

    expect(wrapper.text()).toContain("panel");
    expect(wrapper.find("[data-testid='opencode-modal-back']").exists()).toBe(
      true,
    );
    expect(wrapper.text()).not.toContain("Manage providers and model aliases");
    expect(wrapper.find("button.w-full.rounded-lg").exists()).toBe(false);

    wrapper.get("[data-testid='opencode-modal-back']").trigger("click");
    expect(wrapper.emitted("back")).toHaveLength(1);
  });
});
