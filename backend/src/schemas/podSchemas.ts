import { z } from "zod";
import {
  requestIdSchema,
  podIdSchema,
  canvasIdSchema,
  coordinateSchema,
} from "./base.js";
import { scheduleConfigSchema } from "./scheduleSchemas.js";

export const modelTypeSchema = z.enum(["opus", "sonnet", "haiku"]);

/**
 * provider 允許清單（白名單守門）：
 * 明確列舉避免未知 provider 進入業務邏輯，同時作為 DB 意外寫入時由 resolveProvider fallback 的依據。
 */
export const providerSchema = z.enum(["claude", "codex", "gemini"]);

/** model 名稱 regex 與最大長度，同時套用於 providerConfigSchema 與 podSetModelSchema */
const MODEL_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MAX_MODEL_LENGTH = 100;

/**
 * provider 設定物件（.strict() 阻止多餘欄位靜默通過）：
 * 阻止 DB 舊格式 {provider, model} 或前端型別變動引入多餘欄位，曾真實發生 bug。
 */
export const providerConfigSchema = z
  .object({
    /** model 名稱，僅允許字母、數字、點、底線、連字號，最長 100 字元 */
    model: z
      .string()
      .regex(MODEL_PATTERN, "model 名稱包含不允許的字元")
      .max(MAX_MODEL_LENGTH)
      .optional(),
  })
  .strict();

export const podCreateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  name: z.string().min(1).max(100),
  x: coordinateSchema,
  y: coordinateSchema,
  rotation: z.number().finite().min(-360).max(360),
  /** AI provider 名稱，預設為 claude，未提供時由服務層補預設值 */
  provider: providerSchema.optional(),
  /** provider 的設定物件，僅允許已知欄位（.strict() 拒絕未知 key） */
  providerConfig: providerConfigSchema.optional(),
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
  /** pod:set-model 可能傳 Claude 短名（opus/sonnet/haiku）或 Codex 完整名（gpt-5.4 等），使用與 providerConfig.model 同規則的 regex */
  model: z
    .string()
    .regex(MODEL_PATTERN, "model 名稱包含不允許的字元")
    .max(MAX_MODEL_LENGTH),
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
export type PodSetPluginsPayload = z.infer<typeof podSetPluginsSchema>;
