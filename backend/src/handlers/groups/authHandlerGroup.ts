import { WebSocketRequestEvents, WebSocketResponseEvents } from "../../schemas";
import {
  authBootstrapSchema,
  authUnlockCanvasSchema,
  authUnlockWorkspaceSchema,
  authUpdateWorkspacePasswordSchema,
} from "../../schemas";
import {
  handleAuthBootstrap,
  handleAuthUnlockCanvas,
  handleAuthUnlockWorkspace,
  handleAuthUpdateWorkspacePassword,
} from "../authHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const authHandlerGroup = createHandlerGroup({
  name: "auth",
  handlers: [
    {
      event: WebSocketRequestEvents.AUTH_BOOTSTRAP,
      handler: handleAuthBootstrap,
      schema: authBootstrapSchema,
      responseEvent: WebSocketResponseEvents.AUTH_BOOTSTRAP_RESULT,
    },
    {
      event: WebSocketRequestEvents.AUTH_UNLOCK_WORKSPACE,
      handler: handleAuthUnlockWorkspace,
      schema: authUnlockWorkspaceSchema,
      responseEvent: WebSocketResponseEvents.AUTH_WORKSPACE_UNLOCK_RESULT,
    },
    {
      event: WebSocketRequestEvents.AUTH_UNLOCK_CANVAS,
      handler: handleAuthUnlockCanvas,
      schema: authUnlockCanvasSchema,
      responseEvent: WebSocketResponseEvents.AUTH_CANVAS_UNLOCK_RESULT,
    },
    {
      event: WebSocketRequestEvents.AUTH_UPDATE_WORKSPACE_PASSWORD,
      handler: handleAuthUpdateWorkspacePassword,
      schema: authUpdateWorkspacePasswordSchema,
      responseEvent: WebSocketResponseEvents.AUTH_WORKSPACE_PASSWORD_UPDATED,
    },
  ],
});
