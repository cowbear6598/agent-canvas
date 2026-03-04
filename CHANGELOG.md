# Changelog

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
- CLI 入口（claude-canvas 指令：start/stop/status/config）
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
