import { z } from "zod";
import { requestIdSchema, podIdSchema, canvasIdSchema } from "./base.js";
import { providerSchema } from "./podSchemas.js";

export const anchorPositionSchema = z.enum(["top", "bottom", "left", "right"]);

// summaryModel 接受合法模型名稱字串，允許 Codex 模型名稱（如 "gpt-5.6-luna"）
// 與 OpenCode alias model value（如 "openai/gpt-4o"）。
// 長度上限 200 字元，防止超長字串攻擊。
const summaryModelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9._/-]+$/, "summaryModel 格式不合法");

const thinkingLevelSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9._/-]+$/, "thinkingLevel 格式不合法");

const nullableThinkingLevelSchema = thinkingLevelSchema.nullable();

/** label 最大長度 32，與前端常數 BRANCH_LABEL_MAX_LENGTH 對齊。
 * 禁止換行符（\n、\r）與角括號（<、>），於入口層攔截可疑字元以防 prompt injection。
 */
export const labelSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[^\n\r<>]+$/, "label 不可包含換行符或角括號（< >）");

/** description 最大長度 200，與前端常數 BRANCH_DESCRIPTION_MAX_LENGTH 對齊；選填 */
export const descriptionSchema = z.string().max(200).optional();

const legacyTriggerModeSchema = z.enum(["auto", "branch", "direct"]);

function normalizeLegacyDirectToggle<T extends {
  triggerMode?: "auto" | "branch" | "direct";
  direct?: boolean;
}>(data: T): Omit<T, "triggerMode"> & {
  triggerMode?: "auto" | "branch";
  direct?: boolean;
} {
  if (data.triggerMode !== "direct") {
    return data as Omit<T, "triggerMode"> & {
      triggerMode?: "auto" | "branch";
      direct?: boolean;
    };
  }

  return {
    ...data,
    triggerMode: "auto",
    direct: data.direct ?? true,
  } as Omit<T, "triggerMode"> & {
    triggerMode?: "auto" | "branch";
    direct?: boolean;
  };
}

export const connectionCreateSchema = z
  .object({
    requestId: requestIdSchema,
    canvasId: canvasIdSchema,
    sourcePodId: podIdSchema,
    sourceAnchor: anchorPositionSchema,
    targetPodId: podIdSchema,
    targetAnchor: anchorPositionSchema,
    summaryModel: summaryModelSchema.optional(),
    summaryThinkingLevel: nullableThinkingLevelSchema.optional(),
    /** summaryProvider 可選；未提供時由服務層依 sourcePod.provider 決定預設值 */
    summaryProvider: providerSchema.optional(),
    /**
     * label 為此連線在 branch 決策中的辨識名稱，不可為 "None"。
     * 建立時為 optional：新連線預設 triggerMode === "auto"，使用者切換到 branch 後才補上 label。
     */
    label: labelSchema.optional(),
    description: descriptionSchema,
    direct: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.label !== undefined && data.label.toLowerCase() === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'label 不可為系統保留字 "None"',
        path: ["label"],
      });
    }
  })
  .transform(normalizeLegacyDirectToggle);

export const connectionListSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
});

export const connectionDeleteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  connectionId: z.uuid(),
});

export const connectionUpdateSchema = z
  .object({
    requestId: requestIdSchema,
    canvasId: canvasIdSchema,
    connectionId: z.uuid(),
    triggerMode: legacyTriggerModeSchema.optional(),
    summaryModel: summaryModelSchema.optional(),
    summaryThinkingLevel: nullableThinkingLevelSchema.optional(),
    /** summaryProvider 可選；未提供時保留既有值（或 fallback 至 sourcePod.provider） */
    summaryProvider: providerSchema.optional(),
    label: labelSchema.optional(),
    description: descriptionSchema,
    direct: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.label !== undefined && data.label.toLowerCase() === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'label 不可為系統保留字 "None"',
        path: ["label"],
      });
    }
  })
  .transform(normalizeLegacyDirectToggle);

export type ConnectionCreatePayload = z.infer<typeof connectionCreateSchema>;
export type ConnectionListPayload = z.infer<typeof connectionListSchema>;
export type ConnectionDeletePayload = z.infer<typeof connectionDeleteSchema>;
export type ConnectionUpdatePayload = z.infer<typeof connectionUpdateSchema>;
