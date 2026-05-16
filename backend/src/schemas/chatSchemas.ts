import { z } from "zod";
import { requestIdSchema, podIdSchema, canvasIdSchema } from "./base.js";

export const MAX_MESSAGE_LENGTH = 10000;

/** 純文字內容區塊：type="text" + text 字串 */
export const TextContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

/** 圖片內容區塊：type="image" + mediaType 白名單 + base64Data */
export const ImageContentBlockSchema = z
  .object({
    type: z.literal("image"),
    mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
    base64Data: z
      .string()
      .regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64Data 包含非法字元"),
  })
  .refine(
    (data) => {
      const base64Length = data.base64Data.length;
      const decodedSize = (base64Length * 3) / 4;
      const maxSize = 5 * 1024 * 1024;
      return decodedSize <= maxSize;
    },
    {
      message: "圖片大小不得超過 5MB",
    },
  );

/** ContentBlock union：text | image（帶 runtime 驗證） */
export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextContentBlockSchema,
  ImageContentBlockSchema,
]);

/** 向下相容別名，供現有程式碼繼續使用 */
export const contentBlockSchema = ContentBlockSchema;

/**
 * WS `chat:send` 訊息驗證 schema。
 *
 * 雙階段附件流程：
 * - 第一階段（HTTP）：前端先呼叫 `POST /api/upload` 取得 uploadSessionId，
 *   並將檔案寫入 staging 目錄。
 * - 第二階段（WS）：發送 `chat:send` 時帶入 uploadSessionId，
 *   handler 呼叫 `promoteStagingToFinal` 以 atomic rename 將 staging
 *   搬移至正式附件目錄，再執行訊息處理。
 *
 * 無 uploadSessionId 時，純文字 message 不得為空白（superRefine 保證）。
 */
export const chatSendSchema = z
  .object({
    requestId: requestIdSchema,
    canvasId: canvasIdSchema,
    podId: podIdSchema,
    message: z.union([
      // 允許空字串，讓拖檔流程（uploadSessionId 存在）能通過 schema；
      // 無 uploadSessionId 時的空字串檢查交由下方 superRefine 處理
      z.string().max(MAX_MESSAGE_LENGTH),
      z.array(contentBlockSchema).min(1),
    ]),
    /** 拖檔流程上傳 session ID，使用 UUID v4 格式；存在時允許 message 為空字串 */
    uploadSessionId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    // 無 uploadSessionId 時，純文字 message 不得為空白
    if (
      typeof data.message === "string" &&
      data.message.trim().length === 0 &&
      !data.uploadSessionId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Too small: expected string to have >=1 characters",
        path: ["message"],
      });
    }
  });

export const chatAbortSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});

export type ChatSendPayload = z.infer<typeof chatSendSchema>;
export type ChatAbortPayload = z.infer<typeof chatAbortSchema>;
