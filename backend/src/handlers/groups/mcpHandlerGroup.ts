import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../schemas/index.js";
import {
  managedMcpRegistryDeleteRequestSchema,
  managedMcpRegistryListRequestSchema,
  managedMcpRegistrySaveRequestSchema,
  managedMcpRegistryTestRequestSchema,
  podMcpAvailabilityListRequestSchema,
  podSetMcpServerNamesSchema,
} from "../../schemas/mcpSchemas.js";
import {
  handleManagedMcpRegistryDelete,
  handleManagedMcpRegistryList,
  handleManagedMcpRegistrySave,
  handleManagedMcpRegistryTest,
  handlePodMcpAvailabilityList,
  handlePodSetMcpServerNames,
} from "../mcpHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const mcpHandlerGroup = createHandlerGroup({
  name: "mcp",
  handlers: [
    {
      event: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_LIST,
      handler: handleManagedMcpRegistryList,
      schema: managedMcpRegistryListRequestSchema,
      responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_SAVE,
      handler: handleManagedMcpRegistrySave,
      schema: managedMcpRegistrySaveRequestSchema,
      responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_SAVED,
    },
    {
      event: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_DELETE,
      handler: handleManagedMcpRegistryDelete,
      schema: managedMcpRegistryDeleteRequestSchema,
      responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_DELETED,
    },
    {
      event: WebSocketRequestEvents.MANAGED_MCP_REGISTRY_TEST,
      handler: handleManagedMcpRegistryTest,
      schema: managedMcpRegistryTestRequestSchema,
      responseEvent: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_TEST_RESULT,
    },
    {
      event: WebSocketRequestEvents.POD_MCP_AVAILABILITY_LIST,
      handler: handlePodMcpAvailabilityList,
      schema: podMcpAvailabilityListRequestSchema,
      responseEvent: WebSocketResponseEvents.POD_MCP_AVAILABILITY_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.POD_SET_MCP_SERVER_NAMES,
      handler: handlePodSetMcpServerNames,
      schema: podSetMcpServerNamesSchema,
      responseEvent: WebSocketResponseEvents.POD_MCP_SERVER_NAMES_UPDATED,
    },
  ],
});
