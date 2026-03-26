import { z } from "zod";
import { modelTypeSchema } from "./podSchemas.js";

const gitRemoteUrlRegex = /^(git@|https?:\/\/)/;

export const configGetSchema = z.object({
  requestId: z.string(),
});

export const configUpdateSchema = z
  .object({
    requestId: z.string(),
    summaryModel: modelTypeSchema.optional(),
    aiDecideModel: modelTypeSchema.optional(),
    timezoneOffset: z.number().int().min(-12).max(14).optional(),
    backupGitRemoteUrl: z
      .string()
      .refine(
        (v) => v === "" || gitRemoteUrlRegex.test(v),
        "URL 必須以 git@、https:// 或 http:// 開頭",
      )
      .optional(),
    backupTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .refine((v) => {
        const [hh, mm] = v.split(":").map(Number);
        return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
      }, "備份時間格式不正確：時必須在 0-23 之間，分必須在 0-59 之間")
      .optional(),
    backupEnabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.summaryModel ||
      data.aiDecideModel ||
      data.timezoneOffset !== undefined ||
      data.backupGitRemoteUrl !== undefined ||
      data.backupTime !== undefined ||
      data.backupEnabled !== undefined,
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
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
  error?: string;
}

export interface ConfigUpdatedPayload {
  requestId: string;
  success: boolean;
  summaryModel?: string;
  aiDecideModel?: string;
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
  error?: string;
}
