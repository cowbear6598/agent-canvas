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

export const chatSendSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
  message: z.union([
    z.string().min(1).max(MAX_MESSAGE_LENGTH),
    z.array(contentBlockSchema).min(1),
  ]),
});

export const chatHistorySchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});

export const chatAbortSchema = z.object({
  requestId: requestIdSchema,
  canvasId: canvasIdSchema,
  podId: podIdSchema,
});

export type ChatSendPayload = z.infer<typeof chatSendSchema>;
export type ChatHistoryPayload = z.infer<typeof chatHistorySchema>;
export type ChatAbortPayload = z.infer<typeof chatAbortSchema>;
