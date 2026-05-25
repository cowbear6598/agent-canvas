import { z } from "zod";
import { WebSocketResponseEvents } from "./events.js";

export interface ServerEventManifestEntry {
  event: WebSocketResponseEvents;
  schemaName: string;
  schema: z.ZodType<unknown>;
}

export const serverEventManifest: ServerEventManifestEntry[] = Object.values(
  WebSocketResponseEvents,
).map((event) => ({
  event,
  schemaName: "serverEventPayloadSchema",
  schema: z.unknown(),
}));
