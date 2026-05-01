# Backend Plan

> Scope 假設：本次必做範圍是「錯誤 / 中斷」類 system message。`retry`、`Reconnecting...`、rate-limit warning 這類警告若要一併顯示，可沿用同一資料模型擴充。

## 官方格式整理

- Claude Agent SDK / Claude Code docs：SDK 會輸出 `assistant`、`user`、`result`、`auth_status`、`rate_limit_event` 等訊息型別；Claude Code error reference 也明確列出會直接顯示的 API / auth / quota 錯誤文案
- Codex non-interactive docs：`codex exec --json` 是 JSONL event stream，頂層 event 包含 `thread.started`、`turn.*`、`item.*`、`error`；item 類型包含 `agent_message`、`reasoning`、`command_execution`、`file_change`、`mcp_tool_call`、`plan update`
- Gemini CLI headless docs：`--output-format stream-json` 事件型別包含 `init`、`message`、`tool_use`、`tool_result`、`error`、`result`

## 測試案例

- Claude：`auth_status`、rate limit、API 5xx / overload、assistant / result error 會保留原文並落成 system message
- Codex：頂層 `error` 與 `item.completed.item.type = "error"` 都會保留原文並落成 system message
- Gemini：`error.message` 與 `result.error.message` 會保留原文並落成 system message
- Chat transport：chat-scoped 失敗改走 transcript message，而不是只發 `POD_ERROR`
- History replay：pod chat 與 run chat 歷史重載後仍能看到 system message

### Phase 1

A. 建立統一的 system message 資料契約
- [ ] 擴充 `backend/src/types/message.ts` 的 `MessageRole`，支援 `system`
- [ ] 在 `backend/src/services/provider/types.ts` 為 provider 層定義可攜帶原文錯誤的 system message event 或等價 metadata，避免再把 provider error 假裝成 assistant 文字
- [ ] 設計 system message metadata，至少包含 provider、錯誤 code、嚴重程度、原文內容
- [ ] 對齊 `backend/src/types/responses/pod.ts`、chat / run 歷史 payload、`messageStore`、`runStore` 的 serializer / deserializer，讓 system message 可以被持久化與回放

### Phase 2（可並行）

A. Claude provider 錯誤映射
- [ ] 改寫 `backend/src/services/provider/claude/runClaudeQuery.ts`，停止把 Claude SDK 錯誤硬改成泛用中文提示，改為輸出保留原文的 system message
- [ ] 改寫 `backend/src/services/claude/sdkErrorMapper.ts`，把認證、額度、服務錯誤整理成 metadata，而不是覆寫主體文字
- [ ] 盤點 `backend/src/services/claude/streamingChatExecutor.ts` 內所有 generic `⚠️` rewrite，改成 transcript-first 的 system message 流程

B. Codex provider 錯誤映射
- [ ] 改寫 `backend/src/services/provider/codexNormalizer.ts`，補上 `item.completed.item.type = "error"` 的處理
- [ ] 保留 Codex `error.message` 原文，並標記它是頂層 stream error 或 item-level error
- [ ] 盤點 `backend/src/services/provider/codexProvider.ts` 的 spawn 失敗、exit code 失敗路徑，確保它們都走同一套 structured system message 流程

C. Gemini provider 錯誤映射
- [ ] 保留 `backend/src/services/provider/geminiNormalizer.ts` 的 `error.message` 與 `result.error.message` 原文，不再於更下游被 generic rewrite 覆蓋
- [ ] 盤點 `backend/src/services/provider/geminiProvider.ts` 的 exit code 分類訊息，確保它們也走同一套 structured system message 流程
- [ ] 確認 `tool_result.error.message` 仍屬 tool output，而不是 provider system message，避免工具失敗與 provider 失敗混在一起

### Phase 3

A. Transcript-first 錯誤投遞
- [ ] 建立 shared helper，讓 chat / run 流程可以在失敗時直接寫入 persisted system message，並沿用既有訊息 channel 廣播
- [ ] 改寫 `backend/src/services/chatEmitStrategy.ts`，讓 `POD_CLAUDE_CHAT_MESSAGE` / `RUN_MESSAGE` 可以攜帶 `role = system`
- [ ] 改寫 `backend/src/services/claude/streamingChatExecutor.ts`，讓 provider runtime failure 以 system message 進入 transcript，而不是只在 server log 或 run status 留錯誤摘要
- [ ] 盤點 `backend/src/handlers/chatHandlers.ts` 與 run 相關 helper，讓 command not found、upload failure、invalid workspace/provider failure 這類 chat-scoped 錯誤也走 transcript path

B. 保留全域錯誤邊界
- [ ] 將 `POD_ERROR` 收斂為真正沒有 transcript destination 的全域錯誤用途，例如 websocket / connection 層失敗
- [ ] 若 run / pod 列表仍需 `errorMessage` 摘要欄位，改成從同一份 system message source 派生，避免雙重維護

### Phase 4

A. 歷史回放與文件對齊
- [ ] 確保 `messageStore` / `runStore` history query 會保留 system message 順序，不因缺少 assistant subMessage 而被忽略
- [ ] 驗證現有 DB schema 是否已可容納新 metadata；若不夠，補上最小必要 schema extension 與 forward-only migration
- [ ] 更新 provider / chat transport 文件，說明 system message 契約與 `POD_ERROR` 的新責任邊界

## 測試內容

### Mock 邊界

- 需要 mock 的外部邊界：Claude SDK query stream wrapper、Codex / Gemini subprocess stdout / stderr wrapper、`socketService`、`messageStore`、`runStore`
- 不能 mock 的內部邏輯：`codexNormalizer`、`geminiNormalizer`、`streamingChatExecutor` 的 transcript decision、chat handler 的錯誤路由
- 若 `runClaudeQuery` 目前仍直接依賴第三方 SDK `query()`，先補一層專案內 wrapper，再以 wrapper 作為 mock 邊界，不直接 mock 第三方套件內部行為

### 測試實作

- [ ] 新增 provider 單元測試：覆蓋 Claude / Codex / Gemini 三條 provider 的原文錯誤映射
- [ ] 新增 `streamingChatExecutor` 單元測試：覆蓋 provider error 轉 system message、fatal / non-fatal 順序、generic warning rewrite 移除
- [ ] 新增 chat handler 測試：覆蓋 chat-scoped 失敗改走 transcript message，而非 `POD_ERROR`
- [ ] 新增 chat / run integration 測試：覆蓋歷史重載仍看得到 system messages
