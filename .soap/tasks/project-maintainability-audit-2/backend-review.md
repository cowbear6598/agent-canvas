# Backend maintainability review

## P1.A Agent provider 與串流核心 review

### P1.A.t1 `streamingChatExecutor.ts` 串流核心職責

- 嚴重度：High
- 位置：`backend/src/services/claude/streamingChatExecutor.ts`
- 問題原因：串流 executor 集中處理 provider stream iteration、assistant/message delta、tool use/result event、取消流程、錯誤分類、DB persistence、WebSocket emit 與 lifecycle cleanup。這些責任目前在同一檔案內互相呼叫，導致 parser、dispatcher、lifecycle coordinator 邊界不清。
- 維護風險：新增 provider event、工具事件或取消語意時，容易同時碰到串流解析、狀態更新、錯誤轉譯與前端事件輸出；若其中一段早退或 throw，cleanup 與 final event 的一致性需要跨檔案閱讀才能確認。
- 可拆分候選：抽出 `StreamEventParser` 將 provider-specific chunk 轉為 domain event；抽出 `ChatStreamDispatcher` 專管 WebSocket/event emit；抽出 `ChatLifecycleCoordinator` 管理 start/complete/error/cancel cleanup；錯誤分類可收斂為 `ProviderErrorClassifier`，讓 executor 只協調流程。

### P1.A.t2 Codex/OpenCode provider 與 alias service 邊界

- 嚴重度：High
- 位置：`backend/src/services/provider/codexProvider.ts:101`、`backend/src/services/provider/codexProvider.ts:311`、`backend/src/services/provider/codexProvider.ts:427`、`backend/src/services/provider/codexProvider.ts:704`
- 問題原因：`codexProvider.ts` 同時負責 image block validation、prompt text 組裝、MCP auto approve/runtime config 參數、CLI args、subprocess lifecycle、stderr collection、exit code 轉 system message 與 provider metadata/options mapping。
- 維護風險：SDK/CLI 參數、安全驗證、MCP 設定與 process lifecycle 在同一 provider 檔案中成長，新增 provider option 或 CLI error 會同時影響 prompt builder、args builder 與 stream output；很難測出單一責任是否正確。
- 可拆分候選：抽 `codexPromptBuilder`、`codexArgsBuilder`、`codexProcessRunner`、`codexOutputNormalizer` 與 `codexOptionMapper`。provider facade 只實作 `AgentProvider` contract 並組合這些 helper。

- 嚴重度：Medium
- 位置：`backend/src/services/provider/opencodeProvider.ts:71`、`backend/src/services/provider/opencodeProvider.ts:89`
- 問題原因：OpenCode provider 已拆出多個 builder/client module，但 provider facade 仍承擔 server state port、client port 建立與 provider export 聚合。命名上 `opencodeProvider.ts` 同時像 barrel file 與 runtime adapter。
- 維護風險：後續新增 OpenCode server lifecycle 或 client retry policy 時，可能繼續塞回 facade，和 Codex provider 的邊界不一致。
- 可拆分候選：保留 `opencodeProvider.ts` 作為純 adapter export，將 server state/client port 建立移到 `opencodePorts.ts` 或 `opencodeClientFactory.ts`，讓 provider facade 與 Codex provider 的 option/execute 邊界更一致。

- 嚴重度：High
- 位置：`backend/src/services/provider/opencodeAliasService.ts:82`、`backend/src/services/provider/opencodeAliasService.ts:269`、`backend/src/services/provider/opencodeAliasService.ts:459`、`backend/src/services/provider/opencodeAliasService.ts:561`、`backend/src/services/provider/opencodeAliasService.ts:730`
- 問題原因：alias service 同時處理 row mapper、thinking preset snapshot fetch、provider config JSON parse、alias usage 查詢、unique constraint 錯誤轉譯、usage log、CRUD transaction、order reorder 與 best-effort broadcast。
- 維護風險：alias domain rule、DB transaction、外部 OpenCode provider snapshot 與 UI-facing error message 被放在同一 service。更新 alias unique 規則或 thinking preset shape 時，容易影響 CRUD、usage guard 與 broadcast 行為。
- 可拆分候選：抽 `opencodeAliasMapper`、`opencodeAliasUsageRepository`、`opencodeAliasPresetFetcher`、`opencodeAliasRepository`、`opencodeAliasPolicy` 與 `opencodeAliasEventPublisher`。service 層只負責 use case orchestration 與 transaction boundary。

## P1.B Workflow 與執行狀態 review

### P1.B.t1 Workflow run、分支與狀態轉換

- 嚴重度：High
- 位置：`backend/src/services/workflow/runExecutionService.ts:142`、`backend/src/services/workflow/runExecutionService.ts:482`、`backend/src/services/workflow/runExecutionService.ts:831`
- 問題原因：`RunExecutionService` 同時負責 run 建立、chain traversal、run repo provisioning、goal runtime 初始化、pod instance 狀態更新、WebSocket 事件、不可達路徑 settlement、run limit 清理、active stream ref-count、刪除與資源回收。`createRun` 內含多層分支與 provisioning error recovery；`settleUnreachablePaths` 內含 graph traversal、狀態決策、DB mutation 與事件 payload 組裝；`deleteRun` 內含 race guard、取消、資源清理與刪除事件。
- 維護風險：run 狀態與事件發送沒有單一狀態機邊界，新增 pod status 或 pathway 規則時，容易漏改 DB update、WebSocket payload、run terminal 判斷或 resource cleanup。`activeRunStreams` 也同時作為 ref-count 與 cancellation guard，後續若加入多 provider 並行或背景 callback，race invariant 需要跨多段程式碼理解。
- 可拆分候選：抽出 `RunCreationCoordinator`（建立 run、建立 pod instance、provisioning recovery）、`RunPathwaySettlementService`（不可達路徑 graph traversal 與 settlement decision）、`RunStatusMachine`（pod status/pathway/run terminal transition 的純決策）、`RunLifecycleCleanupService`（run limit、deleteRun、resource cleanup、abort orchestration）。事件發送可集中到 `RunEventPublisher`，讓 domain service 回傳 transition result 而不是直接組 WebSocket payload。

- 嚴重度：Medium
- 位置：`backend/src/services/workflow/workflowBranchTriggerService.ts:120`、`backend/src/services/workflow/workflowBranchTriggerService.ts:436`、`backend/src/services/workflow/workflowBranchTriggerService.ts:557`
- 問題原因：branch 決策在 `decide` 與 `processBranchConnections` 兩條入口各自處理一次，且 abort 行為、normal mode connection 狀態、run mode pathway settlement、multi-input rejection、pipeline trigger 與事件廣播分散在同一個 service。`processBranchConnections` 的流程雖已拆成 helper，但 helper 仍共同依賴 delegate、store、eventEmitter、pendingTargetStore 與 pipeline。
- 維護風險：branch mode 的 approved/rejected/abort/None path 是一組狀態機，但目前以 imperative orchestration 表達。新增 decision reason、client-safe error 或 multi-input branch 規則時，容易出現 `decide()` 與 `processBranchConnections()` 結果語意不一致，或 normal mode 與 run mode 的狀態 side effect 不一致。
- 可拆分候選：抽出 `BranchDecisionWorkflow` 回傳 `BranchDecisionOutcome`（approved、rejected、aborted、errored）；抽出 `BranchStateApplier` 專門處理 normal mode connection status 與 run mode pathway settlement；保留 `WorkflowBranchTriggerService` 作為 TriggerStrategy adapter。這可讓 branch 狀態轉換以 table-driven state machine 測試。

- 嚴重度：Medium
- 位置：`backend/src/services/workflow/workflowExecutionService.ts:91`、`backend/src/services/workflow/workflowExecutionService.ts:240`、`backend/src/services/workflow/workflowExecutionService.ts:277`、`backend/src/services/workflow/workflowExecutionService.ts:459`
- 問題原因：`WorkflowExecutionService` 同時負責 summary fallback、auto/branch/direct trigger fan-out、busy queue 檢查、connection active 狀態、agent query 啟動、stream lifecycle、completion/error callback、下游 workflow trigger。`triggerWorkflowWithSummary` 把 validation、queue decision、status mutation、strategy callback、active stream registration 與 fire-and-forget query 串在同一條流程。
- 維護風險：佇列、狀態與串流 lifecycle 是不同失敗域。現在 `registerActiveStream` 只在 query promise catch 及 callback 流程間接釋放，若後續新增早退路徑或 provider callback 形狀改變，容易留下 active stream 或未 schedule next queue。`checkAndTriggerWorkflows` 的 Promise.allSettled 也只記錄 rejected，缺少可觀察的 per-trigger outcome。
- 可拆分候選：抽出 `WorkflowTriggerDispatcher`（auto/branch/direct fan-out）、`WorkflowQueueCoordinator`（busy check、enqueue、schedule next）、`WorkflowChatLifecycle`（active stream registration、executeClaudeQuery、completion/error callback）、`SummaryTransferService`（summary fallback 與 transfer message）。`WorkflowExecutionService` 可退化為 orchestration facade，讓 queue 與 chat lifecycle 分別有明確狀態機。

### P1.B.t2 Store、persistence 與 side effect 邊界

- 嚴重度：High
- 位置：`backend/src/services/runStore.ts:360`、`backend/src/services/runStore.ts:442`、`backend/src/services/runStore.ts:558`、`backend/src/services/runStore.ts:607`、`backend/src/services/runStore.ts:666`
- 問題原因：`runStore` 不只是 persistence adapter，也定義 run/pod status union、status set、row mapper、JSON validation、timeline sorting、timestamp 寫入策略、goal-round-divider 組裝與 pagination shape。多個 method 在寫 DB 前建立 domain object 並決定 timestamp 或 terminal semantics。
- 維護風險：domain rule 與 SQL statement 綁在同一層，測試若只 mock store 會跳過狀態與時間語意；若改 DB schema 或 timeline item 型別，也會同時影響 domain mapper 與查詢分頁。狀態集合暴露給 workflow service 使用，等於 store 也是狀態機定義來源。
- 可切分邊界：將 status union/set 與 transition helper 移到 `runDomain.ts` 或既有 `workflowRunDecisions.ts`；將 row mapper、JSON parser 與 timeline sorter 移到 `runPersistenceMapper.ts`；`RunRepository` 只保留 CRUD 與 query；`RunTimelineRepository` 專管 message / goal divider / pagination。時間戳建議由 domain transition result 或 clock dependency 注入，不由 store method 自行決定。

- 嚴重度：Medium
- 位置：`backend/src/services/podStore.ts:78`、`backend/src/services/podStore.ts:161`、`backend/src/services/podStore.ts:202`、`backend/src/services/podStore.ts:448`、`backend/src/services/podStore.ts:642`
- 問題原因：`podStore` 混合 PreparedStatement LRU cache、SQL 白名單、batch relation loading、provider config resolve/sanitize、goal normalize、schedule serialization、workspace path composition、transaction orchestration 與 join table replacement。`create` / `update` 在 store 層執行 validation 與 domain object merge，persistence 與 business rule 邊界不清。
- 維護風險：provider config 或 schedule rule 改動時會觸碰 store；DB loading optimization 與 domain validation 在同一檔，review 難以判斷變更是效能調整還是行為改變。PreparedStatement cache key 與 relation table 白名單也讓 store 變成 query builder 與 repository 的混合體。
- 可切分邊界：抽出 `PodConfigPolicy`（provider resolve/sanitize、goal normalize）、`PodMapper`（row to domain、schedule serialize/parse）、`PodRelationRepository`（join table read/write）、`PreparedStatementCache`（LRU cache 與 SQL statement 建立）。`PodStore` 保留 transaction boundary 與 repository API，create/update 的資料準備可由 domain service 先產生 validated payload。

- 嚴重度：Medium
- 位置：`backend/src/services/workspace/gitService.ts:45`、`backend/src/services/workspace/gitService.ts:109`、`backend/src/services/workspace/gitService.ts:202`、`backend/src/services/workspace/gitService.ts:535`
- 問題原因：`gitService` 混合 Git URL/source detection、token 注入、錯誤訊息轉譯、路徑安全檢查、progress mapping、simple-git 操作、fetch promise de-duplication 與 logger side effect。每個 public method 都同時處理 validation、CLI call、錯誤遮罩與 UI-facing zh-TW message。
- 維護風險：新增 Git provider、調整錯誤訊息或改 progress UI 都會碰到同一 service；token masking 與 authenticated URL 生成若散在 clone/pull/fetch 流程中，容易在新 git operation 漏掉。`syncToRemoteLatest` 的 de-dup cache 與 `_doSyncToRemoteLatest` 的 remote policy 也讓併發控制與 Git domain policy 綁定。
- 可切分邊界：抽出 `GitRemoteAuthService`（source detection、token URL builder）、`GitErrorTranslator`（simple-git error 到 client-safe zh-TW message）、`GitProgressMapper`（stage/progress mapping）、`GitWorkspacePolicy`（path boundary、branch name validation、remote existence policy）、`GitCommandRunner`（simple-git wrapper）。`GitService` 可只協調 use case，回傳 Result 與進度事件。

## P1.C API 與 WebSocket contract review

### P1.C.t1 REST API route table、授權 scope 與文件同步風險

- 嚴重度：High
- 位置：`backend/src/api/apiRouter.ts:53`、`backend/src/api/apiRouter.ts:160`、`backend/src/api/apiRouter.ts:173`、`backend/src/api/apiRouter.ts:206`
- 問題原因：REST API contract 目前集中在 `ROUTES` 手寫陣列，route 的 method、URLPattern、handler 與 `scope` 彼此靠人工維護；`authorizeRoute` 只提供 `public`、`workspace`、`canvas` 三層權限，canvas scope 預設從 `params.id` 解析 canvas，只有額外 `resolveCanvasId` hook 可覆寫。新增 API 時若路徑不使用 `:id`，或 canvas id 來自 query/body，就必須記得補 `resolveCanvasId`，否則會降級成 workspace 檢查後交給 handler，自動化防線不足。`/api/upload`、`/api/auth/redeem-reconnect-grant`、`/api/internal/integration-reply` 也都以 `public` 掛在同一張表，review 時需要逐一追 handler 是否有額外 token、cookie 或內容限制。
- 維護風險：新增或修改 API 時容易漏掉四個同步點：handler import、`ROUTES` entry、授權 scope 或 `resolveCanvasId`、以及專案底下 skill/API 文件。因 `ROUTES` 未 export metadata，也沒有測試或產生器可比對 API 文件，AGENTS.md 要求的「API Router 新增/更新/刪除需同步更新 skill」完全靠人工記憶；route order 也是行為的一部分，未來若加入較寬的 URLPattern，可能因陣列順序造成 handler 對應或授權 scope shadow。
- 改善方向：將 route 定義改成可驗證的 typed manifest，至少包含 `id`、`method`、`pathname`、`handler`、`scope`、`canvasIdSource`、`docRef` 或 `skillDocRequired`。新增測試檢查所有 `scope: "canvas"` 的 route 都能解析 canvas id、所有 `public` route 都列入 allowlist 並有 handler 層驗證說明、所有 route id 都能在 API 文件或 skill metadata 找到對應紀錄。新增 API PR checklist 應固定檢查：route table、handler response shape、授權 scope、CORS/credentials、skill/API 文件同步。

### P1.C.t2 WebSocket handler、payload schema 與 response type contract 風險

- 嚴重度：High
- 位置：`backend/src/handlers/index.ts:20`、`backend/src/handlers/index.ts:22`、`backend/src/handlers/registry.ts:38`、`backend/src/services/eventRouter.ts:20`、`backend/src/services/eventRouter.ts:35`
- 問題原因：WebSocket handler contract 分散在 handler group 檔案、`backend/src/handlers/index.ts` 的 group 註冊、`backend/src/schemas/events.ts` 的 enum、各 payload zod schema、`authGuard` scope 判斷與前端 `frontend/src/types/websocket/events.ts`。`HandlerRegistry` 只是把已註冊 group 轉成 `eventRouter.register`，`EventRouter.register` 使用 `Map#set` 靜默覆蓋同名 event，沒有重複註冊檢查、未註冊 enum 檢查或 enum 但無 handler 的檢查。新增 handler group 若忘了在 `handlers/index.ts` import/register，編譯仍會通過，但 runtime 收到該 event 只會變成未知事件。
- 維護風險：event contract 需要同時維護「request enum -> handler group -> payload schema -> responseEvent -> handler emit payload -> frontend enum/listener」多個檔案，目前沒有單一來源可驗證。實際已看到後端 response enum 使用 `RUN_HISTORY_LOADED` / `RUN_POD_MESSAGES_LOADED`，前端使用 `RUN_HISTORY_RESULT` / `RUN_POD_MESSAGES_RESULT`，雖然 string value 相同但命名漂移；後端有 `INTEGRATION_APP_GET`、`INTEGRATION_APP_RESOURCES` 與其 result event，前端 event 常數缺少對應項；前端保留 `WORKFLOW_ERROR`、`WORKFLOW_BRANCH_PENDING`、`WORKFLOW_BRANCH_RESULT`、`WORKFLOW_BRANCH_ERROR`、`WORKFLOW_BRANCH_CLEAR`，後端 enum 未定義。這類漂移會讓搜尋、重構與 review 誤判 contract 是否存在。
- 改善方向：新增 contract 檢查清單並逐步自動化：所有 `WebSocketRequestEvents` 必須有且只有一個 registered handler；所有 handler group event 必須存在於 request enum；每個 handler definition 必須指定 zod schema 與合法 response enum；`authGuard` 的 public/workspace/canvas scope 必須覆蓋特殊事件且與 payload 的 `canvasId` 來源一致；後端與前端 event 常數的 key/value 必須可 diff；response payload shape 應以共享型別或 schema 導出，避免 handler emit 與前端 listener 各自猜測。短期可先加一個 registry introspection 測試，暴露 handler manifest 後比對 `backend/src/schemas/events.ts`、`backend/src/services/auth/authGuard.ts` 與 `frontend/src/types/websocket/events.ts`。

## P2.A 低價值測試候選分類

### P2.A.t1 `safeJsonParse.test.ts` 測例分類

#### 刪除候選：純 `JSON.parse` 成功路徑與泛型型別推斷

- 位置：`backend/tests/business-logic/safeJsonParse.test.ts:5`、`backend/tests/business-logic/safeJsonParse.test.ts:10`、`backend/tests/business-logic/safeJsonParse.test.ts:15`、`backend/tests/business-logic/safeJsonParse.test.ts:20`、`backend/tests/business-logic/safeJsonParse.test.ts:25`、`backend/tests/business-logic/safeJsonParse.test.ts:43`
- 分類理由：物件、陣列、字串、數字、boolean、null 與泛型屬性讀取主要驗證 `JSON.parse` 原生行為與 TypeScript 泛型標註，不是本專案邏輯。泛型測例在 runtime 不會驗證 schema，也無法保證解析結果符合 `User`。
- 建議處理方式：刪除大部分成功路徑測例，最多保留一個 smoke test 確認合法 JSON 會原樣回傳。若需要型別安全，應改為呼叫端使用 zod/schema guard 的 contract 測試，而不是在 `safeJsonParse<T>()` 測泛型。

#### 保留候選：錯誤路徑不 throw 並回傳 null

- 位置：`backend/tests/business-logic/safeJsonParse.test.ts:33`、`backend/tests/business-logic/safeJsonParse.test.ts:38`、`backend/tests/business-logic/safeJsonParse.test.ts:42`
- 分類理由：`safeJsonParse` 的專案價值是把 JSON parse error 轉成 `null`，讓呼叫端可以在 DB JSON 欄位、provider config 或 payload parse 失敗時走 fallback。這是本專案的錯誤處理 contract，應保留。
- 建議處理方式：改成 table-driven 測試，覆蓋亂碼、空字串、未閉合 JSON；若呼叫端需要保留錯誤原因，應新增 Result 型 helper 測試，而不是擴充這個 null-return helper。

### P2.A.t2 DB schema 與 model alias 測試價值

#### 保留候選：真實 SQLite schema 約束、CASCADE 與 relation table contract

- 位置：`backend/tests/database/schema.test.ts:19`、`backend/tests/database/schema.test.ts:87`、`backend/tests/database/schema.test.ts:158`、`backend/tests/database/model-aliases.test.ts:107`、`backend/tests/database/model-aliases.test.ts:116`
- 分類理由：這些測例使用真實 SQLite memory DB 驗證 cascade delete、多對多 relation、unique constraint 與 statement 行為，是資料契約測試，不是單純 mock。它們能抓到 migration/schema/statement 變更造成的資料破壞，應保留。
- 建議處理方式：保留並補上更明確的資料契約命名；constraint 測試可改成確認錯誤類型或 message 包含 UNIQUE 欄位，避免只用 `toThrow()` 掩蓋錯誤來源。

#### 改寫候選：Prepared Statements CRUD 過度覆蓋 statement wrapper 細節

- 位置：`backend/tests/database/schema.test.ts:127`、`backend/tests/database/schema.test.ts:214`、`backend/tests/database/schema.test.ts:246`、`backend/tests/database/model-aliases.test.ts:31`、`backend/tests/database/model-aliases.test.ts:68`、`backend/tests/database/model-aliases.test.ts:94`
- 分類理由：部分測例逐一測 insert/select/update/delete statement 是否能操作單表，接近驗證 SQL wrapper 有被建立。這有 smoke value，但若每張表都以相同 CRUD 模式展開，維護成本會隨 statement 數量線性增加，且不一定覆蓋 domain repository 使用方式。
- 保留條件：涉及排序、unique、cascade、join table 或 backward-compatible default 的測例保留；純「insert 後 select 出同欄位」可改成 repository/domain 層測試或單一 schema smoke。
- 建議處理方式：將 statement CRUD 測試縮成「schema + statements 可初始化並完成代表性 canvas/pod/connection 流程」；model alias 保留排序與唯一性，刪減單純 delete 後少一筆這類薄測例，或改由 `opencodeAliasService` use case 測試覆蓋。

## P2.B Mock 邊界與大型測試 review

### P2.B.t1 `claudeProviderBuildOptions.test.ts` mock 邊界

#### 保留候選：SDK/provider wrapper、MCP reader、integration registry 與 managed MCP surface mock

- 位置：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:16`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:20`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:39`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:78`
- 分類理由：`buildOptions` 的責任是把 Pod 設定、MCP surface、integration reply server 與 Claude SDK options 組成 provider boundary payload。mock `readClaudeMcpServers`、`integrationRegistry`、managed MCP service 與 `createSdkMcpServer` 是合理邊界，因為它們代表外部設定檔、integration provider 與 SDK 物件建立。
- 建議處理方式：保留這些 boundary mock，但將 repeated mock setup 收斂成 fixture builder，例如 `givenManagedMcpEntries()`、`givenIntegrationReplyProvider()`，讓每個測例只描述輸入能力與期望的 provider option。

#### 改寫候選：只驗證 mock 組裝輸出的細碎測例

- 位置：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:172`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:201`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:229`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:276`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:329`
- 分類理由：多個測例以手工 Pod stub 與 mock 回傳值驗證 `options.mcpServers`、`allowedTools`、`model` 等欄位。這些有 contract value，但目前粒度偏細，容易在 option builder 重構時大量破裂，且部分測例只確認 mock dependency 是否被呼叫。
- 建議處理方式：改成 table-driven provider option contract：空 Pod、local MCP、managed run MCP、integration reply、多能力組合各一筆。對 `readClaudeMcpServers` / `buildPodMcpEntries` 的 call assertion 只保留用來固定 fallback 順序的測例，其餘以輸出 options 與 client-safe behavior 為主。

### P2.B.t2 `opencodeProvider.test.ts` 與 `streamingChatExecutor.test.ts` 高 mock 密度

#### 改寫候選：`opencodeProvider.test.ts` 可拆成 stream normalizer、client boundary integration、server lifecycle 三層

- 位置：`backend/tests/business-logic/opencodeProvider.test.ts:67`、`backend/tests/business-logic/opencodeProvider.test.ts:98`、`backend/tests/business-logic/opencodeProvider.test.ts:132`、`backend/tests/business-logic/opencodeProvider.test.ts:872`、`backend/tests/business-logic/opencodeProvider.test.ts:1366`、`backend/tests/business-logic/opencodeProvider.test.ts:1838`
- 分類理由：同一檔案同時測 v2 event normalization、session create/prompt/abort、server state factory、transient server startup、goal runtime MCP entries、stream cleanup 與 error mapping；大量 `makeMockClient` + `setOpencodeClientFactory` 讓測試更像 provider internals script。它保留了有價值的 client port boundary mock，但檔案大小與 mock 組合密度讓失敗時難快速定位是 normalizer、client lifecycle 還是 server lifecycle。
- 建議處理方式：拆成三組測試：`opencodeStreamNormalizer.test.ts` 用純 event fixture 測 v2 事件轉 `NormalizedEvent`；`opencodeProviderClientBoundary.test.ts` 用 fake `OpencodeClientPort` 測 session/prompt/abort/cleanup；`opencodeProviderServerLifecycle.test.ts` 測 server state/transient server startup 與 error。共享 SSE event fixture 與 client fixture，避免每個 case 重寫 client shape。

#### 保留並收斂候選：`streamingChatExecutor.test.ts` 已用真 DB/store，但 provider 與 side-effect spy 仍需分層

- 位置：`backend/tests/business-logic/streamingChatExecutor.test.ts:16`、`backend/tests/business-logic/streamingChatExecutor.test.ts:219`、`backend/tests/business-logic/streamingChatExecutor.test.ts:223`、`backend/tests/business-logic/streamingChatExecutor.test.ts:298`、`backend/tests/business-logic/streamingChatExecutor.test.ts:956`、`backend/tests/business-logic/streamingChatExecutor.test.ts:1376`
- 分類理由：此檔已比純 mock 更有價值：用真 SQLite、真 store、spy side effect 觀察 WebSocket emit 與 run lifecycle。但它仍集中大量 provider event、goal runtime、abort、error path 與 pod-not-found 情境；同一 setup mock `getProvider`、runStore spy 與 socket spy 適用所有 case，新增行為容易讓 unrelated tests 共享脆弱 fixture。
- 建議處理方式：保留 executor boundary 測試，但拆出 shared `givenRunningRunWithPod()`、`givenProviderEvents()`、`expectCanvasEvents()` fixture；將 provider event parser 的細節移到 provider normalizer 測試，executor 只測 lifecycle contract：start/partial/complete/error/abort/persist/emit 的狀態結果。pod-not-found 與 client-safe error 可獨立成 error contract test。

## P2.C 全域測試設定 review

### P2.C.t1 `backend/tests/setup/testConfig.ts` console 靜音設定

#### Finding C1: 全域覆寫所有 console 方法會讓 warning/error regression 從 CI 消失

- 嚴重度：High
- 位置：`backend/tests/setup/testConfig.ts:8`、`backend/tests/setup/testConfig.ts:9`、`backend/tests/setup/testConfig.ts:10`、`backend/tests/setup/testConfig.ts:11`、`backend/tests/setup/testConfig.ts:12`、`backend/tests/setup/testConfig.ts:13`
- 問題原因：setupFiles 最早期直接把 `console.log/error/warn/info/debug` 全部改成 no-op，後續即使 service 在測試中產生 unexpected error、unhandled branch warning、schema fallback warning 或 resource cleanup warning，也不會在測試輸出中出現，更不會讓測試失敗。
- 維護風險：後端測試大量使用真 DB、WebSocket service spy、provider mock 與 async stream；若某條非預期錯誤只透過 console 或 logger 呈現，CI 仍可能全綠。這與「測試有效性 review」目標衝突，因為測試可能只驗證主要 assertion，卻吞掉背景錯誤。
- 應浮出的訊號：`console.error` 預設應使測試失敗；`console.warn` 中包含 unhandled rejection、resource leak、missing handler、unknown event、schema validation fallback、DB constraint fallback、provider/server unavailable 非預期訊息時應失敗；`console.info/debug/log` 可以繼續靜音或只在失敗時輸出。
- 允許靜音條件：個別測試若正在驗證 logger 或錯誤路徑，應用 scoped helper 允許特定訊息 pattern，並在 afterEach 驗證沒有未預期訊息。不要在全域 setup 永久 no-op `console.error` / `console.warn`。
- 建議處理方式：改成 console fail-fast guard，保留原 console 方法並在 `afterEach` 檢查 unexpected warn/error；logger mock 可繼續避免噪音，但應讓 `logger.error` 也能被測試 opt-in 驗證。`process.setMaxListeners(50)` 對 listener warning 只是提高門檻，若仍出現 MaxListeners warning 應視為測試資源清理問題而非背景噪音。

## P2.B Mock 邊界與大型測試 review

### P2.B.t1 `claudeProviderBuildOptions.test.ts` mock 邊界

- 保留：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:16`、`:20`、`:26`、`:53`、`:78` 的 mock 多數位於外部或 provider wrapper 邊界：Claude MCP reader、integration registry/reply context、managed MCP surface service 與 `@anthropic-ai/claude-agent-sdk` 的 `createSdkMcpServer` / `tool`。這些 mock 讓測試能固定 SDK 物件形狀與本機 `~/.claude.json` / managed MCP registry 的輸入，屬於必要 boundary mock。
- 保留：`:239`、`:307`、`:341`、`:376`、`:395`、`:509` 的測例驗證 `buildOptions` 對 run/chat 模式、managed MCP entries、HTTP proxy bridge、legacy fallback、integration reply server、`allowedTools` 與 default options 的輸出 contract。這些斷言不是只測 mock 本身，而是檢查 provider options 對 Claude SDK 的輸出形狀，建議保留。
- 改寫候選：`:207` 的 `pod.mcpServerNames` 測例同時斷言 `readClaudeMcpServers` 被呼叫與 `mcpServers` 形狀；呼叫次數與 fallback merge 是實作細節，價值較低。建議保留輸出 contract，將 `toHaveBeenCalled` 降為必要時只在 fallback 行為測例中驗證。
- 改寫候選：`:450`、`:472` 的 invalid integration 測例目前主要透過 mocked registry 回傳 `undefined` 或缺 `sendMessage`，再確認沒有 mcp allowed tool。這仍有錯誤路徑價值，但可改成 table-driven policy test，聚焦「不可回覆的 integration 不應暴露 reply tool」，避免重複建大型 provider stub。
- 刪除或合併候選：`:199` 的 model override 測例目前輸入與預期都使用 `"sonnet"`，與空 Pod default model 一樣，無法證明 override 真的生效。應改成與 default 不同的 model，或併入多能力組合測例；若 provider 只支援單一模型，這個測例可刪除。
- 共享 fixture 候選：`makePod`、integration provider stub、managed MCP `entries` payload、reply server entry 可抽成 `tests/fixtures/providerOptions.ts` 類型 helper，讓測例只描述差異輸入與預期 contract。這比每個測例手寫 mock setup 更能降低 mock 組裝輸出被誤當業務行為的風險。

### P2.B.t2 `opencodeProvider.test.ts` 與 `streamingChatExecutor.test.ts` 高 mock 密度

- 保留：`backend/tests/business-logic/opencodeProvider.test.ts:465` 到 `:1805` 的 chat 測例大多以 `OpencodeClientPort`、server state factory、transient server factory 為 mock 邊界，驗證 session create/prompt/subscribe、resume、session filtering、idle completion、auth/server error classification 與 abort cleanup。這些是 provider adapter 的外部 SDK boundary，應保留。
- 改寫候選：`opencodeProvider.test.ts:609` 與 `:682` 直接測 `normalizeOpencodeStream` 的 fake provider stream，價值高於只看 mock call，適合擴充為 shared fixture：提供 `session.next.*`、`message.part.delta`、tool success/failed、idle、unrelated session 的事件序列 fixture，讓 provider chat 測例與 normalizer 測例共用同一批 event builders。
- 改寫候選：`opencodeProvider.test.ts:1836`、`:1965` 的 Goal Runtime bootstrap / transient server 測例同時 mock client、server factory、stream 與 prompt call，斷言大量 SDK config shape。這類測例應拆成 provider boundary integration：用 fake `OpencodeClientPort` 收集 prompt/config outcome，但把 MCP entry 到 opencode config 的 mapping 抽成純 mapper 單測；provider chat 測例只保留「entries 非空時會建立 transient server 並送出 prompt」的行為。
- 保留但瘦身：`backend/tests/business-logic/streamingChatExecutor.test.ts:19` 的 `getProvider` mock 是必要 provider boundary；`:223` 到 `:249` 的 `socketService`、`runExecutionService`、`runStore` spy 則是 side-effect 觀察。測試已使用 `initTestDb` 與真實 store，比完全 mock store 更接近 integration，方向正確。
- 高 mock 密度候選：`streamingChatExecutor.test.ts:512` 到 `:1223` 的 Goal Runtime / gate 測例需要 provider stream、DB row、runtime snapshot、divider persist/broadcast order、callback order 多層 fixture。建議把 `insertClaudePod`、`setupProviderMock`、goal tool result event、divider spy、snapshot reader 抽成 shared fixture，並以少量 end-to-end executor 測例覆蓋「完成、blocked、未推進 force_block、fatal error 不 retry」四條 user-visible branch。
- 改寫候選：`streamingChatExecutor.test.ts:1223` 到 `:1371` 的 abort 測例混用 provider mock、abort registry、callback spy 與 session id side effect。可保留一個 executor integration 測 abortable=true 的完整路徑，另將 AbortError 判斷與 break-style abort 分流抽成純 decision helper 測試，降低每個 abort case 都要組 full executor 的成本。
- 低價值風險：`streamingChatExecutor.test.ts:1766`、`:1793`、`:1831` 的 Run mode lifecycle 測例以 `registerActiveStream` / `unregisterActiveStream` call order 驗證 side effect，能防 regression 但容易和實作細節綁死。若後續抽 `ChatLifecycleCoordinator`，建議改成 coordinator contract test，executor integration 只驗證 terminal result、run message 與 pod instance status outcome。
- shared fixture 建議：建立 `tests/fixtures/providerStream.ts`、`tests/fixtures/opencodeClient.ts`、`tests/fixtures/goalRuntime.ts`，提供 typed builders：`textEvent`、`toolResultEvent`、`turnComplete`、`opencodeSessionIdle`、`makeMockOpencodeClient`、`makeGoalPod`、`expectRunMessageEmitted`。這可把高 mock 密度測例從「組 mock 呼叫序列」改成「描述 provider boundary 輸入與 domain observable output」。

## P2.A 低價值測試候選分類

### P2.A.t1 `safeJsonParse.test.ts` 刪除、保留、改寫分類

- 刪除候選：`backend/tests/business-logic/safeJsonParse.test.ts:4` 到 `:28` 的合法 object、array、string、number、boolean、null 測例大多只驗證 `JSON.parse` 對標準 JSON literal 的原生行為。若 `safeJsonParse` 的 contract 只是「成功時回傳 parse 結果，失敗時回 null」，這些測例可合併成一個 table test，避免把 JSON runtime 行為當成專案邏輯重複測。
- 保留：`:31` 到 `:42` 的不合法 JSON、空字串、未閉合括號測例應保留，因為它們驗證本專案 wrapper 的核心契約：parse 失敗不可 throw，必須回傳 `null`。這是 safe wrapper 的差異化價值。
- 改寫候選：`:45` 到 `:54` 的泛型型別推斷測例在 runtime 只證明 object 欄位可讀，無法驗證 TypeScript 泛型是否真的安全；泛型在編譯期會被擦除。若要保留型別 contract，建議移到 type-level test 或用 `expectTypeOf`；若專案不跑 type assertion 測試，這段可刪除。
- 保留條件：若未來 `safeJsonParse` 增加 reviver、schema validation 或 fallback default，才需要重新展開成功路徑測例。現況建議保留 3 類：valid object smoke、invalid syntax returns null、不 throw；其餘純 JSON literal 測例合併。

### P2.A.t2 DB schema 與 model aliases 測試有效性

- 保留：`backend/tests/database/schema.test.ts:17` 到 `:89` 的 cascade delete 測試驗證 SQLite foreign key / join table 清理契約，屬於真實資料契約，不是單純測 prepared statement。`integration_bindings`、`connections`、`notes`、`pod_plugin_ids` 都有跨表刪除風險，建議保留。
- 保留：`schema.test.ts:93` 到 `:260` 的 prepared statement CRUD、pod 多對多、connection、note 測試驗證產生出的 statement 形狀與 DB schema 可實際協作。這類測試能捕捉 migration / statement mismatch，屬於產生檔與 schema 的整合契約。
- 改寫候選：`schema.test.ts` 多處使用 raw SQL seed 與 count query 重複樣板，建議抽 `insertCanvas`、`countTable`、`expectTableEmpty` fixture；測試意圖保留，但降低新增表時的樣板成本。
- 保留：`backend/tests/database/model-aliases.test.ts:35`、`:58`、`:80`、`:91`、`:101`、`:119`、`:130` 分別驗證排序、update order、delete、unique constraint、空集合 max order 與最大值。這些都對應 model alias repository 的資料契約，應保留。
- 改寫候選：`model-aliases.test.ts:91` 與 `:101` 只斷言 `toThrow()`，沒有確認錯誤來自預期 UNIQUE 約束。建議改成檢查 SQLite constraint message 或封裝 repository error code，避免其他 insert error 也讓測試誤過。
- 可刪除候選：若 `schema.test.ts` 的 prepared statement CRUD 已由 repository/service integration 覆蓋，單純 canvas `insert/select/update/delete` 的 smoke test 可降級或移到 statement generator 測試；但在目前缺少 manifest diff 的情況下，建議先保留。

## P2.C 全域測試設定 review

### P2.C.t1 `backend/tests/setup/testConfig.ts` console 靜音風險

- 嚴重度：High
- 位置：`backend/tests/setup/testConfig.ts:9` 到 `:14`
- 問題原因：setup 在最早期直接把 `console.log`、`console.error`、`console.warn`、`console.info`、`console.debug` 全部覆寫成 no-op。這會讓測試過程中的未預期 warning/error 消失，即使某個測例實際觸發 logger 或 runtime warning，也不會在失敗時浮出。
- 維護風險：provider、WebSocket、DB lifecycle、unhandled warning 或 deprecation 訊息可能被完全吞掉；當測試只靠 mock call count 或 snapshot 狀態時，警訊不會被 review 看到。尤其目前 backend 測試大量依賴 SDK/provider mock，console 靜音會掩蓋 mock 未覆蓋真實邊界時的錯誤線索。
- 應浮出的訊號：`console.error`、`console.warn`、logger `error` / `warn`、unhandled rejection、EventEmitter leak warning、DB constraint warning、provider SDK error classification warning。這些訊號至少應在測試失敗時回放，或在未被測例明確允許時讓測試失敗。
- 改善方向：改成 capture-and-fail policy：預設收集 console warning/error，測試結束若有未 allowlist 的 warning/error 就 fail；需要靜音的已知 noisy 測例用 helper 明確包住，例如 `expectConsoleWarning(() => ..., /known warning/)`。`logger` mock 可保留避免污染輸出，但應提供 `logger.warn/error` 呼叫紀錄斷言與 afterEach 檢查。

## P3.A 後端結論與優先序

### P3.A.t1 後端 maintainability findings 優先序

1. High：拆分 `backend/src/services/claude/streamingChatExecutor.ts`。問題原因是 stream parser、event dispatcher、Goal Runtime gate、abort/error lifecycle、DB persistence 與 WebSocket emit 集中在同一 executor；維護風險是 provider event 或 Goal gate 任一變更都可能破壞 cleanup、callback order 或 transcript。建議先抽 `StreamEventParser`、`ChatStreamDispatcher`、`ChatLifecycleCoordinator`，讓 executor 只協調流程。
2. High：拆分 `backend/src/services/workflow/runExecutionService.ts`。問題原因是 run creation、chain traversal、pathway settlement、pod instance transition、event publish、cleanup 與 delete race guard 混在同一 service；維護風險是 run status、pathway status、pod status 無單一狀態機。建議先落地 `RunStatusMachine` 與 `RunEventPublisher`，再逐步拆 `RunCreationCoordinator`、`RunPathwaySettlementService`。
3. High：收斂 REST/WebSocket contract manifest。`backend/src/api/apiRouter.ts`、`backend/src/handlers/index.ts`、`backend/src/services/eventRouter.ts`、`backend/src/schemas/events.ts` 與前端 event type 目前靠人工同步；維護風險是新增 route/event 時漏授權、漏 handler、漏 skill/API 文件。建議建立 typed manifest 與 registry introspection test，固定檢查 route scope、handler enum、payload schema、response event 與前端 event key/value。
4. High：改善 `backend/tests/setup/testConfig.ts` 的 console 靜音。問題原因是全域 no-op console 會吞掉 warning/error；維護風險是 provider mock、DB lifecycle 或 EventEmitter leak 的預警不會浮出。建議改為 capture-and-fail，只有測例明確 allowlist 的 warning/error 可通過。
5. Medium：拆分 `backend/src/services/provider/codexProvider.ts` 與 `backend/src/services/provider/opencodeAliasService.ts`。Codex provider 同時組 prompt、CLI args、process lifecycle、MCP config 與 output normalizer；alias service 同時處理 mapper、repository、policy、usage 與 broadcast。建議以 provider facade + mapper/repository/policy/event publisher 分層。
6. Medium：拆分 store/persistence 邊界。`backend/src/services/runStore.ts`、`backend/src/services/podStore.ts`、`backend/src/services/workspace/gitService.ts` 都混合 persistence、domain validation、資料轉換與 side effect。建議先抽 mapper/policy/error translator，讓 repository API 與 domain service 的責任更清楚。

### P3.A.t2 後端測試刪除、改寫、保留清單

- 刪除候選：`backend/tests/business-logic/safeJsonParse.test.ts` 中純 JSON literal 成功路徑的多個測例，以及泛型型別推斷 runtime 測例。判準：只鏡射語言/runtime 行為、沒有驗證專案差異化 contract。
- 刪除或合併候選：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts` 中 model override 與 default model 使用同值的測例。判準：輸入與預期無法證明 override 行為，容易形成假覆蓋率。
- 改寫候選：`claudeProviderBuildOptions.test.ts` 的 invalid integration 與 fallback call count 測例。判準：有錯誤路徑價值，但目前過度依賴 mock 呼叫與大型 provider stub；應改為 table-driven policy 或輸出 contract 測試。
- 改寫候選：`backend/tests/business-logic/opencodeProvider.test.ts` 的 transient server / Goal Runtime bootstrap 高 mock 測例。判準：跨多個外部 boundary，應將 MCP config mapper 抽為純函式測試，provider integration 只保留 observable behavior。
- 改寫候選：`backend/tests/business-logic/streamingChatExecutor.test.ts` 的 Goal gate、abort、run lifecycle 大型測例。判準：目前能防 regression，但 mock/spy 密度高；應抽 shared fixture 與 lifecycle coordinator contract test，減少 executor 測例對實作呼叫序列的綁定。
- 保留：`safeJsonParse` 的 invalid JSON returns null / not throw 測例。判準：驗證專案 wrapper 的錯誤契約。
- 保留：`backend/tests/database/schema.test.ts` 的 cascade delete、join table、prepared statement 與 `backend/tests/database/model-aliases.test.ts` 的排序、unique constraint、max order 測例。判準：驗證真實 DB schema、statement shape 與資料契約。
- 保留：`opencodeProvider.test.ts` 對 `OpencodeClientPort`、server state factory、session stream event 的 provider boundary 測例。判準：mock 邊界停在外部 SDK adapter，斷言 normalized provider events 與 user-visible error classification。
- 保留但瘦身：`streamingChatExecutor.test.ts` 以 initTestDb + 真實 store 驗證 transcript、socket emit、Goal Runtime snapshot 與 run state 的 integration 測例。判準：測到跨 service 使用者可觀察結果，但需要 fixture 化降低維護成本。

## P2.A 低價值測試候選分類

### P2.A.t1 `safeJsonParse.test.ts` 分類

- 刪除候選：`解析合法 JSON 物件字串應回傳正確物件`、`解析合法 JSON 陣列字串應回傳正確陣列`、`解析合法 JSON 字串純量值應回傳正確值`、`解析合法 JSON 數字純量值應回傳正確值`、`解析合法 JSON boolean 純量值應回傳正確值`、`解析合法 JSON null 應回傳 null`。這六個 case 只驗證 `JSON.parse` 對合法 JSON 的原生行為，沒有覆蓋專案額外契約；保留會增加測試數量但不降低改壞風險。
- 刪除候選：`使用泛型型別應能正確推斷回傳型別`。`safeJsonParse<T>` 的實作只是 `JSON.parse(jsonString) as T`，泛型不做 runtime validation；測試中的 `result?.id` / `result?.name` 只是 TypeScript 編譯期型別提示與合法 JSON parse 結果，無法證明資料契約安全。
- 保留候選：`解析不合法 JSON 字串應回傳 null，不應 throw`、`解析空字串應回傳 null`、`解析未閉合括號應回傳 null`。這三個 case 覆蓋 `safeJsonParse` 相對 `JSON.parse` 的核心契約：invalid input 不向呼叫端 throw，而是回傳 `null`，這會影響 `podStore`、`runStore`、`GenericNoteStore`、CLI 與 message serializer 的 fallback 行為。
- 改寫候選：將保留的錯誤路徑壓縮成 table-driven 測試，並補一個「呼叫端以 `??` fallback 接住 `null`」的低階 utility contract，避免每種合法 JSON 都各寫一個 case。若未來要宣告 schema validation，應改由 zod/schema 測試負責，不應讓 `safeJsonParse<T>` 測試暗示泛型能保證 runtime shape。

### P2.A.t2 `schema.test.ts` 與 `model-aliases.test.ts` 分類

- 保留候選：`schema.test.ts` 的 cascade delete 測試。`刪除 canvas 時應連帶刪除所有子資料` 與 `刪除 pod 時應連帶刪除多對多關聯及 integration_bindings` 驗證真實 SQLite schema 的 `ON DELETE CASCADE` 行為，涵蓋 `pods`、`integration_bindings`、`connections`、`notes`、`pod_plugin_ids` 等表；這是 DB 約束契約，不是單純 statement wrapper 測試。
- 改寫候選：`schema.test.ts` 的 prepared statements CRUD 區塊目前把 canvas、pod relation、connection、note、global_settings 都放在同一檔大型 smoke test。這些 case 有保留價值，因為它們驗證 `backend/src/database/statements.ts` 的參數名稱、查詢排序與 INSERT/UPDATE/DELETE shape；但建議依資料域拆成 `canvasStatements.test.ts`、`podRelationStatements.test.ts`、`connectionStatements.test.ts`、`noteStatements.test.ts`、`globalSettingsStatements.test.ts`，每檔只保留會被 store/service 依賴的 statement contract。
- 刪除候選：`schema.test.ts` 中只重複驗證單筆 insert 後 select 回相同欄位、且沒有 DB 約束或排序語意的欄位 mirror 斷言可縮減。例如 canvas CRUD 可保留 `insert/select/update/delete` 主路徑，但不需要逐欄驗證 SQLite 已寫入相同 primitive 值；重點應放在 prepared statement 命名與 repo-facing result shape。
- 保留候選：`model-aliases.test.ts` 的 `insert 後依 order_idx 升序 list 出來`、`同一 provider_id 內 alias 重複時 DB 拋 UNIQUE 違反錯誤`、`同一 provider_id + real_provider + real_model 重複時 DB 拋 UNIQUE 違反錯誤`、`selectMaxOrderIdxByProviderId` 空表與有資料情境。這些測試對應 `model_aliases` 的排序、唯一約束、append order 計算，是 OpenCode alias UI 與 `opencodeAliasService` 依賴的實際資料契約。
- 改寫候選：`model-aliases.test.ts` 的 `update alias 與 order_idx 後 list 結果對應更新`、`delete 後 list 少一筆` 應與 service 層 alias reorder/delete 行為對齊，改成驗證 handler/service 實際會呼叫的資料契約，例如更新後 `updated_at`、`real_model` 或 thinking preset 欄位是否維持正確，而不是只測 SQL update/delete 可以運作。
- 刪除候選：`model-aliases.test.ts` 內純 CRUD wrapper 的 row count 斷言可縮減，尤其是 delete 後只確認 list 少一筆的 case。若同一行為已由 `opencodeAliasService` 或 handler 測試覆蓋，DB 層只需保留 unique constraint、排序與 max order 這類「只有真實 SQLite 才能可靠驗證」的契約。

## P2.B Mock 邊界與大型測試 review

### P2.B.t1 `claudeProviderBuildOptions.test.ts` mock 邊界

#### 保留候選：provider wrapper 外部邊界 mock

- 位置：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:16`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:20`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:39`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:78`
- 分類理由：`readClaudeMcpServers`、`integrationRegistry`、`managedMcpSurfaceService` 與 `@anthropic-ai/claude-agent-sdk` 都是 provider option builder 的外部邊界。這些 mock 讓測試可以固定「Pod 設定 -> ClaudeOptions」的輸出 contract，不需要啟動真實 SDK、MCP bridge 或 integration registry。
- 保留條件：mock 應維持在 port/interface 層，不要 mock `buildClaudeOptions` 內部 helper；測例應斷言輸出的 `mcpServers`、`allowedTools`、`permissionMode`、`model` 與 managed MCP entry，而不是斷言每個 helper 被呼叫幾次。
- 建議處理方式：保留 provider wrapper mock，但把重複的 `makePod` / `mockManagedMcpSurfaceService.buildPodMcpEntries` setup 收斂成 fixture builder，並以 table-driven 測試描述「無 MCP」、「傳統 claude.json MCP」、「managed MCP」、「integration binding」四種 contract。

#### 改寫候選：只驗證 mock 組裝輸出的測例應提高到 option contract

- 位置：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:207`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:239`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:307`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:341`
- 分類理由：這些測例大致有效，但部分斷言同時檢查 mock function 被呼叫與輸出欄位，容易讓測試綁住 implementation detail。例如 `readClaudeMcpServers` 在 managed MCP 已涵蓋同名 entry 時仍被呼叫，這是 fallback merge 的目前實作，不一定是使用者可觀察契約。
- 維護風險：若 provider option builder 改成先查 managed registry 再 lazy 讀 claude.json，輸出 contract 沒變但 `readClaudeMcpServers` 呼叫次數會改變，測試會失敗。這類失敗不能有效指出使用者行為壞掉。
- 建議處理方式：將呼叫次數斷言限縮在「必須讀外部設定檔」的錯誤或相容情境；一般成功路徑只驗證 `ClaudeOptions` 的最終 shape。若需要確保 fallback 不漏讀，另寫一個 `applyMcpServers` 純函式測試。

#### 刪除候選：過度接近預設值鏡射的基礎欄位測試

- 位置：`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:177`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:199`、`backend/tests/business-logic/claudeProviderBuildOptions.test.ts:230`
- 分類理由：空 Pod 回傳 default option、`providerConfig.model` 覆寫 model、空 `mcpServerNames` 回傳 undefined 都是可保留的 smoke contract，但目前逐欄驗證 `BASE_ALLOWED_TOOLS`、`settingSources`、`permissionMode` 與 `includePartialMessages` 容易退化成 metadata/defaultOptions 鏡射。
- 建議處理方式：保留一個「最小 Claude Pod 可建出可用 options」smoke case，其他預設值可移到 provider metadata contract 測試；builder 測試專注於 Pod 設定、runContext 與外部能力如何影響 options。

### P2.B.t2 `opencodeProvider.test.ts` 與 `streamingChatExecutor.test.ts` 高 mock 密度

#### 保留候選：Opencode client port 與 server state factory 是合理 boundary mock

- 位置：`backend/tests/business-logic/opencodeProvider.test.ts:42`、`backend/tests/business-logic/opencodeProvider.test.ts:107`、`backend/tests/business-logic/opencodeProvider.test.ts:242`、`backend/tests/business-logic/opencodeProvider.test.ts:1563`
- 分類理由：`setOpencodeClientFactory`、`setOpencodeServerStateFactory` 與 `setOpencodeServerFactory` 注入的是本專案定義的 port，而不是直接 mock SDK 深層實作。這讓測試能用 v2 event 序列固定 provider boundary 的 normalized events、session lifecycle、auth/server error classification 與 abort cleanup。
- 保留條件：這些測例應保留在 provider boundary 層，輸入是 opencode client event，輸出是 `NormalizedEvent` 或 client-safe error。避免在同一測例同時驗證 transient server config、prompt text、abort race 與 event normalize，降低失敗定位成本。
- 建議處理方式：拆成三組 fixture：`opencodeEventFixture`、`opencodeClientFixture`、`opencodeServerFixture`。主測例用 fixture 名稱描述使用者/contract 情境，細節留在 builder，避免 2000 行測試檔繼續膨脹。

#### 改寫候選：`streamingChatExecutor.test.ts` 的大型整合單元測試需要 shared fixture 與 reducer 邊界

- 位置：`backend/tests/business-logic/streamingChatExecutor.test.ts:19`、`backend/tests/business-logic/streamingChatExecutor.test.ts:84`、`backend/tests/business-logic/streamingChatExecutor.test.ts:215`、`backend/tests/business-logic/streamingChatExecutor.test.ts:280`、`backend/tests/business-logic/streamingChatExecutor.test.ts:512`
- 分類理由：此檔已比純 mock store 測試更有價值，因為使用真實 test DB、真實 `podStore` / `runStore`，只 mock provider boundary 與 socket side effect。不過檔案同時覆蓋 streaming delta、tool event、Goal Runtime、gate retry、abort、path validation、pod missing、DB persistence，setup 與 spy 數量龐大。
- 維護風險：任何 executor lifecycle 小改動都可能讓多個高階測例一起壞；由於 fixture、DB seed、provider mock 與 socket spy 混在同一檔，失敗時難以判斷是 stream parser、dispatcher、goal gate 還是 persistence 邊界壞掉。
- 建議處理方式：保留「provider event -> WebSocket/runStore 可觀察結果」的 integration-style 測例，但拆出 shared fixture：`createStreamingChatHarness()` 建 DB、canvas、pod、strategy、provider stream 與 socket recorder。另把 text/tool/error event reduction 抽成純函式或小型 dispatcher 後用 table-driven 測試覆蓋，executor 測試只保留跨 service lifecycle。

#### 改寫候選：過度依賴呼叫順序的 socket/store spy 斷言

- 位置：`backend/tests/business-logic/streamingChatExecutor.test.ts:298`、`backend/tests/business-logic/streamingChatExecutor.test.ts:376`、`backend/tests/business-logic/streamingChatExecutor.test.ts:637`、`backend/tests/business-logic/streamingChatExecutor.test.ts:737`
- 分類理由：部分測例使用 `toHaveBeenNthCalledWith` 或自建 `order` 陣列固定事件順序。對 streaming 使用者而言，順序本身有價值，但目前把 dispatcher 內部廣播次數、runStore divider 寫入、onComplete callback 的序列放在大型 executor 測試內，容易綁住協調實作。
- 建議處理方式：保留最小端到端順序測例，例如 text partial 必須先於 complete、goal divider 必須先於下游 callback；其他順序細節移到 dispatcher/lifecycle coordinator 單元測試。若未來抽出 `ChatStreamDispatcher`，可用 recorder 驗證 domain event sequence，而不是直接驗證 socket method call sequence。

#### 刪除或下沉候選：serializer 純函式測例可移出 provider 大檔

- 位置：`backend/tests/business-logic/opencodeProvider.test.ts:2157`、`backend/tests/business-logic/opencodeProvider.test.ts:2207`
- 分類理由：`serializeV2ToolSuccessContent` 與 `serializeV2ToolFailureError` 是有效純函式 contract，但放在 provider chat 大檔尾端會增加檔案大小與 review 成本。這些測例不需要 opencode client/server fixture，也不需要 provider lifecycle setup。
- 建議處理方式：移到 `opencodeToolContentSerializer.test.ts`，用 table-driven 測 text/file/null/error object/string。provider test 只保留「tool success/failure event 會呼叫 serializer 並產生 normalized event」的高階 contract。

## P2.C 全域測試設定 review

### P2.C.t1 `backend/tests/setup/testConfig.ts` console 靜音設定

#### Finding C1: 全域覆寫所有 console method 會讓測試中的 warning/error 永久消失

- 嚴重度：High
- 位置：`backend/tests/setup/testConfig.ts:8`、`backend/tests/setup/testConfig.ts:9`、`backend/tests/setup/testConfig.ts:10`、`backend/tests/setup/testConfig.ts:11`、`backend/tests/setup/testConfig.ts:12`、`backend/tests/setup/testConfig.ts:13`
- 問題原因：setupFiles 最早期直接將 `console.log/error/warn/info/debug` 改成 no-op，且沒有 afterEach 檢查。這會吞掉未處理錯誤的診斷訊息、logger fallback、SQLite/Bun runtime warning、測試環境 config 警告與 provider error classification 過程中的 unexpected log。
- 維護風險：後端測試可能在產生 `console.error` 或 `console.warn` 的情況下仍通過，CI 輸出也沒有線索。尤其本專案很多 service 會把 client-safe error 透過 logger 記錄後回傳，若分類漏掉敏感資訊或產生 unexpected error log，現在的全域靜音無法讓 reviewer 看見。
- 應浮出的訊號：`console.error` 預設應使測試失敗；`console.warn` 中包含 unhandled rejection、SQLite/Bun runtime warning、provider SDK warning、config/path validation warning、deprecation、missing env 或 unexpected logger fallback 時應失敗；`console.log/info/debug` 可維持靜音，但需要允許個別測試 opt-in 檢查。
- 允許靜音條件：已知噪音應以 per-test helper 明確允許，例如 `allowConsoleWarning(/expected warning/)`，並在 afterEach 驗證該 warning 是否真的發生。外部 SDK 在錯誤路徑會輸出的已知訊息可放入小型 allowlist，但不得無條件吞掉所有 error。
- 建議處理方式：改成 fail-fast console guard：setup 中 spy `console.warn/error`，將未允許訊息累積，afterEach 若有未允許訊息就 throw；`logger` mock 仍可保留為 side-effect mock，但 `logger.error` 本身也應提供可選的測試斷言，避免 service 錯誤被完全靜默。

#### Finding C2: logger mock 與 console no-op 疊加，讓「有記錄但測試仍綠」成為預設

- 嚴重度：Medium
- 位置：`backend/tests/setup/testConfig.ts:15`、`backend/tests/setup/testConfig.ts:18`、`backend/tests/setup/testConfig.ts:22`、`backend/tests/setup/testConfig.ts:31`
- 問題原因：setup 既覆寫 console，又 mock `../../src/utils/logger.js`，回傳 no-op `MockLogger` 與 logger instance。這對降低 CI 噪音有效，但也讓所有 service 的 warning/error side effect 從測試觀察面消失。
- 維護風險：當某個 service 在成功路徑誤記 `logger.error`、在錯誤分類時洩漏 raw error、或在 retry loop 中大量 warn，測試不會失敗。這對 provider、workflow、git、database 這些 error-heavy 模組特別危險。
- 建議處理方式：將 logger mock 改成 recorder，預設允許 `log/debug` 靜音，但 `warn/error` 未被測試明確 allow 時在 afterEach fail。對需要驗證 logger 的測試提供 `expectLoggedError(pattern)` helper，讓錯誤路徑既能保持輸出乾淨，也能固定預期訊號。

## P3.A 後端結論與優先序

### P3.A.t1 後端 findings 優先序

1. High：拆分 `backend/src/services/claude/streamingChatExecutor.ts`。優先抽 parser、dispatcher、lifecycle coordinator 與 provider error classifier，因為它同時影響 streaming chat、run mode、Goal Runtime、abort 與 WebSocket event，一旦改壞會跨多個使用者流程擴散。
2. High：收斂 workflow/run 狀態機。`runExecutionService`、`workflowExecutionService`、`workflowBranchTriggerService` 與 `runStore` 目前共同決定 pod/run/pathway 狀態，應先建立 domain transition result 與 event publisher，再拆 repository/persistence，降低新增 run 狀態或 branch 規則時漏改 DB/event 的風險。
3. High：整理 provider/alias service 邊界。`codexProvider.ts` 與 `opencodeAliasService.ts` 都混合 option mapping、外部程序/SDK、DB transaction、錯誤轉譯與 event side effect，建議先抽 builder/mapper/repository/policy，使 provider facade 與 alias use case 變薄。
4. High：建立 API/WebSocket contract manifest 檢查。REST route table、WebSocket handler registry、schema enum、前端 event 常數與 skill 文件同步目前靠人工維護；新增 typed manifest 與 introspection test 能直接降低跨端 contract 漂移。
5. Medium：拆 repository 與 side-effect service。`podStore`、`gitService` 需要分出 mapper、policy、auth/error translator、command runner，避免 persistence、validation、路徑安全與 UI-facing message 混在同一層。

### P3.A.t2 後端測試刪除、改寫、保留清單

#### 刪除候選

- `backend/tests/business-logic/safeJsonParse.test.ts` 中合法 JSON object/array/string/number/boolean/null 與泛型推斷測例：符合「測第三方/標準庫行為」與「測 TypeScript 編譯期假象」判準。
- `backend/tests/database/model-aliases.test.ts` 中只驗證 delete 後 row count 變少的純 CRUD wrapper 測例：符合「低價值 persistence mirror」判準；若 service 層已覆蓋 delete 行為，DB 層只保留 constraint 與排序。
- `backend/tests/database/schema.test.ts` 中逐欄確認 primitive insert/select 原樣返回的斷言可縮減：符合「欄位鏡射而非資料契約」判準。

#### 改寫候選

- `backend/tests/database/schema.test.ts` prepared statements 大型 smoke test：拆成 domain statement contract 測試，保留排序、FK、關聯表、statement 參數命名與 service 依賴的 result shape。
- `backend/tests/database/model-aliases.test.ts` update/delete 測例：提高到 alias service reorder/delete contract，或補 `updated_at`、thinking preset、real model/provider 維持不變等實際資料契約。
- `backend/tests/business-logic/claudeProviderBuildOptions.test.ts` 中 mock 呼叫次數與預設值鏡射測例：改成 final option shape contract，呼叫次數只留在 fallback 邊界測試。
- `backend/tests/business-logic/opencodeProvider.test.ts` 大型 provider 測試：拆 fixture 與 serializer 純函式測試，provider 檔保留 event -> normalized event 與 client-safe error contract。
- `backend/tests/business-logic/streamingChatExecutor.test.ts`：保留 integration-style harness，但將 parser/dispatcher/goal gate/lifecycle 細節拆成較小測試，減少單檔高 mock 與呼叫順序耦合。
- `backend/tests/setup/testConfig.ts`：全域 console/logger 靜音改成 fail-fast guard 與 allowlist helper，符合「測試 warning/error 不得被背景噪音吞掉」判準。

#### 保留候選

- `backend/tests/business-logic/safeJsonParse.test.ts` invalid JSON、空字串、未閉合括號回傳 `null` 且不 throw：符合「本專案錯誤路徑契約」判準。
- `backend/tests/database/schema.test.ts` cascade delete：符合「真實 DB 約束與跨表資料完整性」判準。
- `backend/tests/database/model-aliases.test.ts` unique constraint、order_idx 排序與 max order 查詢：符合「只有真實 SQLite 才可靠驗證的資料契約」判準。
- `backend/tests/business-logic/claudeProviderBuildOptions.test.ts` provider wrapper 外部 port mock：符合「外部 SDK/MCP/integration 邊界 mock」判準。
- `backend/tests/business-logic/opencodeProvider.test.ts` Opencode client port/server state factory 測試：符合「本專案 port contract」判準。
- `backend/tests/business-logic/streamingChatExecutor.test.ts` 真實 test DB + provider boundary mock 的 streaming lifecycle 測試：符合「跨 service 使用者可觀察結果」判準，但需要 fixture 化降低維護成本。
