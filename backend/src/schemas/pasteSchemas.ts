import { z } from 'zod';
import { requestIdSchema, canvasIdSchema, coordinateSchema, createPasteNoteItemSchema, resourceIdSchema } from './base.js';
import { modelTypeSchema } from './podSchemas.js';
import { anchorPositionSchema } from './connectionSchemas.js';

export const pastePodItemSchema = z.object({
  originalId: z.uuid(),
  name: z.string().min(1).max(100),
  x: coordinateSchema,
  y: coordinateSchema,
  rotation: z.number().finite(),
  outputStyleId: resourceIdSchema.nullable().optional(),
  skillIds: z.array(resourceIdSchema).optional(),
  subAgentIds: z.array(resourceIdSchema).optional(),
  model: modelTypeSchema.optional(),
  repositoryId: resourceIdSchema.nullable().optional(),
  commandId: resourceIdSchema.nullable().optional(),
});

export const pasteOutputStyleNoteItemSchema = createPasteNoteItemSchema({ outputStyleId: resourceIdSchema });

export const pasteSkillNoteItemSchema = createPasteNoteItemSchema({ skillId: resourceIdSchema });

export const pasteRepositoryNoteItemSchema = createPasteNoteItemSchema({ repositoryId: resourceIdSchema });

export const pasteSubAgentNoteItemSchema = createPasteNoteItemSchema({ subAgentId: resourceIdSchema });

export const pasteCommandNoteItemSchema = createPasteNoteItemSchema({ commandId: resourceIdSchema });

export const pasteMcpServerNoteItemSchema = createPasteNoteItemSchema({ mcpServerId: resourceIdSchema });

export const pasteConnectionItemSchema = z.object({
  originalSourcePodId: z.uuid(),
  sourceAnchor: anchorPositionSchema,
  originalTargetPodId: z.uuid(),
  targetAnchor: anchorPositionSchema,
  triggerMode: z.enum(['auto', 'ai-decide', 'direct']).optional(),
});

export const canvasPasteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  pods: z.array(pastePodItemSchema).max(100),
  outputStyleNotes: z.array(pasteOutputStyleNoteItemSchema).max(100),
  skillNotes: z.array(pasteSkillNoteItemSchema).max(100),
  repositoryNotes: z.array(pasteRepositoryNoteItemSchema).max(100),
  subAgentNotes: z.array(pasteSubAgentNoteItemSchema).max(100),
  commandNotes: z.array(pasteCommandNoteItemSchema).max(100).optional(),
  mcpServerNotes: z.array(pasteMcpServerNoteItemSchema).max(100).optional(),
  connections: z.array(pasteConnectionItemSchema).max(200).optional(),
});

export type PastePodItem = z.infer<typeof pastePodItemSchema>;
export type CanvasPastePayload = z.infer<typeof canvasPasteSchema>;
export type PasteOutputStyleNoteItem = z.infer<typeof pasteOutputStyleNoteItemSchema>;
export type PasteSkillNoteItem = z.infer<typeof pasteSkillNoteItemSchema>;
export type PasteRepositoryNoteItem = z.infer<typeof pasteRepositoryNoteItemSchema>;
export type PasteSubAgentNoteItem = z.infer<typeof pasteSubAgentNoteItemSchema>;
export type PasteCommandNoteItem = z.infer<typeof pasteCommandNoteItemSchema>;
export type PasteMcpServerNoteItem = z.infer<typeof pasteMcpServerNoteItemSchema>;
export type PasteConnectionItem = z.infer<typeof pasteConnectionItemSchema>;
