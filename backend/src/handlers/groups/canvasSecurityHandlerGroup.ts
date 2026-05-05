import { WebSocketRequestEvents, WebSocketResponseEvents } from "../../schemas";
import { canvasSecurityUpdateSchema } from "../../schemas";
import { handleCanvasSecurityUpdate } from "../canvasSecurityHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const canvasSecurityHandlerGroup = createHandlerGroup({
  name: "canvas-security",
  handlers: [
    {
      event: WebSocketRequestEvents.CANVAS_SECURITY_UPDATE,
      handler: handleCanvasSecurityUpdate,
      schema: canvasSecurityUpdateSchema,
      responseEvent: WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
    },
  ],
});
