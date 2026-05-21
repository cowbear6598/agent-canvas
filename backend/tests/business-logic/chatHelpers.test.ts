/**
 * chatHelpers 單元測試
 *
 * Normal mode 移除後，原本的 injectUserMessage 已歸併到 injectRunUserMessage（run-only flow），
 * 此檔保留 extractDisplayContent 的純函式覆蓋。
 */

import { describe, expect, it } from "vitest";
import { extractDisplayContent } from "../../src/utils/runChatHelpers.js";
import type { ContentBlock } from "../../src/types/index.js";

describe("extractDisplayContent", () => {
  it("傳入 string 時直接回傳原始字串", () => {
    const result = extractDisplayContent("hello world");
    expect(result).toBe("hello world");
  });

  it("傳入含 text block 的 ContentBlock[] 時回傳合併文字", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "foo" },
      { type: "text", text: "bar" },
    ];
    const result = extractDisplayContent(blocks);
    expect(result).toBe("foobar");
  });

  it("傳入含 image block 的 ContentBlock[] 時 image 轉為 [image]", () => {
    const blocks: ContentBlock[] = [
      { type: "image", mediaType: "image/png", base64Data: "abc" },
    ];
    const result = extractDisplayContent(blocks);
    expect(result).toBe("[image]");
  });

  it("傳入混合 text + image 時正確組合", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "看這張圖：" },
      { type: "image", mediaType: "image/png", base64Data: "abc" },
      { type: "text", text: "這是說明" },
    ];
    const result = extractDisplayContent(blocks);
    expect(result).toBe("看這張圖：[image]這是說明");
  });
});
