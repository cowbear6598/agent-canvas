import { WebSocketResponseEvents } from "../schemas";
import type { ConfigGetPayload, ConfigUpdatePayload } from "../schemas";
import { configStore } from "../services/configStore.js";
import { socketService } from "../services/socketService.js";
import { backupScheduleService } from "../services/backupScheduleService.js";

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
      timezoneOffset: config.timezoneOffset,
      backupGitRemoteUrl: config.backupGitRemoteUrl,
      backupTime: config.backupTime,
      backupEnabled: config.backupEnabled,
    },
  );
}

export async function handleConfigUpdate(
  connectionId: string,
  payload: ConfigUpdatePayload,
  requestId: string,
): Promise<void> {
  const backupSettingsChanged =
    payload.backupGitRemoteUrl !== undefined ||
    payload.backupTime !== undefined ||
    payload.backupEnabled !== undefined;

  const config = configStore.update({
    summaryModel: payload.summaryModel,
    aiDecideModel: payload.aiDecideModel,
    timezoneOffset: payload.timezoneOffset,
    backupGitRemoteUrl: payload.backupGitRemoteUrl,
    backupTime: payload.backupTime,
    backupEnabled: payload.backupEnabled,
  });

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.CONFIG_UPDATED,
    {
      requestId,
      success: true,
      summaryModel: config.summaryModel,
      aiDecideModel: config.aiDecideModel,
      timezoneOffset: config.timezoneOffset,
      backupGitRemoteUrl: config.backupGitRemoteUrl,
      backupTime: config.backupTime,
      backupEnabled: config.backupEnabled,
    },
  );

  if (backupSettingsChanged) {
    backupScheduleService.reload();
  }
}
