import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setupStoreTest } from "../../helpers/testSetup";
import PodContextMenu from "@/components/canvas/PodContextMenu.vue";

const {
  mockWrapWebSocketRequest,
  mockToast,
  mockGetActiveCanvasIdOrWarn,
  mockGetPodById,
} = vi.hoisted(() => ({
  mockWrapWebSocketRequest: vi.fn(),
  mockToast: vi.fn(),
  mockGetActiveCanvasIdOrWarn: vi.fn(),
  mockGetPodById: vi.fn().mockReturnValue(null),
}));

vi.mock("@/composables/useWebSocketErrorHandler", () => ({
  useWebSocketErrorHandler: () => ({
    wrapWebSocketRequest: mockWrapWebSocketRequest,
  }),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/services/websocket", () => ({
  createWebSocketRequest: vi.fn(() =>
    Promise.resolve({ requestId: "req-1", success: true }),
  ),
  WebSocketRequestEvents: {
    POD_OPEN_DIRECTORY: "pod:open-directory",
  },
  WebSocketResponseEvents: {
    POD_DIRECTORY_OPENED: "pod:directory:opened",
  },
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
  FolderOpen: { name: "FolderOpen", template: "<svg />" },
  MessageSquare: { name: "MessageSquare", template: "<svg />" },
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

    it("應顯示「打開工作目錄」按鈕", () => {
      const wrapper = mountMenu();

      const button = wrapper.find("button");
      expect(button.exists()).toBe(true);
      expect(button.text()).toContain("打開工作目錄");
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

  describe("點擊「打開工作目錄」", () => {
    it("成功時應 emit close", async () => {
      mockWrapWebSocketRequest.mockResolvedValue({
        requestId: "req-1",
        success: true,
      });

      const wrapper = mountMenu();
      const button = wrapper.find("button");
      await button.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("失敗時應顯示錯誤 toast", async () => {
      mockWrapWebSocketRequest.mockResolvedValue(null);

      const wrapper = mountMenu();
      const button = wrapper.find("button");
      await button.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "打開目錄失敗",
          description: "無法打開工作目錄，請稍後再試",
          variant: "destructive",
        }),
      );
    });

    it("失敗時不應 emit close", async () => {
      mockWrapWebSocketRequest.mockResolvedValue(null);

      const wrapper = mountMenu();
      const button = wrapper.find("button");
      await button.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("close")).toBeFalsy();
    });

    it("沒有啟用的畫布時不應發送 WebSocket 請求", async () => {
      mockGetActiveCanvasIdOrWarn.mockReturnValue(null);

      const wrapper = mountMenu();
      const button = wrapper.find("button");
      await button.trigger("click");
      await wrapper.vm.$nextTick();

      expect(mockWrapWebSocketRequest).not.toHaveBeenCalled();
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
});
