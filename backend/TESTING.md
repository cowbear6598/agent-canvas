# Backend Testing Policy

Backend tests must prove product behavior through flows that match how the
server is used. Tests live in one of four product-facing categories:

- `tests/userflows`: end-to-end user actions that cross API, WebSocket,
  service, filesystem, or database boundaries.
- `tests/integration`: one backend boundary exercised through the real
  implementation, such as an HTTP route, WebSocket route, filesystem side
  effect, or shared store behavior.
- `tests/database`: schema, migration, cascade, uniqueness, and persistence
  rules that need direct database assertions.
- `tests/business-logic`: focused parser, validator, normalizer,
  error-classifier, prompt-builder, path-safety, and workflow decision rules.

`tests/helpers` and `tests/setup` are shared test infrastructure, not behavior
categories. Do not add new behavior tests under module-oriented names such as
`unit`, `services`, `provider`, `handlers`, `utils`, or `api`.

New tests are allowed only when they fit one of these coverage types:

1. API integration tests: exercise HTTP routes through the real application
   server and verify the API-to-service behavior, response contract,
   persistence, and file side effects that a user action depends on.
2. WebSocket integration tests: exercise the real WebSocket server with a real
   WebSocket client and verify the request, emitted events, and resulting
   frontend-observable state changes for canvas, pod, chat, run, and workflow
   flows.
3. Filesystem integration tests: write to a test-owned temporary directory when
   the product rule depends on path safety, attachment output, repository
   layout, archive creation, cleanup, or other real file side effects.
4. Database integration tests: use the test database when the product rule
   depends on persisted rows, relations, migrations, uniqueness, cascade
   behavior, or API/service behavior that must survive a database round trip.
5. Business logic tests: keep focused pure tests for high-value parser,
   validator, normalizer, error-classifier, prompt-builder, path-safety, and
   workflow/state decision rules that are valuable without starting the server.

Test names must describe the product rule or workflow being protected. A
passing backend suite should confirm flows such as creating pods, starting chat,
triggering workflows, persisting data, and writing files without depending on a
developer's local credentials, local user config, or external network access.

Filesystem tests must use the shared temp harness. Test data is created under
repo-local `tmp/AgentCanvas`, with each test receiving an isolated subdirectory.
The global setup removes `tmp/AgentCanvas` after the suite, so filesystem tests
must not write to `~/Documents/AgentCanvas`, the real plugin directory, or any
developer-specific path. When adding filesystem coverage, verify the product
side effect and let the harness clean up the directory.

Integration tests should reuse the shared harnesses in `tests/helpers`:

- API flows use `createApiIntegrationHarness` so requests pass through the real
  server wiring and schema validation.
- WebSocket flows use `createWebSocketIntegrationHarness` and assert received
  events instead of internal emit calls.
- Database flows use `createTestDatabaseHarness` or the suite database setup,
  then assert persisted rows and round trips.
- Filesystem flows use `createTempDir` or `createTestWorkspaceHarness`, both of
  which allocate paths below `tmp/AgentCanvas`.

Keep integration setup cheap and deterministic. Prefer shared harness setup over
per-test server bootstrapping, avoid long sleeps by awaiting events or explicit
promises, and fake only third-party boundaries that would require network,
credentials, slow external processes, or unsafe remote state.

Allowed fake boundaries are limited to systems outside the backend product
state:

- Fake Claude, Codex, and opencode providers when the test verifies provider
  request construction, streaming behavior, cancellation, normalized output, or
  user-facing error messages without requiring real provider credentials.
- Fake Sentry, Slack, Jira, Telegram, and other third-party integration services
  when the test verifies local auth handling, payload normalization, resource
  mapping, retry/error behavior, and websocket or API responses around those
  integrations.
- Fake git remotes when the product rule depends on remote availability,
  authentication failure, clone/pull/fetch responses, or remote branch state.
- Fake the git executable when the test verifies command construction, exit
  status handling, stderr mapping, timeout behavior, or a failure mode that
  would be slow or unsafe to produce with a real executable.

Fakes should be explicit test harnesses or adapter-level stubs that return
product-shaped data. They should not reduce the assertion to checking that a
mock function was called.

Do not claim an integration test when one of the integration boundaries was
mocked away:

- Do not mock filesystem APIs and call the result a filesystem integration
  test. Use a temporary directory and verify the actual files, directories, and
  path-safety outcomes.
- Do not mock the database, stores, statements, or persistence layer and call
  the result a database integration test. Use the test database and verify the
  persisted data or migration behavior.
- Do not mock WebSocket handlers, the socket service, or emit functions and call
  the result a WebSocket integration test. Use the real WebSocket server, a real
  WebSocket client, and verify the events received by the client.

Tests that mock these boundaries can still be useful business logic or adapter
tests, but their names and placement must not describe them as integration
coverage.

## 維護性審計：測試二次審核

本輪先以 `backend/tests/backend-test-inventory.tsv` 比對實際
`backend/tests/**/*.test.ts` 清單。盤點檔中已不存在的
`dbStartupCleanup.test.ts`、`schema-migration.test.ts` 標記為 `deleted`；
新增但未分類的測試已補入盤點，並逐一標明保留或清理決策。

刪除決策：

- `backend/tests/business-logic/capabilities.test.ts`：刪除。此檔只驗證
  provider model 常數與 Set 自身一致性，沒有對應 userflow、商業規則或真外部
  邊界。
- `backend/tests/business-logic/providerTypes.test.ts`：刪除。此檔只驗證
  provider metadata 與常數綁定，屬於實作結構一致性檢查，沒有保護使用流程。

改寫決策：

- `backend/tests/business-logic/providerIndex.test.ts`：保留但縮小範圍。移除
  registry 存在、availableModels 精確順序、frozen 與常數正規式等低價值檢查，
  僅保留 provider model fallback 商業規則：Claude/Codex 非法 model 會回退到
  provider 預設值，OpenCode 的 `providerID/modelID` 動態 model 不會被靜態清單
  誤判而 fallback。

新增未分類測試保留依據：

- `branchDecisionService.test.ts`：對應 workflow decision；保護 branch decision
  會使用 persisted summary 與 bounded transcript window。
- `connectionSchemas.test.ts`：對應 path-safety 與 request schema；保護
  OpenCode `providerID/modelID` model 格式可用，且危險字元仍會被拒絕。
- `integrationReplyService.test.ts`：對應 integration reply 外部邊界；保護
  capability token、pod binding、provider send 與 internal API 回應契約。
- `opencodeThinkingPresetService.test.ts`：對應 provider normalizer；保護
  OpenCode model metadata variants 到 thinking preset snapshot 的商業轉換規則。
- `runHandlers.test.ts`：對應 run WebSocket handler contract；保護 run pod
  message 分頁 payload 與 delete ack payload。
- `streamThrottle.test.ts`：對應 streaming persistence；保護同一 throttle window
  只排一次 trailing persist，且使用最新內容。
- `summaryService.test.ts`：對應 workflow summary decision；保護 persisted
  summary、recent transcript window 與 provider 失敗 fallback。
- `plugin-api.test.ts`：對應 F3/F4 plugin WebSocket userflow；保護安裝、列表、
  排序、更新、刪除，以及 plugin filesystem side effect。
- `repository-clone-api.test.ts`：對應 F3/F4 repository clone WebSocket userflow；
  保護 clone progress、repository path boundary 與 clone 失敗後清理。

## P3.B fallback 決策

後端 fallback 分成三類處理：

- Legacy 讀取相容：保留在讀取舊資料或歷史 DB row 的轉換層，例如舊 connection
  沒有 summary provider / branch provider 時，讀取路徑仍可依 source Pod 或 Claude
  預設值還原可顯示資料。
- 外部邊界 fallback：保留在 provider、filesystem、git、network 或 summary provider
  failure 邊界，並以使用者可見錯誤或明確 fallback summary 行為測試覆蓋。
- 正規寫入 contract：不再 silent fallback。summaryModel / branchModel 寫入時若
  不符合 provider 支援清單，改由 schema/service validation 直接拒絕，避免錯誤
  model 被寫入後在執行時才落回預設值。

本輪保留或新增的 fallback 契約測試：

- `backend/tests/business-logic/connectionStatusPersistence.test.ts`：F5/F6，寫入
  不支援的 summary/branch model 時應直接拒絕，未指定 model 時才使用明確預設值。
- `backend/tests/business-logic/summaryService.test.ts`：F5/F6，summary provider
  failure 仍保留使用者可理解的 fallback summary contract。
- `backend/tests/userflows/connection.test.ts`：F5/F6，WebSocket connection 更新
  遇到不支援 model 時回傳使用者可見錯誤，不把錯誤輸入靜默轉成預設 model。

## 維護性審計：OpenCode provider 與 settings handler

### `backend/src/services/provider/opencodeProvider.ts`

`opencodeProvider.ts` 目前同時承擔 provider facade、OpenCode SDK adapter、session orchestration、SSE event normalize、tool event collection、MCP config、plugin catalog、thinking preset 與 error mapping。後續拆分時需保留 `AgentProvider<OpencodeOptions>`、`NormalizedEvent` 與 executor 既有公開介面。

責任邊界：

- Session lifecycle：`buildOptions()` 解析 provider/model 與 MCP entries，`chat()` 決定 global server 或 transient server，建立或 resume session，處理 abort 與 run-scoped server cleanup。
- SSE event normalize：訂閱 OpenCode event stream，依 session id 過濾事件，將 text、thinking、session_started、turn_complete 與 provider error 轉為 normalized event。
- Tool event collection：處理 `message.part.delta` 的 tool part、`session.idle` 後補拉 `session.messages()`，並用 yielded set 避免 tool call 重複輸出。
- MCP config：透過 `opencodeMcpConfigBuilder.ts` 將 pod MCP entries 轉成 OpenCode config，provider 仍負責 transient server 使用時機與 server failure mapping。
- Plugin catalog：接收 managed MCP surface 產出的 plugin catalog text，並在 fresh session prompt 注入 Goal Runtime bootstrap 與 catalog。
- Thinking preset：讀取 alias row 與 thinking preset snapshot，將 selected level 映射到 OpenCode prompt variant。
- Error mapping：混合 OpenCode event shape、fatal policy 與 zh-TW 使用者錯誤訊息，例如 permission/question/workspace failed 與 prompt failure。

目標模組與搬移順序：

1. `backend/src/services/provider/opencode/opencodeSdkClientAdapter.ts`：搬移 SDK v2 client 參數橋接，先固定外部 SDK adapter。
2. `backend/src/services/provider/opencode/opencodeSessionErrorMapper.ts`：搬移 prompt failure、permission/question/workspace failed mapping，集中 error code 與 fatal policy。
3. `backend/src/services/provider/opencode/opencodeToolEventCollector.ts`：搬移 tool 補拉、part id throttle 與去重狀態，使用 fake `session.messages()` harness 驗證。
4. `backend/src/services/provider/opencode/opencodePromptAdapter.ts`：搬移 prompt params、Goal Runtime bootstrap、plugin catalog 與 thinking variant 組裝。
5. `backend/src/services/provider/opencode/opencodeOptionsBuilder.ts`：搬移 model 拆分、MCP entries、plugin catalog 與 thinking options 組裝。
6. `backend/src/services/provider/opencode/opencodeTransientServerPool.ts`：搬移 run-scoped transient server cache、request-scoped close 與 cleanup。
7. `backend/src/services/provider/opencode/opencodeChatOrchestrator.ts`：最後搬移 create/resume/prompt/subscribe/abort/event loop orchestration，provider 保留薄 facade。

### `backend/src/handlers/opencodeSettingsHandlers.ts`

`opencodeSettingsHandlers.ts` 目前同時承擔 WebSocket handler、alias CRUD、provider list sanitize、broadcast refresh 與 SQLite error mapping。後續拆分時需保留 `opencodeSettingsHandlerGroup` 的 request/response event contract，不改變 payload schema 與 response event 名稱。

責任邊界：

- WebSocket handler：接收 `opencode:*` request event，執行流程、組 response payload，並透過 socket service emit result。
- Alias CRUD：建立、更新、刪除、排序、refresh presets，包含 duplicate model 檢查、使用中保護、order index transaction 與 thinking preset snapshot。
- Provider list sanitize：將 OpenCode provider/model metadata normalize 成前端需要的 `{ id, name }` shape，過濾 malformed provider/model。
- Broadcast refresh：alias mutation 成功後 best-effort 廣播 `opencode:aliases:updated` 與 provider list refresh，失敗只記 log、不回滾 DB operation。
- SQLite error mapping：辨識 unique constraint，區分 alias duplicate、real model duplicate 與 fallback error code。

目標模組與搬移順序：

1. `backend/src/services/opencodeSettings/opencodeProviderListSanitizer.ts`：優先搬純 provider/model metadata normalize。
2. `backend/src/services/opencodeSettings/opencodeAliasMapper.ts`：搬 DB row 到 WebSocket DTO 的純轉換。
3. `backend/src/services/opencodeSettings/opencodeProviderCatalogClient.ts`：搬 OpenCode provider list client、timeout fetch 與 server readiness adapter。
4. `backend/src/services/opencodeSettings/opencodeAliasErrorMapper.ts`：搬 SQLite unique constraint 與 alias conflict result mapping。
5. `backend/src/services/opencodeSettings/opencodeAliasUsageService.ts`：搬 pod/connection usage 查詢與 alias 使用中保護規則。
6. `backend/src/services/opencodeSettings/opencodeAliasRepository.ts`：搬 `model_aliases` statements、transaction 與 reorder SQL。
7. `backend/src/services/opencodeSettings/opencodeThinkingPresetCatalog.ts`：搬 thinking preset snapshot 與 provider/model metadata lookup。
8. `backend/src/services/opencodeSettings/opencodeSettingsRefreshBroadcaster.ts`：搬 alias mutation 後 refresh broadcast policy。
9. `backend/src/services/opencodeSettings/opencodeAliasService.ts`：最後收斂 create/update/delete/reorder/refresh-presets orchestration，handler 只保留 request 轉接與 response emit。

## 維護性審計：Workflow 與 run orchestration

### 狀態轉移與 summary 路徑

`workflowPipeline.ts` 是 workflow connection 的單條 pipeline gate。觸發條件來自 auto、branch 或 direct strategy 呼叫 `execute()`；進入後先確認 target pod 存在，run mode 下再用 pod instance status 過濾不可再觸發的終態 instance。summary 路徑先由 `resolveSettlementPathway(triggerMode)` 決定要 settle auto 或 direct pathway，再呼叫 `generateSummaryWithFallback()`；成功時會標記 summary complete，失敗且沒有 fallback 時透過 delegate 回報 summary failed 並停止。summary model 若被 disposable chat 修正，會 lazy 寫回 connection 並廣播 `CONNECTION_UPDATED`。collect stage 依序分成 strategy `collectSources()`、multi-input pending collection、直通 summary 三條路徑；ready 後若 delegate 判斷 target 忙碌就進 run queue，否則呼叫 `triggerWorkflowWithSummary()` 開始下游 chat。

`workflowExecutionService.ts` 負責 workflow chat orchestration 與下游 fan-out。`checkAndTriggerWorkflows()` 以 source pod 的 outgoing connections 分派 auto、branch、direct；各分支用 `Promise.allSettled()` 隔離單條 connection 的錯誤，拒絕結果只記錄 log，不阻斷其他下游。`triggerWorkflowWithSummary()` 會略過已刪除 connection 或 missing target pod；非 run mode 才把 connection 狀態設為 active，run mode 保持 template connection 不變。真正 chat 由 `executeClaudeQuery()` 串接 `ChatExecutionStrategy` 與 provider streaming；完成時呼叫 strategy `onComplete()`、delegate `onChatComplete()`、觸發下一層 workflow 並消化佇列；錯誤時用 `WorkflowUserError` 白名單過濾使用者可見訊息，呼叫 strategy `onError()`、delegate `onChatError()`，再排下一個 queued item。

`workflowBranchTriggerService.ts` 負責 branch decision lifecycle。非 run mode 進入時會把整批 branch connections 設為 deciding 並廣播更新；run mode 則透過 delegate 將各 target pod instance 標為 deciding。決策使用 source pod 的現有 abort signal，abort 時非 run mode 會撤回 connection status/decideStatus，run mode 會把所有 target pod 的 auto pathway settle and skip。選中 connection 時標 approved 並觸發 pipeline；拒絕 connection 時非 run mode 標 rejected，run mode 走 `settleAndSkipPath()`，multi-input target 另記錄 source rejection 並 emit pending status。非 abort 例外目前防禦性視為全部拒絕，錯誤訊息走 log 與 delegate/chat error 路徑。

`runExecutionService.ts` 是 run instance 與 run status 的狀態機。`createRun()` 先建立 run，再 BFS 收集 chain pod ids、計算每個 instance 的 auto/direct pathway 初始狀態，並配置 run 隔離資源；資源配置失敗的 instance 直接進 `error`，建立完成後廣播 `RUN_CREATED` 並套用 run 數量上限。instance 可轉入 `summarizing`、`deciding`、`queued`、`waiting`、`running`、`completed`、`skipped`、`error`；pathway settle 後若所有 pathway settled，never-triggered instance 轉 `skipped`，已觸發 instance 轉 `completed`，但 queue 尚未清空時不提前完成。`settleUnreachablePaths()` 會把因 upstream skipped/error 已不可達的 pending pathway settle，並廣播 pod 終態。run 終態由 `evaluateRunStatus()` 判定：全部 completed/skipped 時 run `completed`，有 error 且沒有 in-progress 時 run `error`，其他維持 running；自然終態會 fire-and-forget 清理 run repo、Goal Runtime 與 transient OpenCode server。`deleteRun()` 的取消終態先移除 active stream guard，再標 `cancelled`、abort stream、清理資源、刪 row 並廣播 `RUN_DELETED`。

### 可抽成 domain decision 的規則

目前 workflow/run 模組的 orchestration、store mutation、WebSocket emit 與 domain decision 仍混在 service 方法中。後續拆分時應先抽純規則，讓 fake store/delegate harness 可驗證狀態轉移，不必啟動 provider streaming 或真 WebSocket。

責任邊界候選：

- Trigger settlement：`resolveSettlementPathway()`、`calculatePathways()`、`settlePodTrigger()`、`settleAndSkipPath()`、`settleInstanceIfUnreachable()` 與 branch rejection 對 auto pathway 的處理應收斂成 run pathway decision。輸入為 triggerMode、incoming connections、source instance statuses、目前 pathway state 與 instance status；輸出為要 settle 的 pathway、pod instance next status、是否需要 emit terminal pod event。
- Run queue eligibility：`workflowPipeline.isRunInstanceTriggerable()`、`enqueueForRunMode()`、`settlePodTrigger()` 對 queue size 的 completed guard、delegate `shouldEnqueue()/isBusy()` 判斷應抽成 run queue decision。輸入為 target instance status、target busy state、queue size、run mode；輸出為 skip trigger、enqueue、execute now、defer completed。
- Summary result handling：`generateSummaryWithFallback()` 與 pipeline collect stage 應拆成 summary decision。輸入為 summary service result、last assistant fallback、triggerMode、strategy collect result、multi-input group size；輸出為 summary failed、summary completed、fallback content、wait multi-input、merged content 或 direct passthrough。
- Resource guard：`createRun()` provisioning error、`evaluateRunStatus()` 終態後 cleanup、`deleteRun()` race guard 與 path boundary cleanup 應拆成 resource lifecycle decision。輸入為 provisioning result、active stream map、run DB status、run execution paths、path boundary result；輸出為 instance error、allow status emit、abort keys、cleanup targets、skip unsafe cleanup。
- Branch decision settlement：`executeDecisionWithAbortHandling()`、`applyApprovedConnection()`、`handleRejectedConnection()` 應拆成 branch result decision。輸入為 selectedConnectionId、rejectedConnectionIds、abort/error kind、run mode、multi-input target state；輸出為 approved pipeline trigger、connection decide status、pathway skip、pending target rejection、abort rollback。
- Run terminal status：`evaluateRunStatus()` 的 all done/error/in-progress 判斷應成為純函數。輸入為 pod instance statuses；輸出為 run `completed`、run `error` 或 no-op，並標記是否需要啟動 cleanup。

目標模組與搬移順序：

1. `backend/src/services/workflow/runPathwayDecision.ts`：先搬 pathway 初始狀態、settlement 與 unreachable 判斷，保留 `runExecutionService` 負責 store mutation 與 emit。
2. `backend/src/services/workflow/runQueueDecision.ts`：搬 triggerable、enqueue eligibility、queue non-empty completed guard，讓 pipeline 與 run completion 共用同一組規則。
3. `backend/src/services/workflow/workflowSummaryDecision.ts`：搬 summary success/fallback/failure、collect ready、multi-input/direct passthrough 的結果分類。
4. `backend/src/services/workflow/branchSettlementDecision.ts`：搬 branch selected/rejected/abort/error 到 approved、rejected、rollback、skip pathway 的映射。
5. `backend/src/services/workflow/runTerminalStatusDecision.ts`：搬 run completed/error/no-op 判定與 cleanup flag。
6. `backend/src/services/workflow/runResourceLifecycleDecision.ts`：搬 provisioning error、deleteRun race guard、cleanup target 與 unsafe path skip policy。
