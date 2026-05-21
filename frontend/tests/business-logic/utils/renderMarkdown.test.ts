import { describe, it, expect } from "vitest";
import { renderMarkdown } from "@/utils/renderMarkdown";

describe("renderMarkdown", () => {
  it("應該將 Markdown 標題轉換為 HTML", async () => {
    const result = await renderMarkdown("# 一級標題");
    expect(result).toContain("<h1>");
    expect(result).toContain("一級標題");
  });

  it("應該將 Markdown 程式碼區塊轉換為 HTML", async () => {
    const result = await renderMarkdown('```\nconsole.log("hello")\n```');
    expect(result).toContain("<pre>");
    expect(result).toContain("<code>");
  });

  it("應該將 Markdown 列表轉換為 HTML", async () => {
    const result = await renderMarkdown("- 項目一\n- 項目二");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
    expect(result).toContain("項目一");
    expect(result).toContain("項目二");
  });

  it("應該將一般文字轉換為 HTML 段落", async () => {
    const result = await renderMarkdown("普通文字段落");
    expect(result).toContain("普通文字段落");
  });

  it("應該移除危險的 script 標籤（XSS 防護）", async () => {
    const result = await renderMarkdown('<script>alert("xss")<\/script>');
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("應該移除 img 標籤（含惡意事件屬性）", async () => {
    const result = await renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert(1)");
  });

  it("應該在輸入為空字串時回傳空字串", async () => {
    expect(await renderMarkdown("")).toBe("");
  });

  it("應該在輸入為 undefined 時回傳空字串", async () => {
    expect(await renderMarkdown(undefined)).toBe("");
  });

  it("應該在輸入為純空白時回傳空字串", async () => {
    expect(await renderMarkdown("   ")).toBe("");
  });

  it("應該正確渲染粗體", async () => {
    const result = await renderMarkdown("**粗體**");
    expect(result).toContain("<strong>粗體</strong>");
  });

  it("應該正確渲染行內程式碼", async () => {
    const result = await renderMarkdown("`code`");
    expect(result).toContain("<code>code</code>");
  });

  it('應該為連結加上 target="_blank" 和 rel="noopener noreferrer"', async () => {
    const result = await renderMarkdown("[連結](https://example.com)");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("應該禁止 javascript: URI scheme", async () => {
    const result = await renderMarkdown("[惡意連結](javascript:alert(1))");
    expect(result).not.toContain("javascript:");
  });

  it("應該禁止 style 屬性", async () => {
    const result = await renderMarkdown('<div style="color:red">文字</div>');
    expect(result).not.toContain("style=");
  });

  it("應該保留允許的 HTML 標籤", async () => {
    const result = await renderMarkdown("**粗體** *斜體* ~~刪除線~~");
    expect(result).toContain("<strong>");
    expect(result).toContain("<em>");
    expect(result).toContain("<del>");
  });

  // XSS 攻擊向量
  it("應禁止 data: URI scheme", async () => {
    const result = await renderMarkdown(
      "[link](data:text/html,<script>alert(1)</script>)",
    );
    expect(result).not.toContain("data:");
  });

  it("應移除 onload 事件屬性", async () => {
    const result = await renderMarkdown('<img src="x" onload="alert(1)">');
    expect(result).not.toContain("onload");
  });

  it("應禁止 SVG onload XSS", async () => {
    const result = await renderMarkdown('<svg onload="alert(1)"></svg>');
    expect(result).not.toContain("onload");
    expect(result).not.toContain("<svg");
  });

  it("應移除巢狀 script 標籤攻擊", async () => {
    const result = await renderMarkdown("<scr<script>ipt>alert(1)</script>");
    expect(result).not.toContain("<script");
  });

  it("應移除 HTML entity 編碼的 javascript:", async () => {
    const result = await renderMarkdown(
      '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">click</a>',
    );
    expect(result).not.toContain("javascript:");
  });

  // 功能行為
  it("應允許 mailto: scheme", async () => {
    const result = await renderMarkdown("[email](mailto:test@example.com)");
    expect(result).toContain("mailto:");
  });

  it("應允許 tel: scheme", async () => {
    const result = await renderMarkdown("[call](tel:+886912345678)");
    expect(result).toContain("tel:");
  });

  it("應渲染有序列表", async () => {
    const result = await renderMarkdown("1. 第一項\n2. 第二項");
    expect(result).toContain("<ol>");
    expect(result).toContain("<li>");
  });

  it("應渲染表格", async () => {
    const result = await renderMarkdown("| 標題 |\n| --- |\n| 內容 |");
    expect(result).toContain("<table>");
  });

  it("應渲染區塊引用", async () => {
    const result = await renderMarkdown("> 引用文字");
    expect(result).toContain("<blockquote>");
  });

  it("應渲染水平線", async () => {
    const result = await renderMarkdown("---");
    expect(result).toContain("<hr");
  });

  it("應移除 img 標籤（防止 tracking pixel）", async () => {
    const result = await renderMarkdown(
      "![alt](https://evil.com/tracking.png)",
    );
    expect(result).not.toContain("<img");
    expect(result).not.toContain("tracking.png");
  });
});
