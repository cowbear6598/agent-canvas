import { z } from "zod";
import {
  requestIdSchema,
  podIdSchema,
  canvasIdSchema,
  coordinateSchema,
} from "./base.js";
import { scheduleConfigSchema } from "./scheduleSchemas.js";

export const modelTypeSchema = z.enum(["opus", "sonnet", "haiku"]);

export const podCreateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  name: z.string().min(1).max(100),
  x: coordinateSchema,
  y: coordinateSchema,
  rotation: z.number(),
});

export const podListSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
});

export const podGetSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});

export const podMoveSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
  x: coordinateSchema,
  y: coordinateSchema,
});

export const podRenameSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
  name: z.string().min(1).max(100),
});

export const podSetModelSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
  model: modelTypeSchema,
});

export const podSetScheduleSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
  schedule: scheduleConfigSchema.nullable(),
});

export const podDeleteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});

export const podOpenDirectorySchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});

export const podSetPluginsSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
  pluginIds: z
    .array(
      z
        .string()
        .regex(/^[a-zA-Z0-9@._-]+$/)
        .max(100),
    )
    .max(50),
});

export type PodCreatePayload = z.infer<typeof podCreateSchema>;
export type PodListPayload = z.infer<typeof podListSchema>;
export type PodGetPayload = z.infer<typeof podGetSchema>;
export type PodMovePayload = z.infer<typeof podMoveSchema>;
export type PodRenamePayload = z.infer<typeof podRenameSchema>;
export type PodSetModelPayload = z.infer<typeof podSetModelSchema>;
export type PodSetSchedulePayload = z.infer<typeof podSetScheduleSchema>;
export type PodDeletePayload = z.infer<typeof podDeleteSchema>;
export type PodOpenDirectoryPayload = z.infer<typeof podOpenDirectorySchema>;
export type PodSetPluginsPayload = z.infer<typeof podSetPluginsSchema>;
