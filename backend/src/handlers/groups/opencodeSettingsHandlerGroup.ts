import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../schemas/index.js";
import {
  opencodeProviderListSchema,
  opencodeAliasesListSchema,
  opencodeAliasesCreateSchema,
  opencodeAliasesUpdateSchema,
  opencodeAliasesDeleteSchema,
  opencodeAliasesReorderSchema,
} from "../../schemas/opencodeSettingsSchemas.js";
import {
  handleOpencodeProviderList,
  handleOpencodeAliasesList,
  handleOpencodeAliasesCreate,
  handleOpencodeAliasesUpdate,
  handleOpencodeAliasesDelete,
  handleOpencodeAliasesReorder,
} from "../opencodeSettingsHandlers.js";
import { createHandlerGroup } from "./createHandlerGroup.js";

export const opencodeSettingsHandlerGroup = createHandlerGroup({
  name: "opencodeSettings",
  handlers: [
    {
      event: WebSocketRequestEvents.OPENCODE_PROVIDER_LIST,
      handler: handleOpencodeProviderList,
      schema: opencodeProviderListSchema,
      responseEvent: WebSocketResponseEvents.OPENCODE_PROVIDER_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.OPENCODE_ALIASES_LIST,
      handler: handleOpencodeAliasesList,
      schema: opencodeAliasesListSchema,
      responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_LIST_RESULT,
    },
    {
      event: WebSocketRequestEvents.OPENCODE_ALIASES_CREATE,
      handler: handleOpencodeAliasesCreate,
      schema: opencodeAliasesCreateSchema,
      responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_CREATE_RESULT,
    },
    {
      event: WebSocketRequestEvents.OPENCODE_ALIASES_UPDATE,
      handler: handleOpencodeAliasesUpdate,
      schema: opencodeAliasesUpdateSchema,
      responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_UPDATE_RESULT,
    },
    {
      event: WebSocketRequestEvents.OPENCODE_ALIASES_DELETE,
      handler: handleOpencodeAliasesDelete,
      schema: opencodeAliasesDeleteSchema,
      responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_DELETE_RESULT,
    },
    {
      event: WebSocketRequestEvents.OPENCODE_ALIASES_REORDER,
      handler: handleOpencodeAliasesReorder,
      schema: opencodeAliasesReorderSchema,
      responseEvent: WebSocketResponseEvents.OPENCODE_ALIASES_REORDER_RESULT,
    },
  ],
});
