import { WebSocketResponseEvents } from "../schemas";
import type { PluginListPayload } from "../schemas";
import { scanInstalledPlugins } from "../services/pluginScanner.js";
import { socketService } from "../services/socketService.js";

export async function handlePluginList(
  connectionId: string,
  payload: PluginListPayload,
  requestId: string,
): Promise<void> {
  const plugins = scanInstalledPlugins().map(
    ({ id, name, version, description }) => ({
      id,
      name,
      version,
      description,
    }),
  );

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.PLUGIN_LIST_RESULT,
    {
      requestId,
      success: true,
      plugins,
    },
  );
}
