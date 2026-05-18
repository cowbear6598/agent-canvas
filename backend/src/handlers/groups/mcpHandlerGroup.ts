import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../schemas/index.js";
import {
  managedMcpRegistryDeleteRequestSchema,
  managedMcpRegistryListRequestSchema,
  managedMcpRegistrySaveRequestSchema,
  mcpListRequestSchema,
  podMcpAvailabilityListRequestSchema,
  podSetMcpServerNamesSchema,
} from "../../schemas/mcpSchemas.js";
import {
  handleManagedMcpRegistryDelete,
  handleManagedMcpRegistryList,
  handleManagedMcpRegistrySave,
  handleMcpList,
  handlePodMcpAvailabilityList,
  handlePodSetMcpServerNames,
} from "../mcpHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const mcpHandlerGroup = createHandlerGroup({
  name: "mcp",
  handlers: [
    {
      event: WebSocketRequestEvents.MCP_LIST,
      handler: handleMcpList,
      schema: mcpListRequestSchema,
      responseEvent: WebSocketResponseEvents.MCP_LIST_RESULT,
    },
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
