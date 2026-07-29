import { z } from "zod";
import type { ProviderName } from "../services/provider/types.js";
import { gitRemoteUrlSchema } from "./gitRemoteUrlSchema.js";
import { providerSchema } from "./podSchemas.js";

const modelRegex = /^[a-zA-Z0-9._/-]+$/;
const thinkingLevelRegex = /^[a-zA-Z0-9._/-]+$/;

export const configGetSchema = z.object({
  requestId: z.string(),
});

export const configUpdateSchema = z
  .object({
    requestId: z.string(),
    timezoneOffset: z.number().int().min(-12).max(14).optional(),
    backupGitRemoteUrl: gitRemoteUrlSchema.or(z.literal("")).optional(),
    backupTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .refine((v) => {
        const [hh, mm] = v.split(":").map(Number);
        return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
      }, "備份時間格式不正確：時必須在 0-23 之間，分必須在 0-59 之間")
      .optional(),
    backupEnabled: z.boolean().optional(),
    memoryProvider: providerSchema.optional(),
    memoryModel: z
      .string()
      .regex(modelRegex, "memory model 名稱包含不允許的字元")
      .max(100)
      .optional(),
    memoryThinkingLevel: z
      .string()
      .regex(
        thinkingLevelRegex,
        "memory thinking level 包含不允許的字元",
      )
      .max(20)
      .nullable()
      .optional(),
    connectionLineProvider: providerSchema.optional(),
    connectionLineModel: z
      .string()
      .regex(modelRegex, "connection line model 名稱包含不允許的字元")
      .max(100)
      .optional(),
    connectionLineThinkingLevel: z
      .string()
      .regex(
        thinkingLevelRegex,
        "connection line thinking level 包含不允許的字元",
      )
      .max(20)
      .nullable()
      .optional(),
  })
  .refine(
    (data) =>
      data.timezoneOffset !== undefined ||
      data.backupGitRemoteUrl !== undefined ||
      data.backupTime !== undefined ||
      data.backupEnabled !== undefined ||
      data.memoryProvider !== undefined ||
      data.memoryModel !== undefined ||
      data.memoryThinkingLevel !== undefined ||
      data.connectionLineProvider !== undefined ||
      data.connectionLineModel !== undefined ||
      data.connectionLineThinkingLevel !== undefined,
    {
      message: "至少需要提供一個設定值",
    },
  );

export type ConfigGetPayload = z.infer<typeof configGetSchema>;
export type ConfigUpdatePayload = z.infer<typeof configUpdateSchema>;

export interface ConfigGetResultPayload {
  requestId: string;
  success: boolean;
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
  memoryProvider?: ProviderName;
  memoryModel?: string;
  memoryThinkingLevel?: string | null;
  connectionLineProvider?: ProviderName;
  connectionLineModel?: string;
  connectionLineThinkingLevel?: string | null;
  hasWorkspacePassword?: boolean;
  transportSecurity?: {
    isTls: boolean;
    showInsecureTransportWarning: boolean;
    isLanHost: boolean;
  };
  error?: string;
}

export interface ConfigUpdatedPayload {
  requestId: string;
  success: boolean;
  timezoneOffset?: number;
  backupGitRemoteUrl?: string;
  backupTime?: string;
  backupEnabled?: boolean;
  memoryProvider?: ProviderName;
  memoryModel?: string;
  memoryThinkingLevel?: string | null;
  connectionLineProvider?: ProviderName;
  connectionLineModel?: string;
  connectionLineThinkingLevel?: string | null;
  hasWorkspacePassword?: boolean;
  error?: string;
}
