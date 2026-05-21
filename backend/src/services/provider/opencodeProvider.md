# OpenCode Provider 行為說明

## 總覽

`opencodeProvider` 透過 `@opencode-ai/sdk/v2` client 連到後端啟動的 opencode server，將 session / SSE 事件轉換為 `NormalizedEvent` 串流。

## Server Config

後端啟動 global server 與 transient server 時都固定注入完整權限：

```ts
{
  mcp: { ... },
  permission: "allow",
}
```

這表示 OpenCode run 不依賴使用者全域設定來放行工具。Run clone / workspace 是隔離與清理邊界，server 本身不再傳空 config 讓外部設定決定權限。

## MCP 與 Plugin

- 無 MCP entries：使用 global opencode server，仍套用後端注入的 `permission: "allow"`
- 有 MCP entries：建立 transient server，將每個 managed MCP entry 轉為 opencode `config.mcp[name]`
- Run 模式：同一 `(runId, podId)` 重用 transient server，Run 結束時統一關閉

## 互動事件

`permission.asked` 與 `question.asked` 仍視為異常事件並 fail fast。完整權限 config 會避免正常工具 approval prompt，但如果 OpenCode 仍送出互動事件，backend 目前沒有回覆通道，因此會回傳 fatal error。
