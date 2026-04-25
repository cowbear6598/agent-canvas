import { z } from "zod";
import { requestIdSchema, canvasIdSchema } from "./base.js";

const pathSegmentRegex = /^[a-zA-Z0-9-]+$/;

export const groupCreateSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  name: z
    .string()
    .min(1, "群組名稱不能為空")
    .max(100, "群組名稱不能超過100字元")
    .regex(pathSegmentRegex, "群組名稱格式不正確，只能包含英文、數字、dash"),
  type: z.enum(["command", "subagent"]),
});

export const groupListSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  type: z.enum(["command", "subagent"]),
});

export const groupDeleteSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  groupId: z
    .string()
    .regex(pathSegmentRegex, "群組 ID 格式不正確，只能包含英文、數字、dash"),
});

export type GroupCreatePayload = z.infer<typeof groupCreateSchema>;
export type GroupListPayload = z.infer<typeof groupListSchema>;
export type GroupDeletePayload = z.infer<typeof groupDeleteSchema>;
