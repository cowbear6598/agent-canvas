# Changelog

## [0.7.5] - 2026-03-18

### 修正
- Run 歷程聊天視窗 tool use 事件到來時訊息泡泡消失（Vue 深層響應性問題）

## [0.7.4] - 2026-03-18

### 新增
- Slack/Telegram 收到訊息時立即回覆「已接收到命令」確認訊息
- Slack 回覆會 @提及發送者並在 thread 中回覆
- Pod 忙碌時回覆「目前忙碌中，請稍後再試」

## [0.7.3] - 2026-03-18

### 修正
- Run 歷程即時串流時 tool 分散到多個聊天泡泡，重整後才合併
- 外部來源（Telegram/Slack/Jira）觸發的訊息缺少 `/command` 前綴顯示
- 空內容的 Command 無法編輯（雙擊無反應）

## [0.7.2] - 2026-03-17

### 修正
- Jira webhookSecret 前後端同步最小 16 字元驗證
- 移除 Jira App 卡片的 Webhook URL 顯示
- Jira App 名稱 placeholder 改為通用範例

## [0.7.1] - 2026-03-17

### 新增
- Jira Webhook 改造：從 API 連線模式改為純 Webhook 被動接收模式，支援動態子路徑 `/jira/events/{appName}`
- Jira App 配置簡化：移除 email/apiToken 欄位，僅需 App 名稱、Site URL 與 Webhook Secret
- Jira Pod 綁定簡化：不再需要選擇 Project，直接綁定 App 即可
- Webhook URL 一鍵複製：建立 Jira App 後直接顯示完整 Webhook URL 供使用者複製
- IntegrationWebhookRouter 支援前綴匹配路由模式

## [0.7.0] - 2026-03-17

### 新增
- Multi-Instance Run 功能（Integration 觸發自動建立 WorkflowRun，支援 Slack/Jira/Telegram）
- Slack 回覆時自動 @ 原始發送者
- Trigger Settlement Model（auto/direct pathway 獨立結算機制）
- AI-Decide 狀態視覺化與 Cascade Skip 機制
- Run Pod Instance 新增 queued/waiting 狀態與視覺圖示
- Run Mode 新增 RunQueueService 序列執行機制（同一 POD 的多組 pathway 依序執行）

### 修正
- 修復 handleRunDelete/handleRunLoadPodMessages IDOR 漏洞
- 修復同一 POD 的 Direct + Auto pathway 在 Run Mode 下並行觸發問題
- 修復 RunCard 點擊 POD instance 冒泡導致收合
- 修復 RunChatModal 關閉時連帶關閉 HistoryPanel
- 修復 getSkippedPodIds 無限遞迴
- 修復 AI-Decide Run 模式摘要讀取錯誤與 NaN 時間顯示
- 修復 Run 建立時 pod 名稱空白
- 修復 triggeredAt 被非 running 狀態覆蓋
- 修復 Multi-Instance Run 下 Canvas 視覺狀態不應變化
- 修復新建 Slack App 後頻道為空
- 歷程按鈕改為永遠顯示
- runQueueService + workflowQueueService 加入 MAX_QUEUE_SIZE 佇列上限防護

### 重構
- WorkflowStatusDelegate 策略模式取代 27+ 處 if/runContext 分支
- PathwayState enum 取代 boolean|null 三值語義
- ChatEmitStrategy 策略模式消除 streaming handler 的 runContext 分支
- ClaudeService 引入 ExecutionContext 物件收斂散落參數
- CanvasPod.vue 拆分 usePodSchedule/usePodAnchorDrag composable
- Auto Clear 重命名為 Multi Instance
- 狀態集合常量集中定義 + 共用 helper 提取
- 無意義註解清理 + 錯誤訊息統一繁體中文

## [0.6.0] - 2026-03-11

### 新增
- 全域模型設定功能
- Workflow REST API（GET list / POST chat / POST stop）
- Connection REST API（GET list / POST create / DELETE / PATCH triggerMode）
- Jira Cloud Webhook 整合（App CRUD、Pod 綁定、HMAC 簽章驗證 + 防重放 + SSRF 防護）
- Plugin Gateway 重構

### 修正
- 修復 Chat 訊息氣泡與工具標籤顯示不一致
- 修復歷史載入時所有 Tool 集中在第一個氣泡
- 修復 WebSocket listener 重複註冊導致重複訊息
- 修復 Mini Screen 內容重複
- Telegram polling 加入去重防護，避免 409 Conflict
- Shutdown 順序調整與資源清理補齊
- 修正 connectionStore SQL 安全漏洞（加入 canvas_id 隔離）
- chatSchemas Base64 字元合法性驗證
- parseWebhookBody Content-Length 負值/NaN 防護

### 重構
- podStore 14 個假 async 方法改為同步簽名（bun:sqlite 同步 API）
- Integration Provider 5 個重複模式抽出共用 integrationHelpers.ts
- autoClearService graph traversal 邏輯抽離至 autoClearGraphUtils.ts
- useUnifiedEventListeners 600+ 行拆分為 6 個領域模組
- isPodBusy type guard 統一 Pod 忙碌狀態判斷
- injectUserMessage 共用函式統一 4 處訊息注入流程
- claudeService sendMessageInternal 拆分，session 重試邏輯獨立
- GenericNoteStore 型別安全改善，消除雙重 as 轉型
- workflowApi validateMessage 改用 contentBlockSchema 統一驗證
- createNoteStore buildCRUDActions 抽離為獨立模組
- try-catch 濫用修正（renamePodWithBackend、findProvider、skillService）

## [0.5.0] - 2026-03-05

### 新增
- Telegram Long Polling 整合

### 重構
- 全面重構：拆分 God Component、消除重複、強化安全防護
- 統一命名：claude-canvas → claude-code-canvas

## [0.4.1] - 2026-03-05

### 新增
- Pod Rename REST API（PATCH /api/canvas/:id/pods/:podId）
- Canvas Rename REST API（PATCH /api/canvas/:id）

### 修正
- 修正 paste schema 驗證：resource ID 欄位誤用 UUID 格式驗證

## [0.4.0] - 2026-03-05

### 新增
- SQLite 持久化遷移，取代原有 JSON file I/O + Map 快取架構
- 新增 safeJsonParse 防禦性處理與 resetDb 環境保護

### 重構
- 重構測試重複程式碼（後端 beforeAll/afterAll、前端 websocket mock 等）
- 後端 Note interface 繼承重構（建立 BaseNote）
- autoClearService BFS 邏輯統一
- AI 可讀性改善（消除 Record 濫用、修復過度嵌套、統一命名）
- 移除 try-catch 濫用與無意義註解

## [0.3.3] - 2026-03-05

### 新增
- 多 Pod 並行執行 Slack 訊息處理
- Pod 執行後自動觸發 autoClear 和 Workflow

### 修正
- 修復 WebSocket 心跳逾時問題（改用直接 heartbeat:pong 取代 ack 機制）
- 修復 WriteQueue 佇列競爭條件和 await 遺漏問題

### 重構
- Slack 整合從 Socket Mode 重構為 HTTP Webhook
- 移除 WebSocket ack 基礎設施（onWithAck/offWithAck 等）

## [0.3.2] - 2026-03-04

### 修正
- DisconnectOverlay 離線效果未正常觸發
- Header 被其他使用者游標遮蓋（RemoteCursorLayer z-index 調整）
- 複製貼上 Pod Name 應自動產生遞增編號，不應沿用原名稱

## [0.3.1] - 2026-03-04

### 修正
- Direct connection 清理訊息時，下游 POD 也納入清理範圍
- MCP server note 支援 Delete 刪除和 Ctrl+C/V 複製貼上
- MCP server note 貼上後前端即時顯示與 Pod mcpServerIds 同步
- cli.ts handleLogs 錯誤處理修復

### 重構
- CanvasContainer.vue 拆分 composable（695→310 行）
- CanvasPod.vue 拆分 composable（528→300 行）
- repositoryGitHandlers.ts 拆分為 5 個獨立檔案
- 前端 store 統一採用 useCanvasWebSocketAction
- NoteStore 架構重複消除
- Slack 整合流程最佳化與 MessageQueue 移除
- 安全性加強（Schema uuid 驗證、錯誤訊息保護、Prompt Injection 轉義、XSS 檢查統一）
- 複雜度降低與重複程式碼消除
- 變數命名統一與 AI 可讀性改善
- 測試大量補齊

## [0.3.0] - 2026-03-03

### 新增
- Slack 整合（型別定義、資料層、連線層、MCP Server、事件串接）
- slack_reply tool 參數驗證加強
- GitHub Actions CI/CD 流程
- REST API 端點（Canvas 刪除、Pod 查詢/建立/刪除）
- Pod 名稱唯一性檢查與自動編號
- WebSocket ResultPayload 通用介面

### 修正
- 修正 handleNullResponse 行為變更與型別安全問題
- 修正 claudeService 雙重型別轉換
- 修正 fileExists 對目錄路徑永遠回傳 false 的 bug
- 新增 VFS 型別宣告 stub（修復 TS2307 錯誤）
- Logger 訊息改為中文並顯示 entity name

### 重構
- 大規模程式碼品質提升（邏輯優化、重複程式碼消除、型別安全改善）
- 統一錯誤訊息與 logger 為繁體中文
- 抽取共用函式與工廠模式，消除重複程式碼
- 合併共用 Zod Schema，消除重複定義
- 移除不必要的資料欄位，修正前後端欄位不匹配
- 刪除無意義註解與過時文件

## [0.2.2] - 2026-03-01

### 新增
- Pod 右鍵選單「打開工作目錄」功能（跨平台支援 macOS/Linux/Windows）
- start 命令顯示訪問地址、logs 查看日誌功能

### 其他
- 文件更新（使用方式、Demo 影片、教學 GIF、注意事項）

## [0.2.1] - 2026-03-01

### 新增
- Workflow 中 Pod 的 input 限制功能（中間 Pod 禁止輸入、頭/尾 Pod 執行中 disabled）

### 修正
- 調整 CHANGELOG 內容與 release 規則

### 重構
- 統一 Zod Schema，提取共用 base schemas
- 抽取 useModalForm composable 和 validators，消除表單邏輯重複
- 合併 6 個 PodSlot 為 2 個泛型元件（PodSingleBindSlot、PodMultiBindSlot）
- createNoteStore 工廠內建 CRUD 支援
- 重構高/中複雜度函式（useBatchDrag、messageBuilder、repositoryService 等）
- 強化型別安全，移除 any 型別
- 魔術數字抽為具名常數
- 清理無意義註解與未使用程式碼
- 統一進度追蹤邏輯（Progress composable）
- Logger 服務改善
- Security 修正（路徑驗證、metadata schema、ID 格式驗證）
- 補充測試覆蓋

## [0.2.0] - 2026-02-28

### 新增
- 新增 MCP Server 支援
- 統一事件監聽器與 WebSocket 事件定義
- 新增 Release 自動化流程

### 修正
- 修正 ToolOutputModal 權限檢查、Pod 刪除清理邏輯
- install.sh 改用 ~/.local/bin 免 sudo、下載顯示進度條
- 修正 install.sh 換行符問題

## [0.1.0] - 2026-02-28

### 新增
- ClaudeService 統一管理所有 Claude Agent SDK 互動
- CLI 入口（claude-code-canvas 指令：start/stop/status/config）
- curl 安裝腳本 install.sh
- 編譯腳本 scripts/compile.ts
- GitHub Actions release workflow

### 修正
- 修復 compile binary 中 daemon spawn argv 問題
- 修復 SDK pathToClaudeCodeExecutable 在 compile 模式下的路徑問題
- 修復 queryService repositoryId path traversal 漏洞

### 重構
- 統一 Claude Agent SDK 呼叫為 ClaudeService class
- 抽取 getMimeType 為共用模組
- 抽取 getLastAssistantMessage 為共用 helper
