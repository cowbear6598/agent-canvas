import { z } from "zod";
import { gitRemoteUrlSchema } from "./gitRemoteUrlSchema.js";

export const backupTriggerSchema = z.object({
  requestId: z.string(),
  gitRemoteUrl: gitRemoteUrlSchema.optional(),
});

export const backupTestConnectionSchema = z.object({
  requestId: z.string(),
  gitRemoteUrl: gitRemoteUrlSchema,
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
