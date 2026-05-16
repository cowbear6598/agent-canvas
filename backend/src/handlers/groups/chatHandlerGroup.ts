import { WebSocketRequestEvents, WebSocketResponseEvents } from "../../schemas";
import { chatSendSchema, chatAbortSchema } from "../../schemas";
import { handleChatSend, handleChatAbort } from "../chatHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const chatHandlerGroup = createHandlerGroup({
  name: "chat",
  handlers: [
    {
      event: WebSocketRequestEvents.POD_CHAT_SEND,
      handler: handleChatSend,
      schema: chatSendSchema,
      responseEvent: WebSocketResponseEvents.POD_ERROR,
    },
    {
      event: WebSocketRequestEvents.POD_CHAT_ABORT,
      handler: handleChatAbort,
      schema: chatAbortSchema,
      responseEvent: WebSocketResponseEvents.POD_ERROR,
    },
  ],
});
