import { z } from "zod";
import { requestIdSchema } from "./base.js";

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
});

export type AliasItem = z.infer<typeof aliasItemSchema>;

export type OpencodeAliasesListResultPayload =
  | { requestId: string; ok: true; items: AliasItem[] }
  | { requestId: string; ok: false; error: { code: string; message: string } };

// ─── opencode:aliases:create ──────────────────────────────────────────────────

/** opencode:aliases:create 請求 payload schema */
export const opencodeAliasesCreateSchema = z.object({
  requestId: requestIdSchema,
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  alias: z.string().min(1),
});

export type OpencodeAliasesCreatePayload = z.infer<
  typeof opencodeAliasesCreateSchema
>;

export type OpencodeAliasesCreateResultPayload =
  | { requestId: string; ok: true; item: AliasItem }
  | { requestId: string; ok: false; error: { code: string; message: string } };

// ─── opencode:aliases:update ──────────────────────────────────────────────────

/**
 * opencode:aliases:update 請求 payload schema：
 * 編輯流程改 alias 別稱與 modelID 對應；order_idx 由獨立的 reorder API 處理，不在此 schema 內。
 */
export const opencodeAliasesUpdateSchema = z.object({
  requestId: requestIdSchema,
  id: z.string().min(1),
  modelID: z.string().min(1),
  alias: z.string().min(1),
});

export type OpencodeAliasesUpdatePayload = z.infer<
  typeof opencodeAliasesUpdateSchema
>;

export type OpencodeAliasesUpdateResultPayload =
  | { requestId: string; ok: true; item: AliasItem }
  | { requestId: string; ok: false; error: { code: string; message: string } };

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
  | { requestId: string; ok: true; id: string }
  | { requestId: string; ok: false; error: { code: string; message: string } };

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
  | { requestId: string; ok: true }
  | { requestId: string; ok: false; error: { code: string; message: string } };

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
 * ok=true 時帶回 all / default / connected；
 * ok=false 時帶回 error.code 與 error.message。
 */
export type OpencodeProviderListResultPayload =
  | {
      requestId: string;
      ok: true;
      all: unknown[];
      default: Record<string, string>;
      connected: string[];
    }
  | {
      requestId: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };
