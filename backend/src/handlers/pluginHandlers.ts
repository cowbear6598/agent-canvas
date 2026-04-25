import { WebSocketResponseEvents } from "../schemas";
import type { PluginListPayload } from "../schemas";
import { scanInstalledPlugins } from "../services/pluginScanner.js";
import { socketService } from "../services/socketService.js";

export async function handlePluginList(
  connectionId: string,
  payload: PluginListPayload,
  requestId: string,
): Promise<void> {
  const { provider } = payload;
  const plugins = scanInstalledPlugins(provider).map(
    ({ id, name, version, description, repo, compatibleProviders }) => ({
      id,
      name,
      version,
      description,
      repo,
      compatibleProviders,
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
