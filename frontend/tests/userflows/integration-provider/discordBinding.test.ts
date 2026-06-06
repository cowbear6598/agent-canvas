import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import IntegrationConnectModal from "@/components/integration/IntegrationConnectModal.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useIntegrationStore } from "@/stores/integrationStore";
import { usePodStore } from "@/stores";
import { createMockPod } from "@tests/helpers/factories";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import {
  mockCreateWebSocketRequest,
} from "@tests/helpers/mockWebSocket";

vi.mock("@/services/websocket", async () => {
  const { webSocketMockFactory } = await import("@tests/helpers/mockWebSocket");
  return webSocketMockFactory();
});

const { mockShowErrorToast } = vi.hoisted(() => ({
  mockShowErrorToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: mockShowErrorToast,
    toast: vi.fn(),
  }),
}));

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe("discord integration binding flow", () => {
  it("does not crash when the modal is closed and provider is still empty", async () => {
    const { wrapper, unmount } = await mountUserFlowApp({
      component: IntegrationConnectModal,
      props: {
        open: false,
        podId: "",
        provider: "",
      },
      attachTo: document.body,
      global: {
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: "<section><slot /></section>" },
          DialogDescription: { template: "<p><slot /></p>" },
          DialogFooter: { template: "<footer><slot /></footer>" },
          DialogHeader: { template: "<header><slot /></header>" },
          DialogTitle: { template: "<h2><slot /></h2>" },
        },
      },
    });

    try {
      await flushUi();
      expect(wrapper.exists()).toBe(true);
      expect(mockShowErrorToast).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("restores the existing Discord channel binding and submits the selected channel id", async () => {
    const requests: Array<{ requestEvent: string; payload: unknown }> = [];

    const { wrapper, unmount } = await mountUserFlowApp({
      component: IntegrationConnectModal,
      props: {
        open: true,
        podId: "pod-discord-1",
        provider: "discord",
      },
      attachTo: document.body,
      global: {
        stubs: {
          Dialog: { template: "<div><slot /></div>" },
          DialogContent: { template: "<section><slot /></section>" },
          DialogDescription: { template: "<p><slot /></p>" },
          DialogFooter: { template: "<footer><slot /></footer>" },
          DialogHeader: { template: "<header><slot /></header>" },
          DialogTitle: { template: "<h2><slot /></h2>" },
        },
      },
    });

    const canvasStore = useCanvasStore();
    const integrationStore = useIntegrationStore();
    const podStore = usePodStore();

    canvasStore.activeCanvasId = "canvas-discord";
    integrationStore.apps.discord = [
      {
        id: "discord-app-1",
        name: "release-bot",
        provider: "discord",
        connectionStatus: "connected",
        resources: [
          { id: "channel-1", label: "Release Guild / #deployments" },
          { id: "channel-2", label: "Ops Guild / #alerts" },
        ],
        raw: {
          resources: [
            {
              id: "channel-1",
              guildName: "Release Guild",
              channelName: "deployments",
            },
            {
              id: "channel-2",
              guildName: "Ops Guild",
              channelName: "alerts",
            },
          ],
        },
      },
    ];
    podStore.addPod(
      createMockPod({
        id: "pod-discord-1",
        integrationBindings: [
          {
            provider: "discord",
            appId: "discord-app-1",
            resourceId: "channel-2",
            extra: {},
          },
        ],
      }),
    );

    mockCreateWebSocketRequest.mockImplementation(async (request) => {
      requests.push({
        requestEvent: request.requestEvent,
        payload: request.payload,
      });

      if (request.requestEvent === "integration:app:resources:refresh") {
        return {
          success: true,
          appId: "discord-app-1",
          resources: [
            {
              id: "channel-1",
              name: "deployments",
              guildName: "Release Guild",
              channelName: "deployments",
            },
            {
              id: "channel-2",
              name: "alerts",
              guildName: "Ops Guild",
              channelName: "alerts",
            },
          ],
        };
      }

      if (request.requestEvent === "pod:bind-integration") {
        return { success: true, provider: "discord" };
      }

      throw new Error(`Unexpected request: ${request.requestEvent}`);
    });

    try {
      await flushUi();

      const restoredResource = wrapper.find("#resource-channel-2");
      expect(restoredResource.exists()).toBe(true);
      expect(restoredResource.attributes("data-state")).toBe("checked");

      await wrapper.find("#resource-channel-1").trigger("click");
      await flushUi();

      const confirmButton = wrapper
        .findAll("button")
        .find((button) => button.text().includes("確認"));
      expect(confirmButton).toBeTruthy();
      await confirmButton!.trigger("click");
      await flushUi();

      expect(requests).toContainEqual({
        requestEvent: "pod:bind-integration",
        payload: {
          canvasId: "canvas-discord",
          podId: "pod-discord-1",
          provider: "discord",
          appId: "discord-app-1",
          resourceId: "channel-1",
        },
      });
    } finally {
      unmount();
    }
  });
});
