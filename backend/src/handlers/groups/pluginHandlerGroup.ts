import { WebSocketRequestEvents, WebSocketResponseEvents } from "../../schemas";
import { pluginListSchema } from "../../schemas";
import { handlePluginList } from "../pluginHandlers.js";
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
  ],
});
