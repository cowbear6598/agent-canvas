export function sanitizeForPrompt(input: string): string {
  return (
    input
      // 統一換行符為 \n，防止 \r\n 變體繞過後續角色注入防護
      .replace(/\r/g, "")
      // 替換 HTML 角括號，防止 XML/HTML 標籤注入
      .replace(/</g, "＜")
      .replace(/>/g, "＞")
      // 替換 \n\nHuman: 前綴（含大小寫變體），防止對話角色注入攻擊
      .replace(/\n\nhuman:/gi, "\n\n[blocked: Human]")
      // 替換 \n\nAssistant: 前綴（含大小寫變體），防止偽造 Assistant 回應
      .replace(/\n\nassistant:/gi, "\n\n[blocked: Assistant]")
      // 壓縮連續 3 個以上的換行符為最多 2 個，防止透過大量換行繞過 system prompt 邊界
      .replace(/\n{3,}/g, "\n\n")
  );
}
