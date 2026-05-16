import { z } from "zod";
import {
  requestIdSchema,
  canvasIdSchema,
  coordinateSchema,
  createPasteNoteItemSchema,
  resourceIdSchema,
} from "./base.js";
import {
  anchorPositionSchema,
  labelSchema,
  descriptionSchema,
} from "./connectionSchemas.js";
import {
  providerSchema,
  providerConfigSchema,
  podGoalSchema,
} from "./podSchemas.js";

export const pastePodItemSchema = z
  .object({
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
    /** MCP server 名稱清單，每筆名稱只允許字母、數字、底線、點、連字號 */
    mcpServerNames: z
      .array(
        z
          .string()
          .min(1)
          .max(200)
          .regex(/^[a-zA-Z0-9_.][a-zA-Z0-9_.-]*$/),
      )
      .optional(),
    pluginIds: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z0-9@._-]+$/)
          .max(100),
      )
      .optional(),
    repositoryId: resourceIdSchema.nullable().optional(),
    goal: podGoalSchema.nullable().optional(),
  })
  .strict();

export const pasteRepositoryNoteItemSchema = createPasteNoteItemSchema({
  repositoryId: resourceIdSchema,
}).strict();

export const pasteConnectionItemSchema = z
  .object({
    originalSourcePodId: z.uuid(),
    sourceAnchor: anchorPositionSchema,
    originalTargetPodId: z.uuid(),
    targetAnchor: anchorPositionSchema,
    triggerMode: z.enum(["auto", "branch", "direct"]).optional(),
    /** paste 時保留 branch 連線的 label（若有） */
    label: labelSchema.optional(),
    /** paste 時保留 branch 連線的描述（若有） */
    description: descriptionSchema,
    /** paste 時保留 branch 連線的 provider（若有） */
    branchProvider: providerSchema.optional(),
    /** paste 時保留 branch 連線的模型（若有） */
    branchModel: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9._-]+$/, "branchModel 格式不合法")
      .optional(),
  })
  .strict();

export const canvasPasteSchema = z
  .object({
    requestId: requestIdSchema,
    canvasId: canvasIdSchema,
    pods: z.array(pastePodItemSchema).max(50),
    repositoryNotes: z.array(pasteRepositoryNoteItemSchema).max(50),
    connections: z.array(pasteConnectionItemSchema).max(100).optional(),
  })
  .strict();

export type PastePodItem = z.infer<typeof pastePodItemSchema>;
export type CanvasPastePayload = z.infer<typeof canvasPasteSchema>;
export type PasteRepositoryNoteItem = z.infer<
  typeof pasteRepositoryNoteItemSchema
>;
export type PasteConnectionItem = z.infer<typeof pasteConnectionItemSchema>;
