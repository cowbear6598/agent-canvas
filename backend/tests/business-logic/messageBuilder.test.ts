import { describe, it, expect } from "vitest";
import { buildClaudeContentBlocks } from "../../src/services/claude/messageBuilder.js";
import type { ContentBlock } from "../../src/types/index.js";

function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

function imageBlock(
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  base64Data: string,
): ContentBlock {
  return { type: "image", mediaType, base64Data };
}

describe("buildClaudeContentBlocks", () => {
  it("純文字 block 應直接轉成 Claude text content", () => {
    const blocks: ContentBlock[] = [textBlock("hello")];

    const result = buildClaudeContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "hello" });
  });

  it("純圖片 block 應轉成 Claude image content", () => {
    const blocks: ContentBlock[] = [imageBlock("image/png", "abc123")];

    const result = buildClaudeContentBlocks(blocks);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "abc123",
      },
    });
  });

  it("text + image 混合 blocks 應依序轉成對應 content", () => {
    const blocks: ContentBlock[] = [
      textBlock("說明文字"),
      imageBlock("image/jpeg", "imgdata"),
    ];

    const result = buildClaudeContentBlocks(blocks);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "text", text: "說明文字" });
    expect(result[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "imgdata",
      },
    });
  });

  it("空陣列時應 fallback 回傳「請開始執行」text content", () => {
    const result = buildClaudeContentBlocks([]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "請開始執行" });
  });
});
