import { z } from "zod";
import { requestIdSchema } from "./base.js";

const opencodeProviderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "providerID 格式不正確");

const opencodeModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/, "modelID 格式不正確");

const opencodeAliasNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\p{C}]+$/u, "alias 不可包含控制字元");

// ─── opencode:aliases:list ────────────────────────────────────────────────────

/** opencode:aliases:list 請求 payload schema（空 payload，只帶 requestId） */
export const opencodeAliasesListSchema = z.object({
  requestId: requestIdSchema,
});

export type OpencodeAliasesListPayload = z.infer<
  typeof opencodeAliasesListSchema
>;

/** 單筆 alias item */
export const aliasItemSchema = z.object({
  id: z.string(),
  providerID: z.string(),
  modelID: z.string(),
  alias: z.string(),
  orderIdx: z.number().int(),
  thinkingLevels: z.array(z.string()),
  thinkingLevelLabels: z.record(z.string(), z.string()).optional(),
  defaultThinkingLevel: z.string().nullable(),
  thinkingMetadataFetchedAt: z.number().nullable(),
});

export type AliasItem = z.infer<typeof aliasItemSchema>;

export type OpencodeAliasesListResultPayload =
  | { requestId: string; success: true; items: AliasItem[] }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

// ─── opencode:aliases:create ──────────────────────────────────────────────────

/** opencode:aliases:create 請求 payload schema */
export const opencodeAliasesCreateSchema = z.object({
  requestId: requestIdSchema,
  providerID: opencodeProviderIdSchema,
  modelID: opencodeModelIdSchema,
  alias: opencodeAliasNameSchema,
});

export type OpencodeAliasesCreatePayload = z.infer<
  typeof opencodeAliasesCreateSchema
>;

export type OpencodeAliasesCreateResultPayload =
  | { requestId: string; success: true; item: AliasItem }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

// ─── opencode:aliases:update ──────────────────────────────────────────────────

/**
 * opencode:aliases:update 請求 payload schema：
 * 編輯流程改 alias 別稱與 modelID 對應；order_idx 由獨立的 reorder API 處理，不在此 schema 內。
 */
export const opencodeAliasesUpdateSchema = z.object({
  requestId: requestIdSchema,
  id: z.string().min(1),
  modelID: opencodeModelIdSchema,
  alias: opencodeAliasNameSchema,
});

export type OpencodeAliasesUpdatePayload = z.infer<
  typeof opencodeAliasesUpdateSchema
>;

export type OpencodeAliasesUpdateResultPayload =
  | { requestId: string; success: true; item: AliasItem }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

// ─── opencode:aliases:delete ──────────────────────────────────────────────────

/** opencode:aliases:delete 請求 payload schema */
export const opencodeAliasesDeleteSchema = z.object({
  requestId: requestIdSchema,
  id: z.string().min(1),
});

export type OpencodeAliasesDeletePayload = z.infer<
  typeof opencodeAliasesDeleteSchema
>;

export type OpencodeAliasesDeleteResultPayload =
  | { requestId: string; success: true; id: string }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

// ─── opencode:aliases:reorder ─────────────────────────────────────────────────

/** opencode:aliases:reorder 請求 payload schema */
export const opencodeAliasesReorderSchema = z.object({
  requestId: requestIdSchema,
  orderedIds: z
    .array(z.string().min(1))
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "orderedIds 不可有重複 id",
    }),
});

export type OpencodeAliasesReorderPayload = z.infer<
  typeof opencodeAliasesReorderSchema
>;

export type OpencodeAliasesReorderResultPayload =
  | { requestId: string; success: true; items: AliasItem[] }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

// ─── opencode:aliases:refresh-presets ────────────────────────────────────────

/** opencode:aliases:refresh-presets 請求 payload schema */
export const opencodeAliasesRefreshPresetsSchema = z.object({
  requestId: requestIdSchema,
  id: z.string().min(1),
});

export type OpencodeAliasesRefreshPresetsPayload = z.infer<
  typeof opencodeAliasesRefreshPresetsSchema
>;

export type OpencodeAliasesRefreshPresetsResultPayload =
  | { requestId: string; success: true; item: AliasItem }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

// ─── opencode:server:restart ──────────────────────────────────────────────────

/** opencode:server:restart 請求 payload schema（空 payload，只帶 requestId） */
export const opencodeServerRestartSchema = z.object({
  requestId: requestIdSchema,
});

export type OpencodeServerRestartPayload = z.infer<
  typeof opencodeServerRestartSchema
>;

export type OpencodeServerRestartResultPayload =
  | { requestId: string; success: true }
  | {
      requestId: string;
      success: false;
      error: { code: string; message: string };
    };

/** opencode:provider:list 請求 payload schema（空 payload，只帶 requestId） */
export const opencodeProviderListSchema = z.object({
  requestId: requestIdSchema,
});

export type OpencodeProviderListPayload = z.infer<
  typeof opencodeProviderListSchema
>;

/**
 * opencode:provider:list:result 回應 payload
 *
 * success=true 時帶回 all / default / connected；
 * success=false 時帶回 error.code 與 error.message。
 */
export type OpencodeProviderListResultPayload =
  | {
      requestId: string;
      success: true;
      all: unknown[];
      default: Record<string, string>;
      connected: string[];
    }
  | {
      requestId: string;
      success: false;
      error: {
        code: string;
        message: string;
      };
    };
