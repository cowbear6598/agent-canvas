import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "@tests/helpers/mockWebSocket";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { createMockConnection } from "@tests/helpers/factories";
import ConnectionLayer from "@/components/canvas/ConnectionLayer.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useCanvasStore } from "@/stores/canvasStore";

vi.mock("@/services/websocket", () => webSocketMockFactory());

function pressKey(key: "Delete" | "Backspace"): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("ConnectionLayer", () => {
  setupStoreTest();

  it("deletes selected connection with keyboard delete shortcut", () => {
    const wrapper = mount(ConnectionLayer, {
      attachTo: document.body,
      global: {
        stubs: {
          ConnectionLine: true,
        },
      },
    });
    const connectionStore = useConnectionStore();
    const canvasStore = useCanvasStore();
    canvasStore.activeCanvasId = "canvas-1";
    connectionStore.connections = [createMockConnection({ id: "conn-1" })];
    connectionStore.selectedConnectionId = "conn-1";
    mockCreateWebSocketRequest.mockResolvedValueOnce({ success: true });

    pressKey("Delete");

    expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestEvent: "connection:delete",
        payload: expect.objectContaining({ connectionId: "conn-1" }),
      }),
    );
    wrapper.unmount();
  });

  it("does not delete selected connection when editing text", () => {
    const wrapper = mount(ConnectionLayer, {
      attachTo: document.body,
      global: {
        stubs: {
          ConnectionLine: true,
        },
      },
    });
    const connectionStore = useConnectionStore();
    connectionStore.connections = [createMockConnection({ id: "conn-1" })];
    connectionStore.selectedConnectionId = "conn-1";
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressKey("Backspace");

    expect(mockCreateWebSocketRequest).not.toHaveBeenCalled();
    input.remove();
    wrapper.unmount();
  });
});
