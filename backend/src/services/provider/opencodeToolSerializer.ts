/**
 * v2 tool success content 項目的聯合型別（對應 SDK ToolTextContent | ToolFileContent）。
 */
type V2ToolContentItem =
  | { type: "text"; text: string }
  | { type: "file"; uri: string; mime: string; name?: string };

/**
 * 將 v2 tool success 的 content 陣列序列化成可寫入 transcript 的字串。
 *
 * 規則：
 * - "text" 項目：直接取 .text 內容，多筆以 "\n" 串接
 * - "file" 項目：格式化成 "[file: <name|uri> (<mime>)]"
 * - 陣列為空：回傳空字串
 *
 * 目的是讓 tool_call_result 的 output 欄位統一為字串，
 * 可直接寫入既有的 transcript stream（NormalizedEvent.tool_call_result.output）。
 */
export function serializeV2ToolSuccessContent(
  content: ReadonlyArray<V2ToolContentItem>,
): string {
  if (content.length === 0) return "";

  return content
    .map((item) => {
      if (item.type === "text") return item.text;
      const label = item.name ?? item.uri;
      return `[file: ${label} (${item.mime})]`;
    })
    .join("\n");
}

/**
 * 將 v2 tool failure 的 error 物件序列化成可寫入 transcript 的字串。
 *
 * 規則：
 * - error.message 存在時使用 "[Error] <message>"
 * - 其他情況 fallback 到 "[Error] tool failed"
 */
export function serializeV2ToolFailureError(error: unknown): string {
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.length > 0) {
      return `[Error] ${obj.message}`;
    }
  }
  if (typeof error === "string" && error.length > 0) {
    return `[Error] ${error}`;
  }
  return "[Error] tool failed";
}
