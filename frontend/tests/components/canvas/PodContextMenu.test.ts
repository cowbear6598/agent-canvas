import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import PodContextMenu from "@/components/canvas/PodContextMenu.vue";

const {
  mockDownloadPodDirectory,
  mockGetActiveCanvasIdOrWarn,
  mockGetPodById,
  mockFailTask,
  mockCompleteTask,
  mockAddTask,
  mockUpdateProgress,
} = vi.hoisted(() => ({
  mockDownloadPodDirectory: vi.fn(),
  mockGetActiveCanvasIdOrWarn: vi.fn(),
  mockGetPodById: vi.fn().mockReturnValue(null),
  mockFailTask: vi.fn(),
  mockCompleteTask: vi.fn(),
  mockAddTask: vi.fn(),
  mockUpdateProgress: vi.fn(),
}));

vi.mock("@/services/podApi", () => ({
  downloadPodDirectory: (...args: unknown[]) =>
    mockDownloadPodDirectory(...args),
}));

vi.mock("@/composables/canvas/useDownloadProgress", () => ({
  useDownloadProgress: () => ({
    addTask: mockAddTask,
    updateProgress: mockUpdateProgress,
    completeTask: mockCompleteTask,
    failTask: mockFailTask,
  }),
}));

vi.mock("@/utils/canvasGuard", () => ({
  getActiveCanvasIdOrWarn: (...args: unknown[]) =>
    mockGetActiveCanvasIdOrWarn(...args),
}));

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  return {
    ...actual,
    usePodStore: () => ({
      getPodById: mockGetPodById,
    }),
  };
});

vi.mock("lucide-vue-next", () => ({
  Download: { name: "Download", template: "<svg />" },
  Target: { name: "Target", template: "<svg />" },
  Unplug: { name: "Unplug", template: "<svg />" },
  Puzzle: { name: "Puzzle", template: "<svg />" },
  ChevronRight: { name: "ChevronRight", template: "<svg />" },
}));

vi.mock("@/components/canvas/PodPluginSubMenu.vue", () => ({
  default: {
    name: "PodPluginSubMenu",
    props: ["podId", "position"],
    emits: ["close", "cancel-close"],
    template: '<div class="pod-plugin-submenu-mock" />',
  },
}));

vi.mock("@/integration/providerRegistry", () => ({
  getAllProviders: vi.fn(() => [
    {
      name: "slack",
      label: "Slack",
      icon: { name: "SlackIcon", template: "<svg />" },
    },
  ]),
}));

const defaultProps = {
  position: { x: 100, y: 200 },
  podId: "pod-123",
};

function mountMenu(props = {}) {
  return mount(PodContextMenu, {
    props: { ...defaultProps, ...props },
    attachTo: document.body,
  });
}

function findButtonByText(
  wrapper: ReturnType<typeof mountMenu>,
  text: string,
) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

describe("PodContextMenu", () => {
  setupStoreTest(() => {
    mockGetActiveCanvasIdOrWarn.mockReturnValue("canvas-1");
  });

  describe("元件渲染", () => {
    it("應在指定位置正確渲染選單", () => {
      const wrapper = mountMenu();

      const menuContainer = wrapper.find(".fixed.z-50");
      expect(menuContainer.exists()).toBe(true);

      const style = menuContainer.attributes("style");
      expect(style).toContain("left: 100px");
      expect(style).toContain("top: 200px");
    });

    it("應顯示「下載工作目錄」按鈕", () => {
      const wrapper = mountMenu();

      const button = findButtonByText(wrapper, "下載工作目錄（zip）");
      expect(button?.exists()).toBe(true);
      expect(button?.text()).toContain("下載工作目錄（zip）");
    });

    it("沒有 Goal 時應顯示「設定 Goal」按鈕", () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        goalStatus: "unset",
        integrationBindings: [],
      });

      const wrapper = mountMenu();

      expect(findButtonByText(wrapper, "設定 Goal")?.exists()).toBe(true);
    });

    it("不應渲染全螢幕背景遮罩", () => {
      const wrapper = mountMenu();

      // 已改用 document-level mousedown 監聽，不再使用全螢幕 overlay
      const overlay = wrapper.find(".fixed.inset-0.z-40");
      expect(overlay.exists()).toBe(false);
    });
  });

  describe("點擊選單外部關閉選單", () => {
    it("在選單外部觸發 mousedown 應 emit close", async () => {
      const wrapper = mountMenu();

      // 模擬在選單外部的 document mousedown（capture phase）
      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      Object.defineProperty(event, "target", { value: document.body });
      document.dispatchEvent(event);

      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("右鍵點選單外部應 emit close 但不呼叫 stopPropagation", async () => {
      const wrapper = mountMenu();

      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 2,
      });
      Object.defineProperty(event, "target", { value: document.body });
      const stopPropagationSpy = vi.spyOn(event, "stopPropagation");
      document.dispatchEvent(event);

      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(stopPropagationSpy).not.toHaveBeenCalled();
    });
  });

  describe("點擊「下載工作目錄」", () => {
    it("成功時應 emit close", async () => {
      mockDownloadPodDirectory.mockResolvedValue(undefined);

      const wrapper = mountMenu();
      const button = findButtonByText(wrapper, "下載工作目錄（zip）");
      await button?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("失敗時應呼叫 failTask 並帶入錯誤訊息", async () => {
      mockDownloadPodDirectory.mockRejectedValue(new Error("下載失敗"));

      const wrapper = mountMenu();
      const button = findButtonByText(wrapper, "下載工作目錄（zip）");
      await button?.trigger("click");
      // 等待背景 promise reject
      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();

      expect(mockFailTask).toHaveBeenCalledWith(expect.any(String), "下載失敗");
    });

    it("失敗時仍應 emit close（立即關閉，下載在背景執行）", async () => {
      mockDownloadPodDirectory.mockRejectedValue(new Error("下載失敗"));

      const wrapper = mountMenu();
      const button = findButtonByText(wrapper, "下載工作目錄（zip）");
      await button?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("沒有啟用的畫布時不應呼叫 downloadPodDirectory", async () => {
      mockGetActiveCanvasIdOrWarn.mockReturnValue(null);

      const wrapper = mountMenu();
      const button = findButtonByText(wrapper, "下載工作目錄（zip）");
      await button?.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockDownloadPodDirectory).not.toHaveBeenCalled();
    });
  });

  describe("Integration 按鈕", () => {
    it("Pod 沒有 integrationBindings 時應顯示「連接 Slack」按鈕", () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        integrationBindings: [],
      });

      const wrapper = mountMenu();
      const buttons = wrapper.findAll("button");
      const connectButton = buttons.find((b) =>
        b.text().includes("連接 Slack"),
      );

      expect(connectButton).toBeDefined();
      expect(connectButton?.exists()).toBe(true);
    });

    it("Pod 有 slack integrationBinding 時應顯示「斷開 Slack」按鈕", () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        integrationBindings: [
          {
            provider: "slack",
            appId: "app-001",
            resourceId: "C001",
            extra: {},
          },
        ],
      });

      const wrapper = mountMenu();
      const buttons = wrapper.findAll("button");
      const disconnectButton = buttons.find((b) =>
        b.text().includes("斷開 Slack"),
      );

      expect(disconnectButton).toBeDefined();
      expect(disconnectButton?.exists()).toBe(true);
    });

    it("點擊「連接 Slack」應 emit connect-integration 事件", async () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        integrationBindings: [],
      });

      const wrapper = mountMenu();
      const buttons = wrapper.findAll("button");
      const connectButton = buttons.find((b) =>
        b.text().includes("連接 Slack"),
      );

      await connectButton?.trigger("click");

      expect(wrapper.emitted("connect-integration")).toBeTruthy();
      expect(wrapper.emitted("connect-integration")?.[0]).toEqual([
        "pod-123",
        "slack",
      ]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("點擊「斷開 Slack」應 emit disconnect-integration 事件", async () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        integrationBindings: [
          {
            provider: "slack",
            appId: "app-001",
            resourceId: "C001",
            extra: {},
          },
        ],
      });

      const wrapper = mountMenu();
      const buttons = wrapper.findAll("button");
      const disconnectButton = buttons.find((b) =>
        b.text().includes("斷開 Slack"),
      );

      await disconnectButton?.trigger("click");

      expect(wrapper.emitted("disconnect-integration")).toBeTruthy();
      expect(wrapper.emitted("disconnect-integration")?.[0]).toEqual([
        "pod-123",
        "slack",
      ]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });

  describe("Goal 按鈕", () => {
    it("點擊「編輯 Goal」應 emit open-goal-editor", async () => {
      mockGetPodById.mockReturnValue({
        id: "pod-123",
        goalStatus: "ready",
        integrationBindings: [],
      });

      const wrapper = mountMenu();
      const button = findButtonByText(wrapper, "編輯 Goal");

      await button?.trigger("click");

      expect(wrapper.emitted("open-goal-editor")?.[0]).toEqual(["pod-123"]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });
});
