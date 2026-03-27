import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import type { IntegrationApp, IntegrationBinding } from "@/types/integration";

// Mock Shadcn UI Dialog
vi.mock("@/components/ui/dialog", () => ({
  Dialog: {
    name: "Dialog",
    template: '<div v-if="open"><slot /></div>',
    props: ["open"],
  },
  DialogContent: { name: "DialogContent", template: "<div><slot /></div>" },
  DialogHeader: { name: "DialogHeader", template: "<div><slot /></div>" },
  DialogTitle: { name: "DialogTitle", template: "<div><slot /></div>" },
  DialogDescription: {
    name: "DialogDescription",
    template: "<div><slot /></div>",
  },
  DialogFooter: { name: "DialogFooter", template: "<div><slot /></div>" },
}));

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "Button",
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    props: ["disabled", "variant"],
    emits: ["click"],
  },
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: {
    name: "RadioGroup",
    template: "<div><slot /></div>",
    props: ["modelValue"],
    emits: ["update:modelValue"],
  },
  RadioGroupItem: {
    name: "RadioGroupItem",
    template: '<input type="radio" :id="id" :value="value" />',
    props: ["id", "value"],
  },
}));

vi.mock("@/components/ui/label", () => ({
  Label: {
    name: "Label",
    template: '<label :for="htmlFor"><slot /></label>',
    props: ["for", "htmlFor"],
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: {
    name: "Input",
    template:
      '<input :type="type" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ["type", "placeholder", "modelValue", "id"],
    emits: ["update:modelValue"],
  },
}));

vi.mock("@/components/icons/SlackIcon.vue", () => ({
  default: { name: "SlackIcon", template: "<svg />", props: ["size"] },
}));
vi.mock("@/components/icons/TelegramIcon.vue", () => ({
  default: { name: "TelegramIcon", template: "<svg />", props: ["size"] },
}));
vi.mock("@/components/icons/JiraIcon.vue", () => ({
  default: { name: "JiraIcon", template: "<svg />", props: ["size"] },
}));

function createMockApp(overrides?: Partial<IntegrationApp>): IntegrationApp {
  return {
    id: "app-1",
    name: "Test App",
    connectionStatus: "connected",
    provider: "slack",
    resources: [
      { id: "ch-1", label: "#general" },
      { id: "ch-2", label: "#dev" },
    ],
    raw: {},
    ...overrides,
  };
}

function createMockBinding(
  overrides?: Partial<IntegrationBinding>,
): IntegrationBinding {
  return {
    provider: "slack",
    appId: "app-1",
    resourceId: "ch-1",
    extra: {},
    ...overrides,
  };
}

async function mountComponent(props: {
  open: boolean;
  podId: string;
  provider: string;
}) {
  const { default: IntegrationConnectModal } =
    await import("@/components/integration/IntegrationConnectModal.vue");

  return mount(IntegrationConnectModal, {
    props,
    global: {
      plugins: [
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
        }),
      ],
    },
  });
}

describe("IntegrationConnectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("基本顯示", () => {
    it("open 為 false 時不應渲染", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "slack",
      });
      expect(wrapper.text()).toBe("");
    });

    it("應顯示正確標題", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      expect(wrapper.text()).toContain("連接 Slack");
    });

    it("無 App 時應顯示提示訊息", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      expect(wrapper.text()).toContain("尚未有可用的 Slack App");
    });
  });

  describe("App 選擇", () => {
    it("有 App 時應渲染 RadioGroup", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("Test App");
    });

    it("選擇 App 後應顯示資源列表", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      await wrapper.vm.$nextTick();

      // 設定 selectedAppId
      const vm = wrapper.vm as unknown as { selectedAppId: string | null };
      vm.selectedAppId = "app-1";
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("#general");
      expect(wrapper.text()).toContain("#dev");
    });
  });

  describe("Telegram 私聊模式", () => {
    it("選擇 App 後應直接顯示 User ID 輸入欄位", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "telegram",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["telegram"] = [
        createMockApp({ provider: "telegram", resources: [] }),
      ];

      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        selectedAppId: string | null;
        isManualInput: boolean;
      };
      vm.selectedAppId = "app-1";
      await wrapper.vm.$nextTick();

      expect(vm.isManualInput).toBe(true);
      expect(wrapper.text()).toContain("Telegram User ID");
    });
  });

  describe("確認按鈕狀態", () => {
    it("未選擇 App 時確認按鈕應 disabled", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      await wrapper.vm.$nextTick();

      const confirmButton = wrapper
        .findAll("button")
        .find((b) => b.text() === "確認");
      expect(confirmButton?.attributes("disabled")).toBeDefined();
    });

    it("選擇 App 和 resource 後確認按鈕應啟用", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        selectedAppId: string | null;
        selectedResourceId: string | null;
        isConfirmDisabled: boolean;
      };
      vm.selectedAppId = "app-1";
      // 等待 watch(selectedAppId) 清除 selectedResourceId 後再設定
      await wrapper.vm.$nextTick();
      vm.selectedResourceId = "ch-1";
      await wrapper.vm.$nextTick();

      // 直接驗證 computed 狀態，因為 mock button 的 disabled 傳遞方式與原生不同
      expect(vm.isConfirmDisabled).toBe(false);
    });
  });

  describe("開啟時自動 refresh", () => {
    it("開啟時應對 connected app 觸發 refreshAppResources", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      const connectedApp = createMockApp({
        id: "app-connected",
        connectionStatus: "connected",
      });
      integrationStore.apps["slack"] = [connectedApp];
      integrationStore.refreshAppResources = vi
        .fn()
        .mockResolvedValue(undefined);

      await wrapper.setProps({ open: true });
      await wrapper.vm.$nextTick();

      expect(integrationStore.refreshAppResources).toHaveBeenCalledWith(
        "slack",
        "app-connected",
      );
    });

    it("Jira provider 開啟時不應觸發 refreshAppResources", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "jira",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["jira"] = [
        {
          id: "jira-1",
          name: "my-project",
          connectionStatus: "connected",
          provider: "jira",
          resources: [],
          raw: {},
        },
      ];
      integrationStore.refreshAppResources = vi
        .fn()
        .mockResolvedValue(undefined);

      await wrapper.setProps({ open: true });
      await wrapper.vm.$nextTick();

      expect(integrationStore.refreshAppResources).not.toHaveBeenCalled();
    });

    it("開啟時不應對 disconnected app 觸發 refreshAppResources", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      const disconnectedApp = createMockApp({
        id: "app-disconnected",
        connectionStatus: "disconnected",
      });
      integrationStore.apps["slack"] = [disconnectedApp];
      integrationStore.refreshAppResources = vi
        .fn()
        .mockResolvedValue(undefined);

      await wrapper.setProps({ open: true });
      await wrapper.vm.$nextTick();

      expect(integrationStore.refreshAppResources).not.toHaveBeenCalled();
    });

    it("關閉 modal 時不應觸發 refreshAppResources", async () => {
      const wrapper = await mountComponent({
        open: true,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      const connectedApp = createMockApp({
        id: "app-connected",
        connectionStatus: "connected",
      });
      integrationStore.apps["slack"] = [connectedApp];
      integrationStore.refreshAppResources = vi
        .fn()
        .mockResolvedValue(undefined);

      await wrapper.setProps({ open: false });
      await wrapper.vm.$nextTick();

      expect(integrationStore.refreshAppResources).not.toHaveBeenCalled();
    });
  });

  describe("Jira provider（hasNoResource）", () => {
    it("選擇 App 後不應顯示資源選擇區塊，但應顯示事件過濾 RadioGroup", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "jira",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["jira"] = [
        {
          id: "jira-1",
          name: "my-project",
          connectionStatus: "connected",
          provider: "jira",
          resources: [],
          raw: {},
        },
      ];

      // 模擬開啟 modal，觸發 watcher 並初始化 extraValues
      await wrapper.setProps({ open: true });
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        selectedAppId: string | null;
        isNoResource: boolean;
      };
      vm.selectedAppId = "jira-1";
      await wrapper.vm.$nextTick();

      // isNoResource=true，資源選擇 template 不應渲染
      expect(vm.isNoResource).toBe(true);
      // 應顯示：1 個 App radio + 2 個 eventFilter radio options
      const radioInputs = wrapper.findAll('input[type="radio"]');
      expect(radioInputs).toHaveLength(3);
    });

    it("選擇 App 並選擇事件過濾後確認按鈕應可用", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "jira",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["jira"] = [
        {
          id: "jira-1",
          name: "my-project",
          connectionStatus: "connected",
          provider: "jira",
          resources: [],
          raw: {},
        },
      ];

      // 模擬開啟 modal，觸發 watcher 並初始化 extraValues（預設 eventFilter = 'all'）
      await wrapper.setProps({ open: true });
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        selectedAppId: string | null;
        isConfirmDisabled: boolean;
      };
      vm.selectedAppId = "jira-1";
      await wrapper.vm.$nextTick();

      // eventFilter 已有預設值 'all'，選完 App 後確認按鈕應可用
      expect(vm.isConfirmDisabled).toBe(false);
    });

    it("確認綁定時 resourceId 傳 *", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "jira",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["jira"] = [
        {
          id: "jira-1",
          name: "my-project",
          connectionStatus: "connected",
          provider: "jira",
          resources: [],
          raw: {},
        },
      ];
      integrationStore.bindToPod = vi.fn().mockResolvedValue(undefined);

      // 模擬開啟 modal，觸發 watcher 並初始化 extraValues（預設 eventFilter = 'all'）
      await wrapper.setProps({ open: true });
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as { selectedAppId: string | null };
      vm.selectedAppId = "jira-1";
      await wrapper.vm.$nextTick();

      const confirmButton = wrapper
        .findAll("button")
        .find((b) => b.text() === "確認");
      await confirmButton?.trigger("click");

      expect(integrationStore.bindToPod).toHaveBeenCalledWith(
        "jira",
        "pod-1",
        "jira-1",
        "*",
        expect.any(Object),
      );
    });
  });

  describe("回填已有 binding", () => {
    it("開啟時應回填現有 binding 的 App 和 resource", async () => {
      const wrapper = await mountComponent({
        open: false,
        podId: "pod-1",
        provider: "slack",
      });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      const podStore = (await import("@/stores")).usePodStore();
      // 設定 pod 資料，讓 getPodById 可以找到有 binding 的 pod
      podStore.pods.push({
        id: "pod-1",
        name: "Test Pod",
        x: 0,
        y: 0,
        status: "idle",
        model: "claude-sonnet-4-5",
        output: [],
        integrationBindings: [createMockBinding()],
      } as unknown as (typeof podStore.pods)[number]);

      await wrapper.setProps({ open: true });
      // 需要等待 watch 觸發（open 的 watch）以及 nextTick 的清除旗標
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as unknown as {
        selectedAppId: string | null;
        selectedResourceId: string | null;
      };
      expect(vm.selectedAppId).toBe("app-1");
      expect(vm.selectedResourceId).toBe("ch-1");
    });
  });
});
