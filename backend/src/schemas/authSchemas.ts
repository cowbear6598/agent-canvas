import { z } from "zod";

const nonEmptyPasswordSchema = z.string().trim().min(1, "Password is required");

export const authBootstrapSchema = z.object({
  requestId: z.string(),
});

export const authUnlockWorkspaceSchema = z.object({
  requestId: z.string(),
  password: nonEmptyPasswordSchema,
});

export const authUnlockCanvasSchema = z.object({
  requestId: z.string(),
  canvasId: z.uuid("Invalid canvas ID format"),
  password: nonEmptyPasswordSchema,
});

export const passwordUpdateActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    newPassword: nonEmptyPasswordSchema,
  }),
  z.object({
    action: z.literal("change"),
    currentPassword: nonEmptyPasswordSchema,
    newPassword: nonEmptyPasswordSchema,
  }),
  z.object({
    action: z.literal("remove"),
    currentPassword: nonEmptyPasswordSchema,
  }),
]);

export const authUpdateWorkspacePasswordSchema = z.object({
  requestId: z.string(),
  passwordUpdate: passwordUpdateActionSchema,
});

export const canvasSecurityUpdateSchema = z.object({
  requestId: z.string(),
  canvasId: z.uuid("Invalid canvas ID format"),
  passwordUpdate: passwordUpdateActionSchema,
});

export type AuthBootstrapPayload = z.infer<typeof authBootstrapSchema>;
export type AuthUnlockWorkspacePayload = z.infer<
  typeof authUnlockWorkspaceSchema
>;
export type AuthUnlockCanvasPayload = z.infer<typeof authUnlockCanvasSchema>;
export type PasswordUpdateActionPayload = z.infer<
  typeof passwordUpdateActionSchema
>;
export type AuthUpdateWorkspacePasswordPayload = z.infer<
  typeof authUpdateWorkspacePasswordSchema
>;
export type CanvasSecurityUpdatePayload = z.infer<
  typeof canvasSecurityUpdateSchema
>;

export interface AuthBootstrapResultPayload {
  requestId: string;
  success: boolean;
  hasWorkspacePassword?: boolean;
  workspaceUnlocked?: boolean;
  unlockedCanvasIds?: string[];
  transportSecurity?: {
    isTls: boolean;
    showInsecureTransportWarning: boolean;
    isLanHost: boolean;
  };
  error?: string;
}

export interface AuthUnlockWorkspaceResultPayload {
  requestId: string;
  success: boolean;
  reconnectGrant?: string;
  error?: string;
}

export interface AuthUnlockCanvasResultPayload {
  requestId: string;
  success: boolean;
  canvasId?: string;
  unlockedCanvasIds?: string[];
  error?: string;
}

export interface AuthSessionResetPayload {
  reason: string;
}

export interface AuthCanvasAccessResetPayload {
  canvasId: string;
  reason: string;
}

export interface WorkspacePasswordUpdatedPayload {
  requestId: string;
  success: boolean;
  hasWorkspacePassword?: boolean;
  error?: string;
}
