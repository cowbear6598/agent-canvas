import { z } from 'zod';

export const requestIdSchema = z.uuid();
export const podIdSchema = z.uuid();
export const canvasIdSchema = z.uuid();
export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export const resourceIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(1).max(100);

export const coordinateSchema = z.number().finite().min(-100000).max(100000);

export const noteUpdateBaseSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  noteId: z.uuid(),
  x: z.number().optional(),
  y: z.number().optional(),
  boundToPodId: z.uuid().nullable().optional(),
  originalPosition: positionSchema.nullable().optional(),
});

export function createNoteCreateSchema<T extends z.ZodRawShape>(foreignKey: T): z.ZodObject<
  { requestId: typeof requestIdSchema; canvasId: typeof canvasIdSchema } & T &
  { name: z.ZodString; x: z.ZodNumber; y: z.ZodNumber; boundToPodId: z.ZodNullable<z.ZodUUID>; originalPosition: z.ZodNullable<typeof positionSchema> }
> {
  return z.object({
    requestId: requestIdSchema,
    canvasId: canvasIdSchema,
    ...foreignKey,
    name: z.string().min(1).max(100),
    x: z.number(),
    y: z.number(),
    boundToPodId: z.uuid().nullable(),
    originalPosition: positionSchema.nullable(),
  }) as ReturnType<typeof createNoteCreateSchema<T>>;
}

export function createPasteNoteItemSchema<T extends z.ZodRawShape>(foreignKey: T): z.ZodObject<
  T & { name: z.ZodString; x: z.ZodNumber; y: z.ZodNumber; boundToOriginalPodId: z.ZodNullable<z.ZodUUID>; originalPosition: z.ZodNullable<typeof positionSchema> }
> {
  return z.object({
    ...foreignKey,
    name: z.string().min(1).max(100),
    x: coordinateSchema,
    y: coordinateSchema,
    boundToOriginalPodId: z.uuid().nullable(),
    originalPosition: positionSchema.nullable(),
  }) as ReturnType<typeof createPasteNoteItemSchema<T>>;
}

export const canvasRequestSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
});

export const noteDeleteBaseSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  noteId: z.uuid(),
});

export const podUnbindBaseSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});
