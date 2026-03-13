import { z } from 'zod';
import { requestIdSchema, canvasIdSchema } from './base.js';

export const runDeleteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  runId: z.uuid(),
});

export type RunDeletePayload = z.infer<typeof runDeleteSchema>;

export const runLoadHistorySchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
});

export type RunLoadHistoryPayload = z.infer<typeof runLoadHistorySchema>;

export const runLoadPodMessagesSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  runId: z.uuid(),
  podId: z.uuid(),
});

export type RunLoadPodMessagesPayload = z.infer<typeof runLoadPodMessagesSchema>;
