# Changelog

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
