import { z } from "zod";

const gitRemoteUrlRegex = /^(git@|https?:\/\/)/;

export const backupTriggerSchema = z.object({
  requestId: z.string(),
  gitRemoteUrl: z
    .string()
    .regex(gitRemoteUrlRegex, "URL 必須以 git@、https:// 或 http:// 開頭")
    .optional(),
});

export const backupTestConnectionSchema = z.object({
  requestId: z.string(),
  gitRemoteUrl: z
    .string()
    .regex(gitRemoteUrlRegex, "URL 必須以 git@、https:// 或 http:// 開頭"),
});

export type BackupTriggerPayload = z.infer<typeof backupTriggerSchema>;
export type BackupTestConnectionPayload = z.infer<
  typeof backupTestConnectionSchema
>;

export interface BackupTriggerResultPayload {
  requestId: string;
  success: boolean;
  error?: string;
}

export interface BackupStartedPayload {
  timestamp: string;
}

export interface BackupCompletedPayload {
  timestamp: string;
}

export interface BackupFailedPayload {
  error: string;
  timestamp: string;
}

export interface BackupTestConnectionResultPayload {
  requestId: string;
  success: boolean;
  error?: string;
}
