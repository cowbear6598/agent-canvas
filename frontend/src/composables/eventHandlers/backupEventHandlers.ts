import { WebSocketResponseEvents } from "@/services/websocket";
import { useConfigStore } from "@/stores/configStore";
import { useToast } from "@/composables/useToast";
import type {
  BackupStartedPayload,
  BackupCompletedPayload,
  BackupFailedPayload,
} from "@/types/websocket/responses";

export const handleBackupStarted = (_payload: BackupStartedPayload): void => {
  useConfigStore().setBackupStatus("running");
};

export const handleBackupCompleted = (
  payload: BackupCompletedPayload,
): void => {
  const configStore = useConfigStore();
  configStore.setBackupStatus("success");
  configStore.setLastBackupTime(payload.timestamp);
  const { showSuccessToast } = useToast();
  showSuccessToast("Config", "備份完成");
};

export const handleBackupFailed = (payload: BackupFailedPayload): void => {
  // 只更新 configStore 狀態，錯誤訊息以 inline 方式顯示，不使用 toast
  useConfigStore().setBackupStatus("failed", payload.error);
};

export function getBackupStandaloneListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.BACKUP_STARTED,
      handler: handleBackupStarted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.BACKUP_COMPLETED,
      handler: handleBackupCompleted as (payload: unknown) => void,
    },
    {
      event: WebSocketResponseEvents.BACKUP_FAILED,
      handler: handleBackupFailed as (payload: unknown) => void,
    },
  ];
}
