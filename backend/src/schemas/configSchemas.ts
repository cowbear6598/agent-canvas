import { z } from "zod";
import { modelTypeSchema } from "./podSchemas.js";

export const configGetSchema = z.object({
  requestId: z.string(),
});

export const configUpdateSchema = z
  .object({
    requestId: z.string(),
    summaryModel: modelTypeSchema.optional(),
    aiDecideModel: modelTypeSchema.optional(),
    enabledPluginIds: z
      .array(
        z
          .string()
          .regex(/^[a-zA-Z0-9@._-]+$/)
          .max(100),
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.summaryModel ||
      data.aiDecideModel ||
      data.enabledPluginIds !== undefined,
    {
      message: "至少需要提供一個設定值",
    },
  );

export type ConfigGetPayload = z.infer<typeof configGetSchema>;
export type ConfigUpdatePayload = z.infer<typeof configUpdateSchema>;

export interface ConfigGetResultPayload {
  requestId: string;
  success: boolean;
  summaryModel?: string;
  aiDecideModel?: string;
  enabledPluginIds?: string[];
  error?: string;
}

export interface ConfigUpdatedPayload {
  requestId: string;
  success: boolean;
  summaryModel?: string;
  aiDecideModel?: string;
  enabledPluginIds?: string[];
  error?: string;
}
