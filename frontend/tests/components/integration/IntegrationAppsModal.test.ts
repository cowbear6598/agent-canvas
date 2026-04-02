import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import type { IntegrationApp } from "@/types/integration";

// Mock Shadcn UI Dialog 元件，避免 teleport 問題
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
    props: ["disabled", "variant", "size"],
    emits: ["click"],
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: {
    name: "Input",
    template:
      '<input :type="type" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ["type", "placeholder", "modelValue"],
    emits: ["update:modelValue"],
  },
}));

// Mock icons
vi.mock("@/components/icons/SlackIcon.vue", () => ({
  default: { name: "SlackIcon", template: "<svg />", props: ["size"] },
}));
vi.mock("@/components/icons/TelegramIcon.vue", () => ({
  default: { name: "TelegramIcon", template: "<svg />", props: ["size"] },
}));
vi.mock("@/components/icons/JiraIcon.vue", () => ({
  default: { name: "JiraIcon", template: "<svg />", props: ["size"] },
}));
vi.mock("@/components/icons/SentryIcon.vue", () => ({
  default: { name: "SentryIcon", template: "<svg />", props: ["size"] },
}));

// Mock lucide icons
vi.mock("lucide-vue-next", () => ({
  Trash2: {
    name: "Trash2",
    template: '<svg data-icon="trash2" />',
    props: ["class"],
  },
  Plus: {
    name: "Plus",
    template: '<svg data-icon="plus" />',
    props: ["class"],
  },
  Copy: {
    name: "Copy",
    template: '<svg data-icon="copy" />',
    props: ["class"],
  },
  Check: {
    name: "Check",
    template: '<svg data-icon="check" />',
    props: ["class"],
  },
}));

function createMockApp(overrides?: Partial<IntegrationApp>): IntegrationApp {
  return {
    id: "app-1",
    name: "Test App",
    connectionStatus: "connected",
    provider: "slack",
    resources: [{ id: "ch-1", label: "#general" }],
    raw: {},
    ...overrides,
  };
}

async function mountComponent(props: { open: boolean; provider: string }) {
  const { default: IntegrationAppsModal } =
    await import("@/components/integration/IntegrationAppsModal.vue");

  return mount(IntegrationAppsModal, {
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

describe("IntegrationAppsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Slack provider", () => {
    it("應顯示正確標題", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });
      expect(wrapper.text()).toContain("Slack Apps 管理");
    });

    it("沒有 App 時應顯示空狀態提示", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });
      expect(wrapper.text()).toContain("尚未註冊任何 Slack App");
    });

    it("新增表單應根據 Slack provider 渲染 3 個欄位", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });

      const addButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 App"));
      await addButton?.trigger("click");

      const inputs = wrapper.findAll("input");
      expect(inputs).toHaveLength(3);
    });

    it("表單欄位有 password 類型", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });

      const addButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 App"));
      await addButton?.trigger("click");

      const inputs = wrapper.findAll("input");
      const passwordInputs = inputs.filter(
        (i) => i.attributes("type") === "password",
      );
      expect(passwordInputs).toHaveLength(2);
    });
  });

  describe("Telegram provider", () => {
    it("應顯示 Telegram 標題", async () => {
      const wrapper = await mountComponent({
        open: true,
        provider: "telegram",
      });
      expect(wrapper.text()).toContain("Telegram Apps 管理");
    });

    it("新增表單應根據 Telegram provider 渲染 2 個欄位", async () => {
      const wrapper = await mountComponent({
        open: true,
        provider: "telegram",
      });

      const addButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 App"));
      await addButton?.trigger("click");

      const inputs = wrapper.findAll("input");
      expect(inputs).toHaveLength(2);
    });
  });

  describe("Jira provider", () => {
    it("新增表單應根據 Jira provider 渲染 3 個欄位", async () => {
      const wrapper = await mountComponent({ open: true, provider: "jira" });

      const addButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 App"));
      await addButton?.trigger("click");

      const inputs = wrapper.findAll("input");
      expect(inputs).toHaveLength(3);
    });

    it("Jira App 卡片不顯示 resources badges", async () => {
      const wrapper = await mountComponent({ open: true, provider: "jira" });
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

      await wrapper.vm.$nextTick();

      // Jira hasNoResource=true，不應出現 bg-muted 的 resource badge
      const badges = wrapper.findAll(".rounded-full.bg-muted");
      expect(badges).toHaveLength(0);
    });
  });

  describe("App 列表", () => {
    it("有 App 時應渲染 App 名稱和資源標籤", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain("Test App");
      expect(wrapper.text()).toContain("#general");
    });

    it("應渲染刪除按鈕", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });
      const integrationStore = (
        await import("@/stores/integrationStore")
      ).useIntegrationStore();
      integrationStore.apps["slack"] = [createMockApp()];

      await wrapper.vm.$nextTick();

      const deleteButtons = wrapper
        .findAll("button")
        .filter((b) => b.find("svg").exists());
      expect(deleteButtons.length).toBeGreaterThan(0);
    });
  });

  describe("表單驗證", () => {
    it("表單未填時確認按鈕應 disabled", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });

      const addButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 App"));
      await addButton?.trigger("click");

      const confirmButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("確認新增"));
      expect(confirmButton?.attributes("disabled")).toBeDefined();
    });

    it("取消按鈕應隱藏表單", async () => {
      const wrapper = await mountComponent({ open: true, provider: "slack" });

      const addButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("新增 App"));
      await addButton?.trigger("click");

      expect(wrapper.findAll("input").length).toBeGreaterThan(0);

      const cancelButton = wrapper
        .findAll("button")
        .find((b) => b.text().includes("取消"));
      await cancelButton?.trigger("click");

      expect(wrapper.findAll("input")).toHaveLength(0);
    });
  });

  describe("關閉行為", () => {
    it("open 為 false 時不應渲染內容", async () => {
      const wrapper = await mountComponent({ open: false, provider: "slack" });
      expect(wrapper.text()).toBe("");
    });
  });

  describe("開啟時自動 refresh", () => {
    it("開啟時應對 connected app 觸發 refreshAppResources", async () => {
      const wrapper = await mountComponent({ open: false, provider: "slack" });
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
      const wrapper = await mountComponent({ open: false, provider: "jira" });
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
      const wrapper = await mountComponent({ open: false, provider: "slack" });
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
      const wrapper = await mountComponent({ open: true, provider: "slack" });
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
});
