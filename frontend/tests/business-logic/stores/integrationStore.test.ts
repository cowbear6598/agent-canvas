import { describe, expect, it, vi } from "vitest";
import {
  mockCreateWebSocketRequest,
  webSocketMockFactory,
} from "@tests/helpers/mockWebSocket";
import {
  mockErrorSanitizerFactory,
  setupStoreTest,
} from "@tests/helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import { useIntegrationStore } from "@/stores/integrationStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

const { mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
  }),
}));

vi.mock("@/utils/errorSanitizer", () => mockErrorSanitizerFactory());

describe("integrationStore user flow support", () => {
  setupStoreTest();

  it("loads apps, creates one from a fake response, updates its status, and removes it after delete", async () => {
    const store = useIntegrationStore();
    const requests: Array<{ requestEvent: string; payload: unknown }> = [];

    mockCreateWebSocketRequest.mockImplementation(async (request) => {
      requests.push({
        requestEvent: request.requestEvent,
        payload: request.payload,
      });

      if (request.requestEvent === "integration:app:list") {
        return {
          success: true,
          provider: "slack",
          apps: [
            {
              id: "slack-existing",
              name: "Existing Slack",
              connectionStatus: "connected",
              resources: [{ id: "C001", name: "general" }],
            },
          ],
        };
      }

      if (request.requestEvent === "integration:app:create") {
        expect(request.payload).toMatchObject({
          provider: "slack",
          name: "Release Slack",
          config: {
            botToken: "xoxb-release-token",
            signingSecret: "signing-secret",
          },
        });
        return {
          success: true,
          provider: "slack",
          app: {
            id: "slack-new",
            name: "Release Slack",
            connectionStatus: "disconnected",
            resources: [],
          },
        };
      }

      if (request.requestEvent === "integration:app:delete") {
        expect(request.payload).toMatchObject({
          provider: "slack",
          appId: "slack-new",
        });
        return {
          success: true,
          provider: "slack",
          appId: "slack-new",
        };
      }

      throw new Error(`Unexpected integration request: ${request.requestEvent}`);
    });

    await store.loadApps("slack");
    expect(store.getAppsByProvider("slack")).toMatchObject([
      {
        id: "slack-existing",
        name: "Existing Slack",
        connectionStatus: "connected",
        resources: [{ id: "C001", label: "#general" }],
      },
    ]);

    const createdApp = await store.createApp("slack", {
      name: "Release Slack",
      botToken: "xoxb-release-token",
      signingSecret: "signing-secret",
    });
    expect(createdApp).toMatchObject({
      id: "slack-new",
      name: "Release Slack",
      connectionStatus: "disconnected",
    });

    store.addAppFromEvent("slack", {
      id: "slack-new",
      name: "Release Slack",
      connectionStatus: "disconnected",
      resources: [],
    });
    expect(store.getAppsByProvider("slack").map((app) => app.name)).toEqual([
      "Existing Slack",
      "Release Slack",
    ]);

    store.updateAppStatus("slack", "slack-new", "connected", [
      { id: "C002", name: "deployments" },
    ]);
    expect(store.getAppById("slack", "slack-new")).toMatchObject({
      connectionStatus: "connected",
      resources: [{ id: "C002", label: "#deployments" }],
    });

    await store.deleteApp("slack", "slack-new");
    store.removeAppFromEvent("slack", "slack-new");
    expect(store.getAppsByProvider("slack").map((app) => app.id)).toEqual([
      "slack-existing",
    ]);
    expect(requests.map((request) => request.requestEvent)).toEqual([
      "integration:app:list",
      "integration:app:create",
      "integration:app:delete",
    ]);
    expect(mockShowSuccessToast).toHaveBeenCalledWith(
      "Integration",
      "建立成功",
      "Release Slack",
    );
    expect(mockShowSuccessToast).toHaveBeenCalledWith(
      "Integration",
      "刪除成功",
    );
  });

  it("keeps the integration list stable and shows user-facing feedback when create fails", async () => {
    const store = useIntegrationStore();
    store.apps.slack = [
      {
        id: "slack-existing",
        name: "Existing Slack",
        provider: "slack",
        connectionStatus: "connected",
        resources: [],
        raw: {},
      },
    ];

    mockCreateWebSocketRequest.mockRejectedValueOnce(new Error("token denied"));

    const createdApp = await store.createApp("slack", {
      name: "Broken Slack",
      botToken: "xoxb-broken-token",
      signingSecret: "signing-secret",
    });

    expect(createdApp).toBeNull();
    expect(store.getAppsByProvider("slack").map((app) => app.name)).toEqual([
      "Existing Slack",
    ]);
    expect(mockShowErrorToast).toHaveBeenCalledWith(
      "Integration",
      "建立失敗",
      "token denied",
    );
  });

  it("builds pod binding and unbinding payloads from the selected app and active canvas", async () => {
    const canvasStore = useCanvasStore();
    const store = useIntegrationStore();
    const requests: Array<{ requestEvent: string; payload: unknown }> = [];

    canvasStore.activeCanvasId = "canvas-flow";
    store.apps.slack = [
      {
        id: "slack-existing",
        name: "Existing Slack",
        provider: "slack",
        connectionStatus: "connected",
        resources: [{ id: "C001", label: "#general" }],
        raw: {},
      },
    ];

    mockCreateWebSocketRequest.mockImplementation(async (request) => {
      requests.push({
        requestEvent: request.requestEvent,
        payload: request.payload,
      });
      return { success: true, provider: "slack" };
    });

    await store.bindToPod("slack", "pod-1", "slack-existing", "C001");
    await store.unbindFromPod("slack", "pod-1");

    expect(requests).toEqual([
      {
        requestEvent: "pod:bind-integration",
        payload: {
          canvasId: "canvas-flow",
          podId: "pod-1",
          provider: "slack",
          appId: "slack-existing",
          resourceId: "C001",
        },
      },
      {
        requestEvent: "pod:unbind-integration",
        payload: {
          canvasId: "canvas-flow",
          podId: "pod-1",
          provider: "slack",
        },
      },
    ]);
  });
});
