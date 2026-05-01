import { z } from "zod";
import { requestIdSchema, podIdSchema, canvasIdSchema } from "./base.js";
import { modelTypeSchema, providerSchema } from "./podSchemas.js";

export const anchorPositionSchema = z.enum(["top", "bottom", "left", "right"]);

// summaryModel 接受合法模型名稱字串，允許 Codex 模型名稱（如 "gpt-5.4"）等非 Claude enum 值。
// 格式規則與 codexProvider/codexService 的 MODEL_RE 一致：僅允許英數字、點、底線、連字符。
// 長度上限 200 字元，防止超長字串攻擊。
const summaryModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9._-]+$/, "summaryModel 格式不合法");

export const connectionCreateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  sourcePodId: podIdSchema,
  sourceAnchor: anchorPositionSchema,
  targetPodId: podIdSchema,
  targetAnchor: anchorPositionSchema,
  summaryModel: summaryModelSchema.optional(),
  /** summaryProvider 可選；未提供時由服務層依 sourcePod.provider 決定預設值 */
  summaryProvider: providerSchema.optional(),
  aiDecideModel: modelTypeSchema.optional(),
});

export const connectionListSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
});

export const connectionDeleteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  connectionId: z.uuid(),
});

export const connectionUpdateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  connectionId: z.uuid(),
  triggerMode: z.enum(["auto", "ai-decide", "direct"]).optional(),
  summaryModel: summaryModelSchema.optional(),
  /** summaryProvider 可選；未提供時保留既有值（或 fallback 至 sourcePod.provider） */
  summaryProvider: providerSchema.optional(),
  aiDecideModel: modelTypeSchema.optional(),
});

export type ConnectionCreatePayload = z.infer<typeof connectionCreateSchema>;
export type ConnectionListPayload = z.infer<typeof connectionListSchema>;
export type ConnectionDeletePayload = z.infer<typeof connectionDeleteSchema>;
export type ConnectionUpdatePayload = z.infer<typeof connectionUpdateSchema>;
