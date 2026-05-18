import { v4 as uuidv4 } from "uuid";
import {
  emitAndWaitResponse,
  setupIntegrationTest,
  waitForEvent,
} from "../setup";
import { createPod, getCanvasId } from "../helpers";
import { managedMcpStore } from "../../src/services/mcp/managedMcpStore.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas";

describe("Managed MCP handlers integration", () => {
  const { getClient } = setupIntegrationTest();

  it("registry list 回傳 persisted entries", async () => {
    const client = getClient();
    const seededName = `context7-${Date.now()}`;

    managedMcpStore.save({
      name: seededName,
      transport: "stdio",
      enabled: true,
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    });

    const response = await emitAndWaitResponse<
      { requestId: string },
      { success: boolean; items?: Array<{ name: string }> }
    >(
      client,
      WebSocketRequestEvents.MANAGED_MCP_REGISTRY_LIST,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
      { requestId: uuidv4() },
    );

    expect(response.success).toBe(true);
    expect(response.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: seededName })]),
    );
  });

  it("save 後廣播 registry updated", async () => {
    const client = getClient();
    const requestId = uuidv4();
    const updatedEventPromise = waitForEvent<{
      action?: string;
      registryId?: string;
      item?: { name: string };
    }>(client, WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED);

    const responsePromise = emitAndWaitResponse<
      {
        requestId: string;
        registry: {
          name: string;
          transport: "http";
          enabled: boolean;
          url: string;
        };
      },
      { success: boolean; item?: { id: string; name: string } }
    >(
      client,
      WebSocketRequestEvents.MANAGED_MCP_REGISTRY_SAVE,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
      {
        requestId,
        registry: {
          name: `remote-docs-${Date.now()}`,
          transport: "http",
          enabled: true,
          url: "https://example.com/mcp",
        },
      },
    );

    const [response, updated] = await Promise.all([
      responsePromise,
      updatedEventPromise,
    ]);

    expect(response.success).toBe(true);
    expect(updated.action).toBe("saved");
    expect(updated.registryId).toBe(response.item?.id);
    expect(updated.item?.name).toBe(response.item?.name);
  });

  it("delete 後清單移除該 entry", async () => {
    const client = getClient();
    const created = managedMcpStore.save({
      name: `temporary-${Date.now()}`,
      transport: "sse",
      enabled: true,
      url: "https://example.com/stream",
    });

    await emitAndWaitResponse<
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

    const listResponse = await emitAndWaitResponse<
      { requestId: string },
      { success: boolean; items?: Array<{ id: string }> }
    >(
      client,
      WebSocketRequestEvents.MANAGED_MCP_REGISTRY_LIST,
      WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
      { requestId: uuidv4() },
    );

    expect(listResponse.success).toBe(true);
    expect(listResponse.items?.find((item) => item.id === created.id)).toBe(
      undefined,
    );
  });

  it("Pod 寫入不存在的 name 會被過濾", async () => {
    const client = getClient();
    const pod = await createPod(client);
    const canvasId = await getCanvasId(client);

    const response = await emitAndWaitResponse<
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
        mcpServerNames: ["ghost-server"],
      },
    );

    expect(response.success).toBe(true);
    expect(response.mcpServerNames).toEqual([]);
    expect(response.ignoredNames).toEqual(["ghost-server"]);
  });
});
