import { promises as fs } from "fs";
import path from "path";
import { WebSocketResponseEvents } from "../schemas";
import type { ConfigGetPayload, ConfigUpdatePayload } from "../schemas";
import { configStore } from "../services/configStore.js";
import { socketService } from "../services/socketService.js";
import { backupScheduleService } from "../services/backupScheduleService.js";
import { config } from "../config/index.js";

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

  // 在更新 DB 之前，先取得目前的 backupEnabled 狀態，用於判斷是否為「從啟用變為停用」
  const previousBackupEnabled = configStore.getBackupConfig().backupEnabled;

  // 關閉備份時，強制清空 Git Remote URL（不修改 payload，使用 local 變數）
  const effectiveGitRemoteUrl =
    payload.backupEnabled === false ? "" : payload.backupGitRemoteUrl;

  const updatedConfig = configStore.update({
    timezoneOffset: payload.timezoneOffset,
    backupGitRemoteUrl: effectiveGitRemoteUrl,
    backupTime: payload.backupTime,
    backupEnabled: payload.backupEnabled,
  });

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.CONFIG_UPDATED,
    {
      requestId,
      success: true,
      timezoneOffset: updatedConfig.timezoneOffset,
      backupGitRemoteUrl: updatedConfig.backupGitRemoteUrl,
      backupTime: updatedConfig.backupTime,
      backupEnabled: updatedConfig.backupEnabled,
    },
  );

  if (backupSettingsChanged) {
    backupScheduleService.reload();
  }

  // 當備份從啟用變為停用時，刪除 .git 目錄
  const backupJustDisabled =
    previousBackupEnabled === true && payload.backupEnabled === false;

  if (backupJustDisabled) {
    const backupGitDir = path.join(config.appDataRoot, ".git");
    try {
      await fs.rm(backupGitDir, { recursive: true, force: true });
    } catch {
      // 忽略刪除失敗
    }
  }
}
