import { WebSocketResponseEvents } from "../schemas/index.js";
import type {
  BackupTriggerPayload,
  BackupTestConnectionPayload,
} from "../schemas/index.js";
import { configStore } from "../services/configStore.js";
import { backupService } from "../services/backupService.js";
import { socketService } from "../services/socketService.js";

export async function handleBackupTrigger(
  connectionId: string,
  payload: BackupTriggerPayload,
  requestId: string,
): Promise<void> {
  // 優先使用 payload URL（表單尚未儲存時使用），否則 fallback 到已儲存設定
  const gitRemoteUrlFromPayload = payload.gitRemoteUrl;
  const { backupGitRemoteUrl: backupGitRemoteUrlFromConfig } =
    configStore.getBackupConfig();
  const backupGitRemoteUrl =
    gitRemoteUrlFromPayload ?? backupGitRemoteUrlFromConfig;

  if (!backupGitRemoteUrl) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.BACKUP_TRIGGER_RESULT,
      {
        requestId,
        success: false,
        error: "尚未設定備份 Remote URL",
      },
    );
    return;
  }

  socketService.emitToConnection(
    connectionId,
    WebSocketResponseEvents.BACKUP_TRIGGER_RESULT,
    {
      requestId,
      success: true,
    },
  );

  const timestamp = new Date().toISOString();
  socketService.emitToAll(WebSocketResponseEvents.BACKUP_STARTED, {
    timestamp,
  });

  const result = await backupService.executeBackup(backupGitRemoteUrl);

  if (result.success) {
    socketService.emitToAll(WebSocketResponseEvents.BACKUP_COMPLETED, {
      timestamp: new Date().toISOString(),
    });
  } else {
    socketService.emitToAll(WebSocketResponseEvents.BACKUP_FAILED, {
      error: result.error,
      timestamp: new Date().toISOString(),
    });
  }
}

export async function handleBackupTestConnection(
  connectionId: string,
  payload: BackupTestConnectionPayload,
  requestId: string,
): Promise<void> {
  const { gitRemoteUrl } = payload;

  if (!gitRemoteUrl) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT,
      {
        requestId,
        success: false,
        error: "尚未設定備份 Remote URL",
      },
    );
    return;
  }

  const result = await backupService.testConnection(gitRemoteUrl);

  if (result.success) {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT,
      {
        requestId,
        success: true,
      },
    );
  } else {
    socketService.emitToConnection(
      connectionId,
      WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT,
      {
        requestId,
        success: false,
        error: result.error,
      },
    );
  }
}
