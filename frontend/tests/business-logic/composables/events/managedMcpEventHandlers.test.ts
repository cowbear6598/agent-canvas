import { describe, expect, it, vi } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useCanvasStore } from "@/stores/canvasStore";
import { getManagedMcpEventListeners } from "@/composables/eventHandlers/managedMcpEventHandlers";

const { showErrorToastMock } = vi.hoisted(() => ({
  showErrorToastMock: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showErrorToast: showErrorToastMock,
  }),
}));

vi.mock("@/services/managedMcpApi", () => ({
  invalidateManagedMcpRegistryCache: vi.fn(),
  invalidatePodMcpAvailabilityCache: vi.fn(),
}));

describe("managedMcpEventHandlers", () => {
  setupStoreTest(() => {
    useCanvasStore().activeCanvasId = "canvas-1";
  });

  it("ignored target toast 使用目前語系與 pod 名稱插值", () => {
    const listener = getManagedMcpEventListeners().find(
      (item) => item.event === "managed-mcp:surface:targets-ignored",
    );

    listener?.handler({
      success: true,
      canvasId: "canvas-1",
      podName: "規劃 Pod",
      ignored: [{ name: "filesystem", reason: "connect timeout" }],
    });

    expect(showErrorToastMock).toHaveBeenCalledWith(
      "Mcp",
      "規劃 Pod 略過了選定的 MCP",
      "filesystem（connect timeout）",
    );
  });
});
