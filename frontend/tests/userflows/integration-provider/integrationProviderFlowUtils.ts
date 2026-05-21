import { expect, vi } from "vitest";
import { nextTick } from "vue";
import type { DOMWrapper } from "@vue/test-utils";
import IntegrationAppsModal from "@/components/integration/IntegrationAppsModal.vue";
import { getProvider } from "@/integration/providerRegistry";
import { useIntegrationStore } from "@/stores/integrationStore";
import { mountUserFlowApp } from "@tests/helpers/userFlowLauncher";
import {
  mockCreateWebSocketRequest,
  resetMockWebSocket,
} from "@tests/helpers/mockWebSocket";

vi.mock("@/services/websocket", async () => {
  const { webSocketMockFactory } = await import("@tests/helpers/mockWebSocket");
  return webSocketMockFactory();
});

const { mockShowSuccessToast, mockShowErrorToast } = vi.hoisted(() => ({
  mockShowSuccessToast: vi.fn(),
  mockShowErrorToast: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showSuccessToast: mockShowSuccessToast,
    showErrorToast: mockShowErrorToast,
    toast: vi.fn(),
  }),
}));

export interface ProviderAppFlowOptions {
  provider: string;
  formValues: string[];
  createdApp: Record<string, unknown> & { id: string; name: string };
  updatedResources?: Array<{ id: string; name: string }>;
  visibleUpdatedResource?: string;
}

async function flushUserFlow(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

interface ButtonSearchWrapper {
  findAll(selector: string): DOMWrapper<Element>[];
}

function findButtonByText(
  wrapper: ButtonSearchWrapper,
  text: string,
): DOMWrapper<Element> {
  const button = wrapper.findAll("button").find((candidate) =>
    candidate.text().includes(text),
  );
  expect(button, `button containing "${text}"`).toBeTruthy();
  return button!;
}

export function resetProviderFlowMocks(): void {
  resetMockWebSocket();
  mockShowSuccessToast.mockClear();
  mockShowErrorToast.mockClear();
}

export async function verifyProviderAppManagementFlow(
  options: ProviderAppFlowOptions,
): Promise<void> {
  const config = getProvider(options.provider);
  const { wrapper, unmount } = await mountUserFlowApp({
    component: IntegrationAppsModal,
    props: {
      open: true,
      provider: options.provider,
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
  const integrationStore = useIntegrationStore();

  mockCreateWebSocketRequest.mockImplementation(async (request) => {
    if (request.requestEvent === "integration:app:create") {
      const payload = request.payload as Record<string, unknown>;
      expect(payload.provider).toBe(options.provider);
      integrationStore.addAppFromEvent(options.provider, options.createdApp);
      return {
        success: true,
        provider: options.provider,
        app: options.createdApp,
      };
    }

    if (request.requestEvent === "integration:app:resources:refresh") {
      return {
        success: true,
        appId: options.createdApp.id,
        resources: options.updatedResources ?? [],
      };
    }

    if (request.requestEvent === "integration:app:delete") {
      const payload = request.payload as Record<string, unknown>;
      expect(payload).toMatchObject({
        provider: options.provider,
        appId: options.createdApp.id,
      });
      integrationStore.removeAppFromEvent(
        options.provider,
        options.createdApp.id,
      );
      return {
        success: true,
        provider: options.provider,
        appId: options.createdApp.id,
      };
    }

    throw new Error(
      `Unexpected fake integration request: ${request.requestEvent}`,
    );
  });

  try {
    expect(wrapper.text()).toContain(config.emptyAppHint);

    await findButtonByText(wrapper, "新增 App").trigger("click");
    await flushUserFlow();

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(config.createFormFields.length);
    for (const [index, value] of options.formValues.entries()) {
      await inputs[index]!.setValue(value);
    }

    await findButtonByText(wrapper, "確認新增").trigger("click");
    await flushUserFlow();

    expect(wrapper.text()).toContain(options.createdApp.name);
    expect(
      integrationStore.getAppById(options.provider, options.createdApp.id),
    ).toBeTruthy();
    expect(mockShowSuccessToast).toHaveBeenCalledWith(
      "Integration",
      "建立成功",
      options.createdApp.name,
    );

    integrationStore.updateAppStatus(
      options.provider,
      options.createdApp.id,
      "connected",
      options.updatedResources,
    );
    await flushUserFlow();

    expect(
      integrationStore.getAppById(options.provider, options.createdApp.id)
        ?.connectionStatus,
    ).toBe("connected");
    if (options.visibleUpdatedResource) {
      expect(wrapper.text()).toContain(options.visibleUpdatedResource);
    }

    const appRow = wrapper
      .findAll(".flex.items-center.gap-3.rounded-md.border")
      .find((row) => row.text().includes(options.createdApp.name));
    expect(appRow, `row for ${options.createdApp.name}`).toBeTruthy();
    const deleteButton = appRow!.findAll("button").at(-1);
    expect(deleteButton).toBeTruthy();
    await deleteButton!.trigger("click");
    await flushUserFlow();

    expect(wrapper.text()).not.toContain(options.createdApp.name);
    expect(
      integrationStore.getAppById(options.provider, options.createdApp.id),
    ).toBeUndefined();
    expect(mockShowSuccessToast).toHaveBeenCalledWith(
      "Integration",
      "刪除成功",
    );
  } finally {
    unmount();
  }
}
