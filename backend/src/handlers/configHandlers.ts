import { WebSocketResponseEvents } from "../schemas";
import type { ConfigGetPayload, ConfigUpdatePayload } from "../schemas";
import { configStore } from "../services/configStore.js";
import { socketService } from "../services/socketService.js";

export async function handleConfigGet(
  connectionId: string,
  payload: ConfigGetPayload,
  requestId: string,
): Promise<void> {
  const config = configStore.getAll();

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.CONFIG_GET_RESULT,
    {
      requestId,
      success: true,
      summaryModel: config.summaryModel,
      aiDecideModel: config.aiDecideModel,
      enabledPluginIds: config.enabledPluginIds,
    },
  );
}

export async function handleConfigUpdate(
  connectionId: string,
  payload: ConfigUpdatePayload,
  requestId: string,
): Promise<void> {
  const config = configStore.update({
    summaryModel: payload.summaryModel,
    aiDecideModel: payload.aiDecideModel,
    enabledPluginIds: payload.enabledPluginIds,
  });

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.CONFIG_UPDATED,
    {
      requestId,
      success: true,
      summaryModel: config.summaryModel,
      aiDecideModel: config.aiDecideModel,
      enabledPluginIds: config.enabledPluginIds,
    },
  );
}
