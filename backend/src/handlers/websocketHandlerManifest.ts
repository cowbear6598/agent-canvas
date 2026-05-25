import type { z } from "zod";
import { allHandlerGroups } from "./handlerGroups.js";

export interface WebSocketHandlerManifestEntry {
  groupName: string;
  event: string;
  handlerName: string;
  requestSchema: z.ZodType<unknown>;
  responseEvent: string;
}

export const webSocketHandlerManifest: WebSocketHandlerManifestEntry[] =
  allHandlerGroups.flatMap((group) =>
    group.handlers.map((definition) => ({
      groupName: group.name,
      event: definition.event,
      handlerName: definition.handler.name,
      requestSchema: definition.schema,
      responseEvent: definition.responseEvent,
    })),
  );
