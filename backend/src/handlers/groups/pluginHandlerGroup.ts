import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../schemas/index.js";
import {
  pluginListSchema,
  pluginInstallSchema,
  pluginDeleteSchema,
  pluginUpdateSchema,
  pluginReorderSchema,
} from "../../schemas/pluginSchemas.js";
import {
  handlePluginList,
  handlePluginInstall,
  handlePluginDelete,
  handlePluginUpdate,
  handlePluginReorder,
} from "../pluginHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const pluginHandlerGroup = createHandlerGroup({
  name: "plugin",
  handlers: [
    {
      event: WebSocketRequestEvents.PLUGIN_LIST,
      handler: handlePluginList,
      schema: pluginListSchema,
      responseEvent: WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.PLUGIN_INSTALL,
      handler: handlePluginInstall,
      schema: pluginInstallSchema,
      responseEvent: WebSocketResponseEvents.PLUGIN_INSTALLED,
    },
    {
      event: WebSocketRequestEvents.PLUGIN_DELETE,
      handler: handlePluginDelete,
      schema: pluginDeleteSchema,
      responseEvent: WebSocketResponseEvents.PLUGIN_DELETED,
    },
    {
      event: WebSocketRequestEvents.PLUGIN_UPDATE,
      handler: handlePluginUpdate,
      schema: pluginUpdateSchema,
      responseEvent: WebSocketResponseEvents.PLUGIN_UPDATED,
    },
    {
      event: WebSocketRequestEvents.PLUGIN_REORDER,
      handler: handlePluginReorder,
      schema: pluginReorderSchema,
      responseEvent: WebSocketResponseEvents.PLUGIN_REORDERED,
    },
  ],
});
