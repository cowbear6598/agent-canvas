import { v4 as uuidv4 } from "uuid";
import {
  emitAndWaitResponse,
  setupIntegrationTest,
  waitForEvent,
} from "../setup";
import { createPod, getCanvasId } from "../helpers";
import { managedMcpStore } from "../../src/services/mcp/managedMcpStore.js";
import { podStore } from "../../src/services/podStore.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas";

describe("Managed MCP handlers integration", () => {
  const { getClient } = setupIntegrationTest();

  it("handler registry save 會寫入真 registry，並讓 pod 啟用可選 MCP", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);
    const pod = await createPod(client, {
      name: `managed-mcp-pod-${Date.now()}`,
    });
    const serverName = `remote-docs-${Date.now()}`;
    const savedEventPromise = waitForEvent<{
      action?: string;
      registryId?: string;
      item?: { id: string; name: string; status: string };
    }>(client, WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED);

    const saveResponse = await emitAndWaitResponse<
      {
        requestId: string;
        registry: {
          name: string;
          transport: "http";
          enabled: boolean;
          url: string;
        };
      },
      {
        success: boolean;
        item?: { id: string; name: string; transport: string; status: string };
      }
    >(
      client,
      WebSocketRequestEvents.MANAGED_MCP_REGISTRY_SAVE,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
      {
        requestId: uuidv4(),
        registry: {
          name: serverName,
          transport: "http",
          enabled: true,
          url: "https://example.com/mcp",
        },
      },
    );
    const savedEvent = await savedEventPromise;

    expect(saveResponse.success).toBe(true);
    expect(saveResponse.item).toMatchObject({
      name: serverName,
      transport: "http",
      status: "idle",
    });
    expect(savedEvent).toMatchObject({
      action: "saved",
      registryId: saveResponse.item?.id,
    });
    expect(managedMcpStore.getByName(serverName)).toMatchObject({
      id: saveResponse.item?.id,
      name: serverName,
      transport: "http",
      enabled: true,
      lastKnownStatus: "idle",
      url: "https://example.com/mcp",
    });

    const availabilityResponse = await emitAndWaitResponse<
      { requestId: string; podId: string },
      {
        success: boolean;
        items?: Array<{
          name: string;
          selected: boolean;
          selectable: boolean;
          status: string;
        }>;
      }
    >(
      client,
      WebSocketRequestEvents.POD_MCP_AVAILABILITY_LIST,
      WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT,
      { requestId: uuidv4(), podId: pod.id },
    );
    const available = availabilityResponse.items?.find(
      (item) => item.name === serverName,
    );
    expect(available).toMatchObject({
      selected: false,
      selectable: true,
      status: "idle",
    });

    const updateResponse = await emitAndWaitResponse<
      {
        requestId: string;
        canvasId: string;
        podId: string;
        mcpServerNames: string[];
      },
      { success: boolean; mcpServerNames?: string[]; ignoredNames?: string[] }
    >(
      client,
      WebSocketRequestEvents.POD_SET_MCP_SERVER_NAMES,
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        mcpServerNames: [serverName, "ghost-server"],
      },
    );

    expect(updateResponse.success).toBe(true);
    expect(updateResponse.mcpServerNames).toEqual([serverName]);
    expect(updateResponse.ignoredNames).toEqual(["ghost-server"]);
    expect(podStore.getById(canvasId, pod.id)?.mcpServerNames).toEqual([
      serverName,
    ]);
  });

  it("handler registry delete 會移除真 store entry，pod 後續啟用會 self-heal 成空清單", async () => {
    const client = getClient();
    const canvasId = await getCanvasId(client);
    const pod = await createPod(client);
    const created = managedMcpStore.save({
      name: `temporary-${Date.now()}`,
      transport: "sse",
      enabled: true,
      url: "https://example.com/stream",
    });

    const deletedEventPromise = waitForEvent<{ action?: string }>(
      client,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
    );
    const deleteResponse = await emitAndWaitResponse<
      { requestId: string; registryId: string },
      { success: boolean; registryId?: string }
    >(
      client,
      WebSocketRequestEvents.MANAGED_MCP_REGISTRY_DELETE,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
      {
        requestId: uuidv4(),
        registryId: created.id,
      },
    );
    const deletedEvent = await deletedEventPromise;

    expect(deleteResponse).toMatchObject({
      success: true,
      registryId: created.id,
    });
    expect(deletedEvent.action).toBe("deleted");
    expect(managedMcpStore.getById(created.id)).toBeUndefined();

    const updateResponse = await emitAndWaitResponse<
      {
        requestId: string;
        canvasId: string;
        podId: string;
        mcpServerNames: string[];
      },
      { success: boolean; mcpServerNames?: string[]; ignoredNames?: string[] }
    >(
      client,
      WebSocketRequestEvents.POD_SET_MCP_SERVER_NAMES,
      WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
      {
        requestId: uuidv4(),
        canvasId,
        podId: pod.id,
        mcpServerNames: [created.name],
      },
    );

    expect(updateResponse.success).toBe(true);
    expect(updateResponse.mcpServerNames).toEqual([]);
    expect(updateResponse.ignoredNames).toEqual([created.name]);
    expect(podStore.getById(canvasId, pod.id)?.mcpServerNames).toEqual([]);
  });
});
