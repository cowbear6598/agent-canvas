import { z } from 'zod';
import { createHandlerDefinition, type HandlerGroup, type HandlerDefinition } from '../registry.js';
import type { ValidatedHandler } from '../../middleware/wsMiddleware.js';

type NoteHandlers = {
  handleNoteCreate: ValidatedHandler<never>;
  handleNoteList: ValidatedHandler<never>;
  handleNoteUpdate: ValidatedHandler<never>;
  handleNoteDelete: ValidatedHandler<never>;
};

type NoteSchemas = {
  create: z.ZodType;
  list: z.ZodType;
  update: z.ZodType;
  delete: z.ZodType;
};

type NoteEvents = {
  create: string;
  list: string;
  update: string;
  delete: string;
  created: string;
  listResult: string;
  updated: string;
  deleted: string;
};

export function createNoteHandlerGroupEntries(
  handlers: NoteHandlers,
  schemas: NoteSchemas,
  events: NoteEvents
): HandlerConfig[] {
  return [
    { event: events.create, handler: handlers.handleNoteCreate as HandlerConfig['handler'], schema: schemas.create, responseEvent: events.created },
    { event: events.list, handler: handlers.handleNoteList as HandlerConfig['handler'], schema: schemas.list, responseEvent: events.listResult },
    { event: events.update, handler: handlers.handleNoteUpdate as HandlerConfig['handler'], schema: schemas.update, responseEvent: events.updated },
    { event: events.delete, handler: handlers.handleNoteDelete as HandlerConfig['handler'], schema: schemas.delete, responseEvent: events.deleted },
  ];
}

export interface HandlerConfig {
  event: string;
  handler(connectionId: string, payload: never, requestId: string): Promise<void>;
  schema: z.ZodType;
  responseEvent: string;
}

export function defineHandlerConfig<TSchema extends z.ZodType>(config: {
  event: string;
  handler: ValidatedHandler<z.infer<TSchema>>;
  schema: TSchema;
  responseEvent: string;
}): HandlerConfig {
  return config as unknown as HandlerConfig;
}

export function createHandlerGroup(config: { name: string; handlers: readonly HandlerConfig[] }): HandlerGroup {
  return {
    name: config.name,
    handlers: config.handlers.map((h): HandlerDefinition =>
      createHandlerDefinition(h.event, h.handler as ValidatedHandler<z.infer<typeof h.schema>>, h.schema, h.responseEvent)
    ),
  };
}
