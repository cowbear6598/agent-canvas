import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../schemas/index.js";
import {
  backupTriggerSchema,
  backupTestConnectionSchema,
} from "../../schemas/index.js";
import {
  handleBackupTrigger,
  handleBackupTestConnection,
} from "../backupHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const backupHandlerGroup = createHandlerGroup({
  name: "backup",
  handlers: [
    {
      event: WebSocketRequestEvents.BACKUP_TRIGGER,
      handler: handleBackupTrigger,
      schema: backupTriggerSchema,
      responseEvent: WebSocketResponseEvents.BACKUP_TRIGGER_RESULT,
    },
    {
      event: WebSocketRequestEvents.BACKUP_TEST_CONNECTION,
      handler: handleBackupTestConnection,
      schema: backupTestConnectionSchema,
      responseEvent: WebSocketResponseEvents.BACKUP_TEST_CONNECTION_RESULT,
    },
  ],
});
