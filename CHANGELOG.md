# Changelog

## [2.2.9] - 2026-08-11

### 修正
- 修正循環 workflow 的 Pod 已完成卻仍顯示等待狀態，導致 Run 無法正確結束的問題
- 修正循環 branch 離開流程及 direct 路徑拒絕時的狀態結算

## [2.2.8] - 2026-08-11

### 新增
- Pod 新增 Fast Mode 閃電控制項、充電動畫、狀態持久化與 WebSocket 同步
- 支援 Claude Opus 與 Codex GPT-5.6 系列快速模式，聊天或 Run 執行中會鎖定切換

### 優化
- Claude Agent SDK 升級至 0.3.227
- 移除 Codex GPT-5.5，改用 GPT-5.6 Luna 與 high thinking level，並自動遷移既有設定

## [2.2.7] - 2026-08-11

### 修正
- 讓 Codex Agent 完整繼承後端環境變數，外部工具可直接使用已設定的 API Key 與 Token

## [2.2.6] - 2026-08-11

### 修正
- 修正 Codex CLI 重連進度被誤判為不可恢復錯誤，導致摘要與 workflow 提前失敗的問題

## [2.2.5] - 2026-08-11

### 新增
- Pod 拖曳上傳單檔上限提高至 100 MB，ZIP 檔案上傳後會自動安全解壓縮

### 修正
- 修正部分 macOS ZIP 未標記 UTF-8 時，中文檔名被誤判為損毀壓縮檔的問題
- 修正 Pod 上傳失敗遮罩跑版，以及重試按鈕不符合手繪介面風格的問題

## [2.2.4] - 2026-07-13

### 新增
- 新增 Claude Fable 5，以及 Codex GPT-5.6 Sol、Terra、Luna 模型與對應思考層級支援

### 修正
- 修正模型選單切換後沿用舊捲動位置，導致目前模型被裁切不可見的問題

## [2.2.3] - 2026-06-23

### 修正
- 統一 backend app data root 與 plugin bridge 路徑設定
- 修正開發與正式環境切換後 plugin 仍共用同一份資料目錄的問題
- 修正 workflow run 歷史保留清理邏輯，避免清理結果不穩定
- 修正大量 run 下畫布歷史執行紀錄排序不一致與後端測試平行執行偶發失敗的問題

## [2.2.2] - 2026-06-07

### 新增
- 新增 Discord 整合支援與相關操作介面

### 修正
- 改善管理中心與各設定視窗的返回導航流程
- 穩定 Discord 整合的回覆、頻道同步與綁定流程
- 分離開發環境的 backend 與 OpenCode 連接埠，並統一前端 API 與 WebSocket 連線目標
- 清理已不再使用的 SOAP 任務檔案

## [2.2.1] - 2026-06-04

### 修正
- 修正排程 Pod 列表載入失敗的問題
- 補強排程時間回傳格式回歸測試

## [2.2.0] - 2026-06-04

### 新增
- 新增 Repository Memory 控制介面、維護流程與 maintainer logging
- 新增 blocked Pod workflow 狀態與 run history 顯示
- 整合統一模型設定中心，集中管理模型與 provider 設定

### 修正
- 修正 workflow 忙碌時無法正確排隊等待的問題
- 修正 blocked 任務停止後未保留後續流程與狀態的問題
- 修正使用者遇到不可達路徑時狀態顯示不正確的問題
- 修正 direct connection 切換與 Goal workflow runtime 穩定性問題
- 修正 Goal blocked 時 workflow 靜默卡住的問題
- 修正 Branch 判斷資訊不足時誤選第一條路徑，改為要求明確選擇
- 改善 Canvas 連線繪製效能
- 修正 Run 佇列 Pod 重複觸發導致流程卡住的問題
- 修正 WebSocket 業務錯誤回應與事件合約驗證
- 修正架構重構後的 Run 資料與 workflow 穩定性問題
- 完成專案架構重構 P1-P3 並調整相關測試
- 修正 Pod 與 Repository Memory 維護時機互相影響的問題
- 修正 Repository Memory migration 可能造成啟動崩潰的問題

## [2.1.4] - 2026-06-01

### 新增
- Skill 管理介面支援 `zh-TW`、`en`、`ja` 三種語系顯示
- 新增 Pod provider 轉換選單與模型轉換流程
- 新增 skill bundle 管理與匯入 API，補齊受管 Plugin 資訊同步

### 修正
- 啟動時改為背景清理孤兒 run repository，避免後端啟動被卡住
- 補強啟動流程驗證，確保服務可先回應後再執行背景清理
- 統一非玩家觸發訊息格式，避免 Jira、Slack、Telegram 與 Webhook 整合輸出不一致
- 修正 Webhook 事件內容破壞 Pod 接收格式的問題
- 修正 Jira 全量更新模式會遺失實際變更資訊的問題
- 修正 Pod 工作目錄下載在缺少 ignore 設定時的處理與錯誤提示
- 修正聊天串流重複整理訊息內容導致的異常
- 清理已廢棄的 backend REST 路由與同步測試
- 統一 GitHub 與本地 skill 匯入提示內容
- 限制 Pod 切換 OpenCode provider 時只能使用已註冊模型
- 修正 follow-source 連線在 provider 收斂後被寫死的問題
- 修正貼上含錯誤 connection 時仍顯示成功但實際少線的問題
- 修正 OpenCode 與 Codex connection 貼上後的摘要 provider 顯示
- 保留複製貼上 connection 的 provider 與設定內容
- 修正 skill 匯入與更新流程的安全性與穩定性問題
- 修正 Skill 管理與 Pod 啟用介面的錯誤提示與狀態同步
- 修正 Goal 遇到不可恢復的 Provider 錯誤時無法正確結束的問題
- 限制 Goal 最多重試 3 次，避免持續空轉佔用執行資源

## [2.1.3] - 2026-05-27

### 修正
- 修復 doodle scrollbar 黑色殘留問題
- 修復 Chat 訊息 tool status 顯示未帶型別約束導致未知狀態誤顯示

### 優化
- ToolOutputModal 改為單一 Modal 渲染，大幅降低長對話記憶體佔用
- backend 啟動時 schema migration 改為單一 transaction，加快啟動並確保原子性
- backend 資料庫欄位新增白名單與格式驗證，強化 SQL 注入風險防護
- 移除整套 dark mode（CSS variant、變數區塊、scrollbar 規則、Vue 元件）
- 移除 Codex provider 的 GPT-5.4 mini 模型，並自動遷移既有設定為 gpt-5.4
- 清理無業務邏輯保護價值的 DB CASCADE 與過度測試覆蓋

## [2.1.2] - 2026-05-27

### 修正
- 修正 Run 啟動時綁定 repository 未更新到最新遠端內容的問題，並補上 local clone 回歸測試

## [2.1.1] - 2026-05-26

### 修正
- 修正鎖定 Canvas、Pod 操作與密碼解鎖時的錯誤提示
- 修正外掛管理與 Pod 操作可能出現重複 Toast 的問題
- 強化 Canvas 事件與 WebSocket 錯誤翻譯的回歸測試
- 修正 OpenCode disposable、分支決策失敗、alias 排序與 workflow 狀態回歸問題
- 清理 SOAP 任務紀錄

## [2.1.0] - 2026-05-25

### 新增
- 支援 OpenCode 作為 Summary 與 Branch 模型來源
- Branch Workflow 日誌新增 canvas 與 pod 名稱，方便追蹤執行脈絡
- 補上 Workflow、Branch、Multi-input、OpenCode、資料庫一致性與回歸測試覆蓋

### 修正
- 修正 Direct workflow 移除後的狀態同步問題
- 修正 Workflow Run 多來源排隊時互相中止的問題
- 讓每組 Goal 執行都從完整待辦重新開始
- 改善 Run 對話載入與 Goal 分隔線顯示
- 隔離 workflow run 暫存 repository 目錄，避免出現在一般 repository 清單
- 補強 runtime repository 安全檢查
- 修復 OpenCode 錯誤訊息外洩與失敗處理
- 改善 OpenCode 設定與連線更新一致性
- 修復 OpenCode alias 重複設定防護與已設定 alias 的模型選單顯示
- 強化 WebSocket 請求失敗回饋與 listener 管理
- 強化 OpenCode thinking alias 處理
- 防止刪除使用中的 OpenCode model alias
- 強化 OpenCode 設定錯誤訊息與 provider 清單安全性
- 修復 unlock 重新連線可繞過限制的問題
- 修復分支名稱可被誤判為 Git 參數的問題
- 修復 Telegram polling 失敗後停止重試的問題
- 修復畫布操作失敗時沒有明確錯誤回饋的問題
- 修正 Branch 決策模型跟隨 source Pod
- 修正編輯文字時誤刪連線的問題
- 改善 branch 連線設定同步失敗處理
- 修正長時間查看 run 歷史後的卡頓與訊息重複問題
- 讓刪除 run 與 workflow 清理流程在失敗時能正確回報與重試
- 調整前端載入方式，避免正式建置時出現 bundle 警告
- 清理已完成的資料庫 migration 函式與過期測試檔案

## [2.0.6] - 2026-05-22

### 新增
- 放寬 Goal todo 字數與條數上限，支援放入範例與更長的指令內容

## [2.0.5] - 2026-05-22

### 新增
- 重整前後端測試分層、測試 inventory 與 userflow 套件，讓測試結構更清楚
- 補強 Goal Runtime、Integration Reply 與 WebSocket listener 相關測試覆蓋

### 修正
- 統一 Integration Reply MCP 回覆流程，改由後端 endpoint 集中執行與驗證 capability scope
- 修正執行中 workflow 的 Goal Runtime 使用 run-scoped snapshot，不再被後續 goal 編輯影響
- 強化 Goal Runtime 快照讀取與執行中保護，避免無效快照被靜默當成不存在
- 修正 chat WebSocket listener 解除註冊只移除自身 handler，避免影響其他監聽

## [2.0.4] - 2026-05-21

### 修正
- 修正 Plugin 管理選單與安裝流程穩定性，並改善安裝失敗與格式錯誤提示
- 補強 Plugin 管理相關測試覆蓋
- 修復非 Claude Integration 的回覆授權流程，並強化 Slack 回覆錯誤處理與測試
- 停止追蹤本機編譯產物，避免 build binary 被一般提交帶上遠端
- 完整移除 AI provider sandbox 殘留，並補強完整權限測試與乾淨建置流程

## [2.0.3] - 2026-05-21

### 優化
- 工作流程觸發與分支連線狀態管理最佳化

## [2.0.1] - 2026-05-21

### 修正
- 修正 Goal Runtime 顯示「下一個待做 todo」誤抓當前 active 的問題
- 修正 Goal Runtime 狀態檔讀取失敗時靜默清空進度的問題，現在可在 console 看到 I/O 錯誤
- 修正 managed MCP proxy bridge 退出時清理動作不會執行的問題

### 新增
- 優化刪除執行中 Run 的防護流程，hot path 不再每次查 DB
- 補強 MCP bridge 路徑與 Run 取消 guard 的測試覆蓋

### 優化
- 程式碼整理、移除冗餘註解與無契約測試

## [2.0.0] - 2026-05-21

### 新增
- 接入 OpenCode：多家 LLM Provider 統一入口 + Pod 整合
- Goal 改為非必填，不再阻擋未設 Goal 的 Pod 執行對話與檔案拖放
- Pod 卡片底部右下角放上 Schedule / Delete 按鈕
- Pod 卡片 header 與內容區之間加上波浪 divider
- OpenCode Pod 補上淺橄欖綠頂部漸層
- 每顆 Managed MCP 現在會獨立顯示給 agent
- Goal Runtime 成為獨立 MCP
- Claude pod 勾 http/sse MCP 時自動啟動 per-MCP proxy bridge
- Workflow 跑到一半也能改 pod 的 MCP 勾選
- OpenCode SDK v2 遷移

### 修正
- 修正 goal 編輯器貼上後錯誤訊息殘留的問題
- 統一 Goal 剪貼簿 action 命名與「貼後保留」語意
- 補上 goal 編輯器空白項目的儲存驗證
- 強化 Goal 複製貼上測試的穩定性
- 補上 Goal 剪貼簿覆蓋語意的測試
- 修正 OpenCode alias 拖曳排序後列表清空的問題
- 統一前後端 success 契約，讓 OpenCode 操作失敗時 UI 能正確顯示錯誤訊息
- alias 排序欄位命名統一為 orderIdx
- provider list / restart 失敗時會顯示具體原因
- 並發新增同名 alias 時顯示友善錯誤提示
- 修正重啟 OpenCode 不會 spawn 重複子程序的問題
- 移除沒有測到商業邏輯的 wrapper 測試
- 加入載入失敗時的 console.error 日誌
- 修補 goal todo 狀態殘留與 opencode session 卡住
- 加強 plugin 除錯日誌、移除路徑掃描 symlink
- 修補 SQL 拼接漏洞、並行化 catalog 與 MCP 健檢
- 後端 opencode SSE throttle 與前端 sub-message 測試補強
- Goal Runtime state 不再被 retry 覆寫
- Gate retry 訊息一致性改進
- Opencode transient server 不再洩漏
- Run mode opencode server 重用
- Run 結束時清理 Goal Runtime tmp 檔案與 opencode server cache
- Goal 子 Modal 編輯後保留尾端空白導致預覽與資料不一致
- 補上 Goal 子 Modal 純空白輸入的邊界測試
- 修正 REST API 啟動 run 失敗時前端收不到任何訊號的問題
- 修正佇列入隊失敗會被靜默吞掉的問題
- 修正 Multi-instance integration 個別 Pod 失敗時前端無法獲知的問題
- 修正 opencode 切換模型時被前端 PodStore 拒絕的 bug
- Codex pod 的工具執行結果顯示修正
- MCP 勾選 popover 移除 status chip
- 補齊 Managed MCP Test Connection handler 的單元測試覆蓋
- 補上 plugin slot disabled 時的 tooltip 文案測試覆蓋

### 重構
- 完成大型重構：Gemini 移除、command→goal 替換、normal mode 移除、小螢幕移除
- 大規模程式碼整理與模組拆分
- ManagedMcpModal 與 McpPopover 的 MCP 卡片排序調整與 UI/UX 整理
- 移除約 80 條只重述程式碼的 WHAT 註解，保留含設計理由的 WHY 註解
- 收斂 6 個無實質意義的薄包裝函式，呼叫端直接使用底層 API
- 後端 opencode SSE throttle 與前端 sub-message 測試補強
- 保留 review 前基準版多個關鍵功能點

## [1.6.0] - 2026-05-15

### 新增
- 後端啟動時掃描並記錄殘留孤兒 runDir

### 修正
- 修正 DB 升版失敗時立刻中止啟動並顯示真正的錯誤原因
- 補齊 Run 刪除時清理工作目錄的測試覆蓋
- 補齊 Run 啟動同步主 repo 失敗時應中止的測試覆蓋
- 後端 schema、handlers、services、types、utilities、tests 進行重構整理
- 前端 components、composables、stores、types、locales、tests 進行重構整理
- 移除 worktree 相關功能與測試

## [1.5.0] - 2026-05-11

### 新增
- sandbox 白名單預設清單新增 *.threads.com、*.youtube.com、*.googleapis.com 三個常用網域

### 修正
- 修補 branch label 在 AI prompt 內未被 sanitize 的安全漏洞，入口 schema 補上字元白名單
- 修正 multi-input branch 部分被拒時，已被選中的連線在前端卡 running 樣式的問題
- 修正最上游 Pod 橡皮擦無法 enable 的問題
- 清掉前端 12 個 vue template 排版 warning
- 將 AI 決策邏輯從 workflow service 分離至獨立的 branch service，重組並簡化分支決策服務
- 重構 workflow trigger 相關服務，提升可維護性
- 清理前端純渲染與 trivial 互動測試、後端 const→const 與命名慣例測試共 14 檔，並刪除 backend tests 內 54 個 temp-test 殘留目錄

## [1.4.5] - 2026-05-07

### 新增
- 新增 agent-canvas domain add/remove/list 子命令，管理 Claude sandbox 網路白名單
- 第一次啟動或操作時自動建立 ~/Documents/AgentCanvas/sandbox-whitelist.txt，包含 24 項預設網域（npm、pypi、github、anthropic、atlassian、slack、sentry、threads、discord、gitlab 等）

### 修正
- 修正原本 sandbox 網路全開設定不被 SDK 接受導致 Sentry/Slack 等 integration 被擋的問題，改為由白名單管理
- 移除 CLAUDE_SANDBOX_DENIED_DOMAINS 環境變數

## [1.4.4] - 2026-05-07

### 修正
- 開放 Claude sandbox 的網路存取，預設讓 Bash 工具能打第三方 API（Sentry、GitHub 等），解決原本 sandbox 內 curl / Python 出現 tunnel 403 的問題
- 新增 CLAUDE_SANDBOX_DENIED_DOMAINS 環境變數，部署環境若需收緊可逐項擋特定 domain

## [1.4.3] - 2026-05-07

### 修正
- 強化 sandbox 安全防護，擋住 SSH 金鑰、AWS / GitHub / Docker credential、shell 設定檔等敏感路徑的寫入
- 修正切換瀏覽器分頁觸發靜默重連後，後端找不到使用中 Canvas 的問題
- 修正 Claude sandbox 設定無法從呼叫端覆寫的問題
- 補上 sandbox 路徑與配置的測試覆蓋

## [1.4.2] - 2026-05-06

### 修正
- 修正切換瀏覽器分頁再切回時，目前選中的 canvas 會被強制重置回第一個的問題
- 修正開著歷程 sidebar 時點 Canvas 按鈕互斥失效的問題

## [1.4.1] - 2026-05-05

### 修正
- 修正非 Git Repository 的 Run 可直接在原始工作目錄執行
- 讓尚未建立 commit 的 Repository 也能沿用原始工作區協作

## [1.4.0] - 2026-05-05

### 新增
- 多 Pod 模式輸入框支援多行輸入，隨內容自動長高

### 修正
- 修復 Mac 注音輸入法在多 Pod 聊天輸入時誤觸送出的問題
- 多 Pod 模式輸入框的捲軸樣式對齊專案 doodle 風格
- 修復開始聊天後 Pod notch 上已綁定 Note 視覺退回空槽樣式的問題
- 修復 Pod notch 在禁用狀態下 cursor 仍顯示手指（應為禁止符號）
- 補上 PodSingleBindSlot / PodMultiBindSlot 在 disabled 狀態下的測試覆蓋
- 全 Canvas 鎖定時點打開清單可正常開合，行為與 Header 按鈕一致
- 設定或變更 Canvas 密碼後，當下不會再被要求輸入密碼
- 解除 Canvas 密碼時不再誤回 Canvas password required
- 補上 authGuard 測試保護門禁規則
- 修復 workspace 重連期間可能短暫繞過鎖定畫面
- 加入 TRUST_PROXY 白名單
- workspace/canvas 解鎖加入失敗次數限制
- reconnect grant 改用 HttpOnly cookie
- 消除 canvas 事件守門重複檢查
- 文檔更新，補充三個支援的 AI Provider
- 簡化 README 文檔

## [1.3.0] - 2026-05-04

### 修正
- 修復 thinking level 切換時水位波浪沒有平滑過渡，改為跨水位邊界也能流暢動畫
- 修正 production 環境錯誤訊息靜默吞掉的問題，使用者遭遇異常時仍可在 console 觀測到錯誤

## [1.2.6] - 2026-05-04

### 修正
- 修正 release 流程造成 root / frontend / backend 版本號不一致的問題
- release 腳本現在會同步更新 frontend `package.json`，並在執行前檢查三個 `package.json` 版本一致性

## [1.2.5] - 2026-05-04

### 修正
- Claude CLI 在 Linux sandbox 中讀寫設定檔並改進 stderr 診斷

## [1.2.4] - 2026-05-04

### 修正
- 升級 Claude Agent SDK 到 0.2.126，修復 Claude Pod 開啟 thinking 後完全靜默卡死的問題

## [1.2.3] - 2026-05-04

### 修正
- 還原 Provider 串流錯誤 log，避免 SDK 錯誤被靜默吞掉

## [1.2.2] - 2026-05-04

### 改進
- 移除資料庫 schema 歷史 migration，精簡初始化流程

## [1.2.1] - 2026-05-04

### 新增
- Pod 訊息鎖定 Notch 功能：Pod 有對話訊息時，鎖住 Model Selector / Thinking / Plugin / MCP / Repository / Command 共 6 個 notch，支援 hover tooltip
- Per-Pod Thinking Level 功能：每個 Pod 可獨立設定 LLM 推理層級（Claude / Codex 支援）

### 修正
- 修正備份服務測試期望值
- 修正 CI vitest 執行時 logger mock 缺少 sanitizeSensitiveInfo export 導致的 unhandled error

### 改進
- 合併 Claude 查詢起始 log，精簡查詢日誌輸出
- 大幅精簡後端 logger 雜訊：移除 116 筆例行操作 log，保留錯誤路徑與資源生命週期關鍵 log
- 精簡 Workspace / Telegram / Paste 等模組 logger

## [1.2.0] - 2026-05-02

### 新增
- Gemini Pod macOS Seatbelt 沙箱隔離，提升安全性與進程隔離
- MCP 設定統一安全字元規則與三 provider 分派邏輯集中化
- McpServerRow 子元件，三 provider popover 列表渲染共用

### 修正
- 修正 user-scoped MCP server 顯示與啟用流程的設定來源描述
- 強化 chat 過程中 MCP 子程序錯誤訊息敏感資訊遮罩，避免 token 寫入 log
- 修正每次 chat 都會重複同步寫 Claude sandbox launcher script 與 sandbox profile 導致啟動延遲與檔案互蓋
- 修正 Run 沙盒 home 建立函式責任過重問題，pod 全域 seed 建立獨立化
- 修正 repository 路徑找不到時伺服器絕對路徑經 WebSocket 事件外洩到前端的敏感資訊洩漏
- 修正 Connection cross-provider summaryProvider 錯位導致 UI 與後端執行 provider 不一致
- 修正 Provider 業務錯誤（usage limit、配額耗盡、認證失敗、rate limit）錯誤訊息處理，改為 Pod 內系統訊息而非全域 toast
- 修正 Claude rate limit 訊息顯示為原始 JSON 物件的問題，改為人類可讀的中文格式
- 修正 Gemini Pod 下游總結的 fallback 路徑記憶體優化，避免訊息量大時 O(n) 額外記憶體佔用
- 修正 Gemini Pod 錯誤訊息洩漏 Pod ID 與絕對路徑等敏感資訊

### 改進
- 改善子程序生命週期管理，提早中止對話時正確 kill CLI 子程序避免遺留 zombie process
- ConnectionContextMenu 選單渲染最佳化，hover 時 connection 數量增長不再出現多餘運算
- Codex plugin 掃描改用單次 readdirSync withFileTypes，減少檔案系統呼叫
- Gemini extension 載入補上路徑越界防護，與 Claude plugin 來源行為一致
- Plugin 清單 API 與 MCP 訊息型別對齊（claude / codex / gemini 三選一）
- Gemini provider chat 入口統一收窄 options，移除散落的 ! 非空斷言
- 後端測試在 CI 沒裝 claude CLI 時 workflow-execution 整組 timeout 問題修復

## [1.1.5] - 2026-04-29

### 新增
- 拖曳檔案到 Pod 顯示真實上傳進度條與檔案數量
- 上傳中對聊天區、右鍵選單、連線把手、刪除按鈕進行操作限制（Pod 仍可拖移）
- 部分檔案上傳失敗時其他檔案繼續上傳，失敗檔依錯誤碼顯示具體原因並支援重試
- Pod Plugins/MCPs popover 加入搜尋與 ScrollArea

### 修正
- pluginScanner 測試在 CI 跨平台失敗
- McpPopover 載入失敗訊息改善（不再誤導為「尚未安裝」）
- 錯誤訊息不再直接洩漏後端訊息

### 優化
- 測試架構重構 Phase 1-4：淘汰 mock-only handler、改用真實作、合併重複測試用例
  - 後端：刪除 25 檔 mock-only handler/api、用真 SQLite + 真 store 全面重寫高 mock 密度測試
  - 前端：刪除 3 檔無價值測試、podStore/connectionStore 改 mock 邊界、移除自家 store/composable/子元件 mock
- Pod popover toggle 清單組裝改用純函式，流程更清晰
- menus.css 抽出共用 action 按鈕與搜尋框基底樣式
- pluginScanner 測試改用 tmp dir，產品碼加可注入 plugins root
- 統一 i18n locale 結構與錯誤處理
- Switch model-value 改用 Set.has 提升查找效能
- tests/setup.ts 改為 top-level await 消除 i18n patch race condition

## [1.1.4] - 2026-04-28

### 新增
- 拖曳檔案到 Pod 觸發 Agent 功能
- 統一前後端常量（MAX_MESSAGE_LENGTH、MAX_CONTENT_BLOCK_SIZE_BYTES 等）
- 拖曳資料夾錯誤訊息國際化支援（三語）
- 強化資料驗證與防禦（UUID 邊界檢查、檔名路徑字元過濾、df 輸出欄位驗證）

### 修正
- 修正連線右鍵選單的 Summary Model / AI Model 子選單關閉延遲 180ms 的卡頓問題
- 修正 Pod 旋轉 highlight 顯示
- 修正 MCP 與 Plugin toggle 互動行為
- 修正 ConnectionContextMenu 子選單 hover delay
- 修正 Repository 變動不清訊息與 session 同步問題
- 修正 Chat input focus 與輸入行為
- 優化連線與 Pod 互動體驗，強化防禦與效能
- 優化啟動流程結構（runMigrations、startBackgroundServices 函式抽出）
- 優化暫存清理與檔案讀取效能（tmpCleanupService 改用 chunk 並行 stat、前端拖檔改用 chunk 並行讀取）
- 補強單元測試覆蓋率

## [1.1.3] - 2026-04-28

### 修正
- 修復綁定 integration 到 codex pod 時 canvasId 與 i18n key 缺失的問題
- 修復排程觸發時訊息顯示不一致、webhook API 觸發對話歷史不完整的問題
- 修復 workflow 路徑驗證，遇到不存在的 Command 時現在能正確回報錯誤
- 修復前端記憶體洩漏（workflow listeners 因 reference 不符無法解綁）
- 強化 Connection Line Summary Model 的安全性（防 prompt injection、補 update 驗證、防錯誤訊息洩漏）

### 改進
- 簡化部分 handler 抽象層級，抽出多個重用 helper（PullProgressResult、resolveErrorCode、withTimeout 等）
- 改善 Workflow 執行效能（Codex 子程序並行限制、SQLite RETURNING 減少查詢、BFS adjacencyMap 預建）
- 補三語翻譯（中、英、日）與 i18n key
- 改名 findGroupType → checkIsCommandGroup 反映實際行為
- slackProvider 加 60 秒頻道快取，避免每次 refreshResources 進行 full pull
- telegramProvider 重試前補 abort/has 檢查避免 destroy 競態殘留
- 大幅補強單元測試（integration binding、schema 失敗路徑、E2E 測試等）
- 精簡冗餘防衛性編程，改善產品體感與程式碼可維護性

## [1.1.2] - 2026-04-27

### 新增
- 統一 Command 展開流程：skipCommandExpand 參數支援上游事先展開避免雙重展開
- 補上核心分支單元測試（streamingChatExecutor 與 launchMultiInstanceRun）
- Paste API 回應新增 canvasId 欄位，前端完成後顯示成功/失敗 Toast 提示

### 修正
- SQLite 路徑遷移：資料庫內殘留 ClaudeCanvas 路徑全面替換為 AgentCanvas
- 修復貼上 Pod 缺少 canvasId 導致前端無法回應的問題
- Webhook 觸發 Command 展開重構：避免重複展開並統一 Command 不存在時的處理邏輯
- 排程觸發時 Command 展開流程重構：實現空字串 fallback 機制避免 stdin 為空崩潰
- 修復 14 個前端 ESLint warning（排版格式化、Vue 指令屬性斷行）

## [1.1.1] - 2026-04-27

### 修正
- 修復 install.sh 執行時 checksum 驗證失敗的問題（release workflow 產生的 checksums.txt 含 dist/ 路徑前綴，與 install.sh 期待的純檔名不一致）

## [1.1.0] - 2026-04-27

### 新增
- 專案改名 claude-code-canvas → agent-canvas（前後端文件、配置、遷移機制全面更新）
- Pod 模型選擇器動畫優化：async/await 時序控制、收合動畫精準串接、元件卸載時 timer 清理
- 統一 Claude/Codex 模型選項結構（ModelOption interface、CLAUDE_OPTIONS/CODEX_OPTIONS 對稱）
- Plugin 系統全面取代 SkillNote，整合 Plugin Gateway 重構
- SubAgent 連根拔重構完成
- Command 跨 Provider 統一展開機制（tryExpandCommandMessage 共用 helper）
- 資料庫 migration 流程強化（runMigration/isIgnorableMigrationError helper，消除重複 try-catch）
- Pod 設定流程清晰度提升（ensureModelField/buildUpdatedPod/loadRelation 專用 helper）
- Claude Provider 敏感資訊保護強化（固定字串替代原始錯誤、路徑訊息泛化、warn log sanitize）
- Pod Slot 結構最佳化（5 個 createSlotConfig helper、ALLOWED_STATUSES/PROVIDERS 改 Set）
- Claude Provider 訊息分派改進（dispatchSystemMessage/createReplyToolHandler 邏輯拆分）
- ESLint 檢查修復：268 個 warning 清到 0（排版、型別標註、any 限制）
- 補強單元測試覆蓋：capabilities/eventsSchema/buildClaudeOptions/runClaudeQuery/providerTypes 五份測試檔
- Codex Provider 抽象層擴充完成，Provider interface 標準化 metadata + 配置驗證
- 模型選項管理：支援多 Provider 動態模型列表與白名單驗證
- Claude Agent SDK 升級至 0.2.119（新 Provider 擴充機制支援）
- Provider 統一抽象層重構：AgentProvider<TOptions> 介面標準化
- 統一 abortRegistry 管理所有 abort 生命週期，移除跨抽象邊界的 hack
- Provider 透過 metadata.defaultOptions 自報預設值，模型 default 單一來源
- 前端新增 providerOptions helper 與 Pod 未知 Provider fallback UI
- Codex Pod Run 模式漏用 worktreePath 的 bug 修復
- 新增 provider 擴充 playbook（README/types/claudeProvider/codexProvider 四份 .md）

### 修正
- 修復建立 Pod 時前端 console 出現 canvasId 缺失警告
- 修復新建 Pod 沒及時顯示的問題
- 修復下游 Pod 透過工作流觸發時 Command 沒展開成 xml tag
- 修復 Run 模式（multiInstance）觸發時 Command 沒展開成 xml tag
- 修復排程觸發時 codex 因 stdin 為空崩潰、Command 沒展開、無 commandId 時直接跳過不觸發 AI 的問題
- 補回 README 改名遺漏項目（標題、安裝 URL、CLI 指令全面更新為 agent-canvas / Agent Canvas）
- Pod 建立與更新的原子性保護（DB transaction 包起主表與 join table 寫入）
- 避免伺服器系統路徑透過 provider:list 回應洩漏給前端
- 補齊前後端 provider 清單型別契約一致性（CapabilityConfig 與 SET 引入）
- 修復 WebSocket 請求缺 requestId 導致後端驗證失敗
- 強化 Codex 子程序 stderr 並行收集，避免緩衝滿時卡住
- 擴充 Codex 敏感資訊遮蔽規則（Authorization/api_key/sk- 等模式）
- Pod Model Selector 動畫期間鎖定選取值，避免競態造成切換異常
- Pod 複製貼上被錯誤轉為 Claude 的問題修復
- 修復貼上流程中 provider/model 設定遺失（DB schema 移除舊 Pod.model 欄位）
- 強化貼上路徑驗證避免任意目錄複製
- Codex Pod abort 後 thread/resume 失敗修復
- Codex 對話事件順序與錯誤處理修正（session_started 早發、可恢復錯誤不中斷對話）
- Codex CLI 安全性強化（model 名稱白名單、環境變數明確允許清單、stderr 敏感資訊過濾）
- 同名 Pod 並發建立的競爭條件修復（DB UNIQUE 約束 + 自動加序號後綴）
- Pod 運行時光暈定位錯亂修復（脫離 transform 容器獨立元素）
- Claude Pod 上 note 拖放綁定失敗修復（保留響應性）
- Pod 建立安全性補強：provider allowlist 守門、model 名稱格式驗證、Pod id 格式驗證
- Pod 名稱編輯驗證失敗改為 Toast 提示
- Pod 模型 roundtrip 型別安全修復

### 優化
- Pod 貼上效能最佳化（改並發建立、重名查詢改記憶體查找）
- sortedOptions 改為單次迴圈，去掉 find + filter 兩次掃描
- PodModelSelector 動畫效能優化（去掉 box-shadow Paint 掉幀）
- Pod 介面收斂、效能最佳化、安全性強化
- Codex 整合流程補強、isCollapsing guard、未知 provider fallback 測試補充
- podStore 拆分 resolveProviderConfig、codexProvider 抽出 collectStderr/handleExitCode/isEnoentError
- Provider 命名清單改用 Set<string>，減少 model 驗證的陣列分配
- 程式碼品質與可讀性改善（命名、註解、重複邏輯抽 helper、型別重組）
- MCP 重構（複雜度降低、安全性強化、效能優化、廣播路徑改 PodPublicView）
- MCP 多人協作：podEventHandlers 加 POD_MCP_SERVER_NAMES_UPDATED listener、connection 改進
- MCP 效能優化：podStore podMap O(1) 查找、createNoteStore notesByPodId getter、selectionStore 維護避免重建、pasteHandlers syncBoundNotes 改批次
- Provider Header 漸層改用 rem 相對單位、補 dark mode 漸層色
- Pod 狀態光暈（執行中藍、彙整黃、選中薄荷綠）改用 Compositor 加速動畫
- PodTypeMenu 六個 section build 函式抽為 factory + 宣告式 config 陣列
- 模型 emit 事件合併為 8 個（相關事件改 discriminated union）
- Pod 介面響應性與型別安全改善
- 消除 Record 濫用、修復過度嵌套、統一命名
- 動畫效能優化（transition 改列舉具體屬性取代 all）

## [1.0.7] - 2026-04-13

### 修正
- 修復 Multi-Instance Pod 綁定 Integration 時聊天室無法觸發 Run 的問題，改為顯示 Integration 驅動提示
- 修復 Run 模式誤用 Pod 全域舊 Session 導致 Claude 無回覆的問題
- 修復 syncToRemoteLatest 的 git clean -fd 刪除 .claude/ 目錄導致 Claude SDK 無法運作的問題
- 修復 Integration App 建立時因等待初始化導致測試 timeout 的問題
- 修復建立回應阻塞初始化的問題，改為立即發送回應並背景執行初始化

## [1.0.6] - 2026-04-10

### 新增
- Canvas 密碼鎖功能：支援設定/修改/解除密碼，鎖定 Canvas 在列表顯示鎖頭圖示
- Run 啟動前自動同步 repository 到 remote 最新版本

### 修正
- REST API 與 WebSocket 雙重密碼防護，未驗證請求回傳 403
- 修復 Run 執行中刪除導致 FOREIGN KEY constraint failed 的 bug
- deleteRun 改為先發 abort 信號、等待進行中操作完成後再刪除 DB
- 修復 Run 的 Worktree 清理後重複刪除導致錯誤日誌的問題

## [1.0.5] - 2026-04-09

### 修正
- 修復 Claude SDK 429/401/用量上限等錯誤導致對話卡住的問題
- API 錯誤訊息直接顯示在 Pod 聊天氣泡中
- API 重試時即時顯示重試進度

## [1.0.4] - 2026-04-09

### 新增
- 同一 Run 內相同 Repository 的 Pod 共用 Worktree，上游修改下游可見

### 修正
- 修復 Claude SDK 429/401/用量上限等錯誤導致對話卡住，API 錯誤訊息直接顯示在 Pod 聊天氣泡中
- API 重試時即時顯示重試進度
- 修復 Run 結束時 Worktree 含未提交變更導致清理失敗
- 修復多 Pod 共享 Repository 時資源同步的競態條件
- 修復 Integration Apps 複製按鈕在非 HTTPS 環境下無法使用
- Clipboard API 權限被拒時自動降級為備用複製方式
- 修復元件銷毀時未清除計時器的記憶體洩漏問題

## [1.0.2] - 2026-04-07

### 新增
- 下載工作目錄功能，支援自動打包 zip 並下載
- 進度面板顯示下載進度（已下載大小），下載完成後自動觸發瀏覽器下載
- 串流壓縮支援大型目錄，不受記憶體限制
- 依照 .gitignore 規則排除檔案，保留 .git 目錄
- CORS 支援，開發環境前後端跨域請求正常運作
- 完成 README 三語版本（zh-TW / English / Japanese）教學內容大幅擴充
- Connection Line 模型設定（Summary Model / AI Model）教學
- 一般模式與 Multi-Instance 模式教學，說明 Git Repo Worktree 隔離機制
- Plugin 使用教學
- Workflow 實戰案例教學（Auto 串接、AI 條件分支、多輸入聚合）
- Schedule 排程教學
- 右上角功能總覽（切換語系、全域設定、Integration 串接含 Webhook、歷程）

### 修正
- 路徑邊界驗證防止目錄穿越攻擊
- 客戶端斷線時自動中止打包，避免浪費伺服器資源
- 修正三語 README 目錄 anchor link 格式（大小寫、空格），修復點擊無法跳轉的問題
- 統一三語 README 所有圖片路徑為 ./tutorials/ 格式，修正部分語系圖片無法顯示的問題
- 修正 en / ja 版本 Pod 圖片無法顯示的問題
- 修正圖片 alt text 及章節名稱統一
- 更新注意事項：移除 Alpha 標記，支援平台改為 macOS / Linux

## [1.0.1] - 2026-04-03

### 新增
- Sentry webhook 新增支援 unresolved action，issue 被重新標為未解決時也會觸發通知
- Sentry 通知訊息加入 shortId 顯示，方便辨識是哪個 issue

### 修正
- 修復切換瀏覽器分頁或最小化後 WebSocket 斷線不顯示錯誤、無法重連的問題
- 新增頁面可見性偵測，回到頁面時自動檢查連線狀態並重連
- 修復心跳逾時只顯示錯誤但不觸發重連的問題
- 修復重連時 CONNECTING 狀態的舊連線未被正確關閉的問題
- 將斷線原因從 Socket.io 格式更新為原生 WebSocket close code

## [1.0.0] - 2026-04-03

### 新增
- 新增 Webhook Integration，支援自訂 Webhook 端點接收外部 HTTP 請求觸發 Pod 執行
- 新增 Bearer Token 驗證和去重防護
- 新增 Sentry Webhook Integration，支援 Sentry issue.created 事件觸發 Pod 執行
- 完成 i18n 國際化，支援繁體中文、英文、日文三語切換
- AI 決策模型改為每條連線獨立設定（預設 Sonnet）
- 總結模型改為每條連線獨立設定（預設 Sonnet）

### 修正
- 修復刪除 connection line 時偶爾誤報「刪除失敗」的問題
- 修復選擇 pod 後再選 connection line 時 pod 選擇框未消失的問題
- 修復 Multi-instance 模式下多 pathway Pod 佇列死鎖
- 修復 podStore N+1 查詢問題，改用批次查詢與 batchLoadRelations
- 修復 claudeService executeDisposableChat 錯誤處理，程式 bug 不再被靜默吞掉
- 修復 integrationEventPipeline 雙重 Pod 狀態設定問題
- 修復 useEditModal 非空斷言 runtime 風險
- 修復完成後端錯誤訊息 i18n 國際化，所有錯誤改為 i18n key 格式

### 優化
- 優化 settleUnreachablePaths 演算法從 O(N²) 降為 O(N+E)
- 優化 scheduleService tick 為輕量查詢
- 優化 repositorySyncService 改一次性查詢並並行寫入
- 優化 workflowChainTraversal 預載 connection 建 Map 索引
- 優化前端 selectionStore isElementSelected 從 O(N) 改為 O(1) Set 查找
- 強化安全防護：CORS 生產環境移除 ngrok wildcard、Telegram 輸入 sanitize、Repository 名稱字元驗證
- 統一右鍵選單關閉行為，改用 mousedown 捕獲模式取代背景遮罩層
- 刪除正在執行的 Pod 時自動中止 Claude 查詢，避免資源洩漏
- 後端關閉時自動清理：中止活躍查詢、重設 Pod 狀態、刪除執行中的 Run

## [0.9.2] - 2026-03-30

### 新增
- 優化畫布觸控板互動體驗（二指滾動改為平移、捏合改為縮放、Space+左鍵拖拽平移、調整縮放靈敏度）
- 新增 Multi-Instance Run worktree 隔離機制

### 修正
- 升級 Claude Agent SDK 至 0.2.87 修復 CI 型別檢查錯誤與 tool handler 回傳格式
- WebSocket 不再將伺服器內部路徑洩漏到前端

## [0.9.1] - 2026-03-27

### 修正
- 修復排程「每週」模式更改星期幾後仍觸發在舊日期的問題
- 補充排程星期六、星期日的邊界測試案例

## [0.9.0] - 2026-03-27

### 新增
- Jira 綁定 Pod 時新增事件過濾模式選項，支持「所有事件」或「僅狀態變更」事件觸發條件
- Integration App 憑證加密儲存（AES-256-GCM）

### 修正
- 移除根目錄 package.json 中誤加的 test 和 style 腳本
- 立即備份後不再跳「備份已觸發」Toast，改為 Input 右側 spinner 顯示
- 關閉備份並儲存後自動清空 Git Remote URL 及刪除 .git 備份歷史
- Backup 推送自動排除加密金鑰
- 啟動時自動遷移明文憑證並清除 DB 殘留資料
- 備份排程防止同日重複觸發
- 備份時間格式驗證強化
- 刪除 Run 時 Claude SDK 內部錯誤不再導致後端 crash

## [0.8.8] - 2026-03-25

### 修正
- 修正排程觸發 multi-instance Pod 時 canvas mini screen 的訊息顯示問題
- 修正排程觸發時 Run 歷程無法正確顯示 /command 的問題

## [0.8.7] - 2026-03-25

### 修正
- 排程觸發 multi-instance Pod 時正確走 Run 模式

## [0.8.6] - 2026-03-23

### 修正
- 統一歷程 SideBar ScrollBar 為 doodle 風格
- 修正歷程聊天中按 ESC 會同時關閉 Tool Modal 和聊天訊息的問題

## [0.8.5] - 2026-03-20

### 修正
- 排程更新後完整重置觸發狀態
- 排程工具測試在 UTC 時區 CI 環境失敗問題

## [0.8.3] - 2026-03-20

### 新增
- 全域設定新增時區選項（UTC 偏移量下拉選單，預設 UTC+8）
- 排程的 every-day 和 every-week 根據設定的時區觸發
- 前端「下次觸發時間」根據全域時區設定顯示
- 編輯已啟用排程時新增「停用」和「更新」按鈕

### 修正
- 修正排程邏輯與實作一致性，統一時區設定讀取與解析
- 修正新建排程當天 every-day/every-week 不觸發的 bug
- 修正每週排程 Checkbox 勾選無效的 bug

## [0.8.2] - 2026-03-20

### 新增
- Plugin 列表改為按 repo 分組並支援 collapse/expand
- Plugin 子選單 scroll 樣式改為與專案選單風格一致
- Plugin 列表區域加上邊框提升視覺區隔

## [0.8.1] - 2026-03-20

### 新增
- Per-Pod Plugin 管理功能

### 修正
- Pod Plugin Schema 驗證與 UUID 格式驗證
- Plugin 子選單切換邏輯與 timer 洩漏
- Pod 右鍵選單重複行為與視覺區隔

## [0.8.0] - 2026-03-20

### 新增
- 全域 Plugin 管理功能

### 修正
- 全專案程式碼品質改善與重構

## [0.7.6] - 2026-03-19

### 修正
- Run 聊天串流中 content 與 subMessages 不同步
- Run 歷程 Claude 使用工具時 tool badge 不即時顯示
- 後端重傳導致串流文字 delta 計算錯誤
- 歷史訊息載入時多個 subMessage 產生重複 id
- Run 歷程重新載入訊息時 tool 與文字合併成單一氣泡
- Run 歷程中 Claude 回覆文字後使用工具時文字泡泡消失

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
