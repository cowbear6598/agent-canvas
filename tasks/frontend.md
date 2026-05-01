# Frontend Plan

> Scope 假設：本次必做範圍是「錯誤 / 中斷」類 system message。`retry`、`Reconnecting...`、rate-limit warning 這類警告若要一併顯示，可沿用同一資料模型擴充。

## 測試案例

- ChatStore：收到 chat-scoped 錯誤時，改把訊息寫進當前 pod transcript，不再觸發錯誤 Toast
- ChatMessages / ChatMessageBubble：system message 以獨立樣式顯示，且主體文字保留 provider 原文
- RunStore：run 對話收到 `role = system` 的訊息時，可正確累積、顯示與重開歷史
- 歷史重載：pod chat history / run pod history 讀回 system message 後仍可正確渲染
- ChatModal：送出失敗時不再補跳固定「訊息發送失敗」Toast，避免與 transcript 內的 system message 重複

### Phase 1

A. 擴充前端訊息模型與 WebSocket 契約
- [ ] 將 `frontend/src/types/chat.ts` 的 `MessageRole` 擴充為支援 `system`
- [ ] 為 `frontend/src/types/chat.ts` 補上 system message metadata 型別，至少能表達 provider、錯誤 code、嚴重程度
- [ ] 對齊 `frontend/src/types/websocket/responses.ts` 與 run/chat 歷史 payload，讓即時事件與歷史載入都能帶回 `system` role 與 metadata
- [ ] 盤點 `frontend/src/stores/chat/chatMessageActions.ts`、`frontend/src/stores/run/runStore.ts`、`frontend/src/stores/run/runStoreHelpers.ts` 中只假設 `assistant` / `user` 兩種 role 的分支，改為接受 `system`

### Phase 2

A. 對話框 system message 呈現
- [ ] 在 `frontend/src/components/chat/ChatMessageBubble.vue` 新增 system variant，讓它與一般 assistant 回答有清楚視覺區隔
- [ ] 讓 `frontend/src/components/chat/ChatMessages.vue` 與 `frontend/src/components/run/RunChatModal.vue` 共用同一套 system message 呈現規則
- [ ] 若 metadata 含 provider 或 code，於 bubble 中顯示短標籤；主體文字直接顯示 provider 原文，不再做前端改寫

B. 移除 chat-scoped error Toast
- [ ] 改寫 `frontend/src/stores/chat/chatConnectionActions.ts`：收到與特定 pod 對話有關的錯誤時，改為寫入 transcript；只有 websocket 斷線或無 pod context 的全域錯誤才保留 Toast
- [ ] 改寫 `frontend/src/components/chat/ChatModal.vue`，移除固定的「訊息發送失敗」補償 Toast
- [ ] 確認 run modal 的訊息 listener 也能接受 `system` role，不再額外依 `errorMessage` 做平行提示

### Phase 3

A. 歷史與訊息合併一致性
- [ ] 確保切換 canvas、重開 modal、載入歷史時，system message 與普通訊息順序一致，不會被 partial message 合併邏輯吃掉
- [ ] 確保 tool-use 訊息與 system message 並存時，不會被 assistant subMessage 合併邏輯污染
- [ ] 檢查 run / pod 狀態欄位是否仍需保留 `errorMessage` 作為列表摘要；若保留，改成只供列表摘要使用，不再作為彈出提示來源

## 測試內容

### Mock 邊界

- 需要 mock 的外部邊界：`websocketClient`、`createWebSocketRequest`
- 不能 mock 的內部邏輯：`chatMessageActions`、`runStore` 的訊息合併流程、`ChatMessageBubble` 的 role / variant 判斷
- 不規劃 DOM snapshot 或純 template render 測試，只驗證 role 轉換、訊息注入順序、Toast 不再被呼叫這些有邏輯的行為

### 測試實作

- [ ] 新增 chat store 測試：驗證 chat-scoped 錯誤會變成 system message，且不再呼叫錯誤 Toast
- [ ] 新增 run store 測試：驗證 `RUN_MESSAGE` / 歷史載入中的 `system` role 可正確顯示與保留順序
- [ ] 新增 chat component 測試：驗證 system message 樣式分支與 provider / code 標籤顯示
