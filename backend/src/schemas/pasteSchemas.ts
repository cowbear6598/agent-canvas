import { z } from "zod";
import {
  requestIdSchema,
  canvasIdSchema,
  coordinateSchema,
  createPasteNoteItemSchema,
  resourceIdSchema,
} from "./base.js";
import { anchorPositionSchema } from "./connectionSchemas.js";
import { providerSchema, providerConfigSchema } from "./podSchemas.js";

export const pastePodItemSchema = z.object({
  originalId: z.uuid(),
  name: z.string().min(1).max(100),
  x: coordinateSchema,
  y: coordinateSchema,
  rotation: z.number().finite().min(-360).max(360),
  /**
   * AI provider 名稱必須明確帶入 paste payload：
   * Zod 的 .strip() 行為會靜默丟棄未宣告欄位，前端型別曾因此導致 provider 身份遺失 bug。
   */
  provider: providerSchema.optional(),
  /**
   * provider 對應的設定（含 model 等參數）必須明確帶入 paste payload：
   * Zod strip 會靜默丟失未宣告欄位，前端型別若有變動會讓 model 資訊消失，曾真實發生 bug。
   */
  providerConfig: providerConfigSchema.optional(),
  subAgentIds: z.array(resourceIdSchema).optional(),
  pluginIds: z
    .array(
      z
        .string()
        .regex(/^[a-zA-Z0-9@._-]+$/)
        .max(100),
    )
    .optional(),
  repositoryId: resourceIdSchema.nullable().optional(),
  commandId: resourceIdSchema.nullable().optional(),
});

export const pasteRepositoryNoteItemSchema = createPasteNoteItemSchema({
  repositoryId: resourceIdSchema,
});

export const pasteSubAgentNoteItemSchema = createPasteNoteItemSchema({
  subAgentId: resourceIdSchema,
});

export const pasteCommandNoteItemSchema = createPasteNoteItemSchema({
  commandId: resourceIdSchema,
});

export const pasteMcpServerNoteItemSchema = createPasteNoteItemSchema({
  mcpServerId: resourceIdSchema,
});

export const pasteConnectionItemSchema = z.object({
  originalSourcePodId: z.uuid(),
  sourceAnchor: anchorPositionSchema,
  originalTargetPodId: z.uuid(),
  targetAnchor: anchorPositionSchema,
  triggerMode: z.enum(["auto", "ai-decide", "direct"]).optional(),
});

export const canvasPasteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  pods: z.array(pastePodItemSchema).max(100),
  repositoryNotes: z.array(pasteRepositoryNoteItemSchema).max(100),
  subAgentNotes: z.array(pasteSubAgentNoteItemSchema).max(100),
  commandNotes: z.array(pasteCommandNoteItemSchema).max(100).optional(),
  mcpServerNotes: z.array(pasteMcpServerNoteItemSchema).max(100).optional(),
  connections: z.array(pasteConnectionItemSchema).max(200).optional(),
});

export type PastePodItem = z.infer<typeof pastePodItemSchema>;
export type CanvasPastePayload = z.infer<typeof canvasPasteSchema>;
export type PasteRepositoryNoteItem = z.infer<
  typeof pasteRepositoryNoteItemSchema
>;
export type PasteSubAgentNoteItem = z.infer<typeof pasteSubAgentNoteItemSchema>;
export type PasteCommandNoteItem = z.infer<typeof pasteCommandNoteItemSchema>;
export type PasteMcpServerNoteItem = z.infer<
  typeof pasteMcpServerNoteItemSchema
>;
export type PasteConnectionItem = z.infer<typeof pasteConnectionItemSchema>;
