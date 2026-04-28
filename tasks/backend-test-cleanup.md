# 後端測試清理計畫書

## 1. 目標與原則

### 1.1 核心原則

**只 mock 第三方、不可控的依賴**。對本後端而言，唯一合理的 mock 邊界是：

- Claude Agent SDK（`@anthropic-ai/claude-agent-sdk` 等會 spawn CLI 子程序的模組）
- 外部 HTTP API（OAuth provider、第三方服務）
- `simple-git`（避開真 git 的特定錯誤情境，平常用 tmp git repo 跑真 git）
- `Bun.spawn` 對 codex CLI 等外部執行檔的呼叫
- `socketService.emit*`（避免污染真實 WebSocket，但只 spy 不改流程）

**不可 mock**：自家 SQLite-backed store（podStore、connectionStore、runStore、messageStore、workflowStore、integrationAppStore、configStore…）、自家 service / handler / helper、自家檔案系統存取（一律改用 tmp dir）。

### 1.2 預期成效

- 測試檔數：161 → 110-120 檔
- 測試行數：約 53k → 約 30k 行
- 真實行為覆蓋率提升：handler / service / store 全跑真 SQLite 與真檔案，測試壞了等於行為壞了
- 測試訊號穩定：刪除 7 份共用 mock 工廠，避免「改 mock 工廠 → 7 個測試一起紅」的脆弱連動

### 1.3 黃金範本

所有重寫測試以 **`tests/integration/workflow-execution.test.ts`** 為範本：
- 真 server + 真 SQLite + 真 store
- 只 mock Claude Agent SDK 邊界
- 透過 socketClient 驅動 WebSocket，斷言真實 store 結果與 emit 事件

### 1.4 執行紀律

- 全程使用 `bun run test`（**不是 `bun test`**）驗證
- 全程使用 `bun run style` 確認 eslint + type
- 任一波次完成後須兩條指令皆綠才能進下一波
- 計畫書所有訊息、註解、commit message 一律 zh-TW
- **使用者決策：每一波一個 commit**（commit message 遵循 `[Refactor]` 慣例）。Phase 內任務若太多可拆中間 squash 提交，但最終對外只看到 4 個 commit。

### 1.5 重寫過程中的覆蓋缺口處理規則

重寫過程中若發現原本 mock-only 測試覆蓋的某個邊界條件在 integration 既有測試中不存在，**允許**直接在 `tests/integration/` 對應檔新增 it()。但禁止用「補 case」當理由把 mock-only 測試保留下來，也禁止新增任何依賴自家 store mock 的測試檔。

---

## 2. 執行波次

四波依序執行，**Phase 之間不可平行**（後一波依賴前一波刪除 / 重寫成果）。

---

### Phase 1 刪除冗餘 mock-only 測試（22+1 檔）

直接刪除以下檔案。每一檔都已有等價的 integration 真實測試覆蓋，無覆蓋缺口風險。

A. 刪除 mock-only handler / api 測試

  - [ ] 刪除 `backend/tests/api/podApi.test.ts`（已被 `tests/integration/pod-api.test.ts` 796 行 0 mock 覆蓋）
  - [ ] 刪除 `backend/tests/api/workflowApi.test.ts`（已被 `tests/integration/workflow-api.test.ts` 594 行 0 mock 覆蓋）
  - [ ] 刪除 `backend/tests/handlers/repositoryHandlers.test.ts`（已被 `tests/integration/repository.test.ts` + `repository-git-operations.test.ts` + `repository-sync-manifest.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/handlers/podSetModel.test.ts`（已被 `tests/integration/pod.test.ts` + `pod-api.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/handlers/backupHandlers.test.ts`（重寫時併入 backupService 整合測試，見 Phase 2 B18）
  - [ ] 刪除 `backend/tests/unit/chatHandlers.test.ts`（952 行 19 個 vi.mock，已被 `tests/integration/chat.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/unit/configHandlers.test.ts`（已被 `tests/integration/config-ws.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/unit/multiInstanceHandlers.test.ts`（已被 `tests/integration/multi-instance.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/unit/runHandlers.test.ts`（被 canvas/run REST 與 ws integration 覆蓋）
  - [ ] 刪除 `backend/tests/unit/podSetPluginsHandler.test.ts`（已被 `tests/integration/pod-set-plugins.test.ts` 111 行 0 mock 覆蓋）
  - [ ] 刪除 `backend/tests/unit/mcpHandlers.test.ts`（行為改由 `claudeMcpReader.test.ts` 重寫版覆蓋，見 Phase 2 B17）
  - [ ] 刪除 `backend/tests/unit/integrationHandlers.test.ts`（已被 `tests/integration/integration.test.ts` 568 行覆蓋）
  - [ ] 刪除 `backend/tests/unit/workflowHandlers.test.ts`（已被 `tests/integration/workflow-api.test.ts` + `workflow.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/unit/disconnectReconnect.test.ts`（已被 `tests/integration/connection.test.ts` 360 行覆蓋）

B. 刪除「假整合測試」與重複測試

  - [ ] 刪除 `backend/tests/unit/runWorktreeIntegration.test.ts`（命名整合但全 mock，行為已由 `tests/integration/repository-git-operations.test.ts` 覆蓋）
  - [ ] 刪除 `backend/tests/unit/runWorktreeSharing.test.ts`（同上）
  - [ ] 刪除 `backend/tests/unit/runExecutionServiceDeciding.test.ts`（156 行，與 runExecutionService.test.ts 高度重複，僅差 deciding status；該 case 將在 Phase 3 B2 重寫版補回）
  - [ ] 刪除 `backend/tests/unit/runModeQueueIntegration.test.ts`（mock-only 假整合，行為由 `runQueueService.test.ts` + `workflowQueueFlow.test.ts` 覆蓋；後者於 Phase 3 B10 重寫）
  - [ ] 刪除 `backend/tests/unit/runContextPropagation.test.ts`（mock 14 個依賴只驗 RunContext 傳遞，併入 Phase 3 B2 runExecutionService 重寫版）
  - [ ] 刪除 `backend/tests/services/scheduleService.shouldFire.test.ts`（與 `tests/unit/schedule-service.test.ts` 高度重疊，shouldFire 純函數行為改由後者於 Phase 3 B15 重寫版覆蓋）
  - [ ] 刪除 `backend/tests/unit/workflowStatusDelegate.test.ts`（mock 9 個 service 純驗 delegate 轉發，已由 `tests/integration/workflow-execution.test.ts` 端對端覆蓋）
  - [ ] 刪除 `backend/tests/unit/workflowClearService.test.ts`（mock 全部 store + service；於 Phase 3 B7-B10 workflow 系列重寫時用真 SQLite 覆蓋 clear 流程）
  - [ ] 刪除 `backend/tests/services/startupService.encryption.test.ts`、`startupService.initialize.test.ts`、`startupService.migrate.test.ts`（mock 密度高）
    - **使用者決策：不另外新增整合測試**，startup 行為依靠 `tests/integration/setup.test.ts` 隱含覆蓋。若 Phase 1 後 setup.test.ts 跑不出問題即視為通過。

C. Phase 1 驗證

  - [ ] 執行 `bun run test`，確認剩餘測試全綠
  - [ ] 執行 `bun run style`，確認 eslint + type 全綠
  - [ ] git diff 檢查只有刪除，沒有意外動到其他檔
  - [ ] 風險：若 integration 測試實際覆蓋有缺口（理論上沒有），補測補在 integration 那邊，不要救回 mock-only 測試
  - [ ] 回滾：**回滾整波 revert**（單一 commit），若需要更細粒度回退請使用 git reflog 或在開發中的 stash

---

### Phase 2 fs / git / 外部 boundary 改用 tmp dir 真實作（5 檔）

把對檔案系統 / git CLI 的 `vi.mock("fs")` 模式改為 tmp dir + 真讀真寫。git 用 `tests/helpers/gitTestHelper.ts` 既有工具建真 repo。

A. fs boundary 改 tmp dir

  - [ ] 重寫 `backend/tests/unit/pluginScanner.test.ts`（原 803 行 41 mock）
    - 在 `beforeEach` 用 `Bun.write` / `node:fs/promises.mkdtemp` 建立 tmp dir
    - tmp dir 內建 `.claude/plugins/installed_plugins.json` 與假 plugin 子目錄結構
    - 暫時覆寫 `process.env.HOME` 指向 tmp dir，`afterEach` 還原
    - 移除所有 `vi.mock("fs")` / `vi.mock("node:fs")`
    - 保留純函數行為斷言（plugin 解析結果、錯誤情境）
  - [ ] 重寫 `backend/tests/unit/claudeMcpReader.test.ts`
    - 同樣 tmp dir + 真寫 `.claude.json` 與 mcp config 檔
    - 暫覆寫 `process.env.HOME`
    - 移除所有 fs mock
  - [ ] 重寫 `backend/tests/unit/codexMcpReader.test.ts`
    - 同上規則，tmp dir 真寫 `~/.codex/config.toml`
    - 移除所有 fs mock

B. git boundary 改用 tmp git repo

  - [ ] 重寫 `backend/tests/services/gitService.test.ts`
    - 全面改用 `tests/helpers/gitTestHelper.ts` 既有工具建立 tmp git repo
    - 跑真 git CLI 驗證 clone / pull / commit hash / branch list 等行為
    - 只在驗證「git 失敗特定 stderr」的 case 才 mock simple-git，其他 case 全部真實作

C. 混合 boundary 改寫（fs + simple-git）

  - [ ] 重寫 `backend/tests/services/backupService.test.ts`
    - fs 部分改 tmp dir 真讀真寫
    - `buildAuthenticatedUrl` 等純函數用真實作
    - 僅保留 `simple-git` mock 用於模擬 push 失敗 / 認證錯誤等網路情境
    - 同步把 Phase 1 A 刪掉的 `tests/handlers/backupHandlers.test.ts` 行為（handler emit）併進來：用真 socketService spy 取代原 mock
  - [ ] 重寫 `backend/tests/unit/buildClaudeOptions.test.ts`（原 430 行 39 mock）
    - `claudeMcpReader` / `pluginScanner` 用 tmp dir 真讀（與 A 區共用 helper）
    - 移除對自家模組的 mock
    - 保留對 Claude Agent SDK 邊界的 mock

D. Phase 2 驗證

  - [ ] 抽出共用的 tmp dir helper（建議放 `tests/helpers/tmpDirHelper.ts`），統一 `mkdtemp` + `cleanup` + `withHomeOverride` 介面，避免重複樣板
  - [ ] 執行 `bun run test`，確認重寫的 5 檔與原本依賴它們的 buildClaudeOptions 鏈路全綠
  - [ ] 執行 `bun run style`，確認 eslint + type 全綠
  - [ ] 風險：tmp dir 跨平台行為差異 → 一律使用 `node:os.tmpdir()` + `mkdtemp`，避免硬編 `/tmp`
  - [ ] 風險：`process.env.HOME` 暫覆寫如果 `afterEach` 沒還原會污染後續測試 → 用 try/finally 包裹，並加上 `afterAll` 兜底
  - [ ] 回滾：**回滾整波 revert**（單一 commit），若需要更細粒度回退請使用 git reflog 或在開發中的 stash

---

### Phase 3 用真 SQLite + 真 store 重寫高 mock 密度測試（19 檔）

全面採用 `initTestDb()` + 真 store，徹底淘汰反模式工具。

A. 淘汰 workflow 系列共用 mock 工廠（前置作業）

  - [ ] 在開始重寫 B5-B10 之前，**先全面停用** `tests/mocks/workflowModuleMocks.ts`、`tests/mocks/workflowSpySetup.ts`、`tests/mocks/workflowImplMocks.ts`、`tests/mocks/workflowTestFactories.ts`
  - [ ] 確認以下 7 檔不再從 `tests/mocks/index.ts` 匯入 workflow mock：
    - `tests/unit/workflowQueueFlow.test.ts`
    - `tests/unit/workflowMultiInputService.test.ts`
    - `tests/unit/workflowDirectTriggerFlow.test.ts`
    - `tests/unit/workflowExecutionService.test.ts`
    - `tests/unit/workflowQueueService.test.ts`
    - `tests/unit/workflowHelpers.test.ts`
    - `tests/unit/workflowAiDecideTriggerService.test.ts`
  - [ ] 另：**`tests/unit/runQueueService.test.ts`** 雖列於 D 區黃金範本，實際 import `workflowImplMocks`，本波須一併移除其 import 並改用真 SQLite + 真 store。修正後它才符合黃金範本描述。
  - [ ] 從 `tests/mocks/index.ts` 移除 `workflowModuleMocks` / `workflowSpySetup` / `workflowTestFactories` 的 re-export
  - [ ] 刪除 `tests/mocks/workflowModuleMocks.ts`
  - [ ] 刪除 `tests/mocks/workflowSpySetup.ts`
  - [ ] 刪除 `tests/mocks/workflowImplMocks.ts`
  - [ ] 刪除 `tests/mocks/workflowTestFactories.ts`

B. run 系列重寫（合併 C10）

  - [ ] 重寫 `backend/tests/unit/triggerSettlement.test.ts`（原 1810 行 317 mock）
    - 用 `initTestDb()` + 真 podStore / runStore / connectionStore
    - 僅 mock `socketService.emitToCanvas` 等 emit 函式（spy 即可，不改流程）
    - settlement pathway 純函數部分仍可獨立 unit 測（已在黃金清單）
  - [ ] 重寫 `backend/tests/unit/runExecutionService.test.ts`（原 1340 行 225 mock）
    - 真 SQLite + 真 store
    - `runQueueService` 用真實例（不 mock）
    - 把 Phase 1 刪掉的 `runExecutionServiceDeciding` 與 `runContextPropagation` 行為併進來：deciding status case + RunContext 傳遞 case
    - 邊界僅 mock：streaming chat executor 對 Claude Agent SDK 的呼叫

C. workflow 系列重寫（合併 C11，依賴 A 完成）

  - [ ] 重寫 `backend/tests/unit/workflowExecutionService.test.ts`（原 1071 行 80 mock）
  - [ ] 重寫 `backend/tests/unit/workflowAiDecideTriggerService.test.ts`（原 986 行 57 mock）
  - [ ] 重寫 `backend/tests/unit/workflowDirectTriggerFlow.test.ts`（原 784 行 46 mock）
  - [ ] 重寫 `backend/tests/unit/workflowMultiInputService.test.ts`（原 382 行 28 mock）
  - [ ] 重寫 `backend/tests/unit/workflowPipeline.test.ts`（原 741 行 38 mock）
  - [ ] 重寫 `backend/tests/unit/workflowStateService.test.ts`（原 582 行 48 mock）
  - [ ] 重寫 `backend/tests/unit/workflowQueueFlow.test.ts`（原 462 行 30 mock）
  - 上述 7 檔共同重寫規則：
    - 全部停用 workflow mock 工廠
    - 用 `initTestDb()` + 真 workflowStore / podStore / connectionStore
    - 僅 mock：Claude Agent SDK / `queryService` 對外呼叫 / streaming executor 邊界
    - 評估若內容與 `tests/integration/workflow-execution.test.ts` 高度重疊，直接移除該重複 case；保留針對單一 service 邊界條件 / 錯誤分支的 unit case
    - 整理後若兩個檔目標重疊（例如 ExecutionService 與 Pipeline），合併成一份

D. integration / chat 串流系列重寫

  - [ ] 重寫 `backend/tests/unit/integrationEventPipeline.test.ts`（原 1345 行 109 mock）
    - 真 SQLite + 真 integrationAppStore
    - 保留 `executeStreamingChat` mock（屬 SDK 邊界）
  - [ ] 重寫 `backend/tests/unit/streamingChatExecutor.test.ts`（原 1495 行 60 mock）
    - provider mock 保留（Claude Agent SDK 邊界）
    - store 改真 SQLite
  - [ ] 重寫 `backend/tests/unit/chatEmitStrategy.test.ts`、`backend/tests/unit/normalExecutionStrategy.test.ts`、`backend/tests/unit/runExecutionStrategy.test.ts`
    - 真 store 驗 emit 與 DB 寫入
    - 僅 spy `socketService` emit 函式

E. 其他高 mock 服務重寫

  - [ ] 重寫 `backend/tests/unit/aiDecideService.test.ts`（原 726 行 33 mock）
    - 保留 SDK mock，store 改真實
  - [ ] 重寫 `backend/tests/unit/summaryService.test.ts`（原 485 行 26 mock）
    - 僅 mock `disposableChatService.executeDisposableChat`，其他全真
  - [ ] 重寫 `backend/tests/unit/schedule-service.test.ts`（原 1133 行 27 mock）
    - 真 SQLite + 真 store
    - 僅保留 SDK / streaming executor mock
    - 把 Phase 1 刪除的 `scheduleService.shouldFire.test.ts` 純函數 case 併入

F. helper / 小型 service 重寫

  - [ ] 重寫 `backend/tests/unit/connectionStore.test.ts`：用 `initTestDb()` 寫真 pod，移除 `mock podStore.getById`
  - [ ] 重寫 `backend/tests/unit/handlerHelpers.test.ts`：拆出 `getProvider` mock；其餘改真實
  - [ ] 重寫 `backend/tests/unit/integrationHelpers.test.ts`：integrationAppStore 用真 SQLite
  - [ ] 重寫 `backend/tests/unit/chatHelpers.test.ts`、`backend/tests/unit/runChatHelpers.test.ts`：真 SQLite + 真 store；僅 spy `socketService.emitToCanvas`

G. Phase 3 驗證

  - [ ] 重寫過程中每完成一檔即跑 `bun run test <file>` 局部驗證，避免一次累積太多錯誤
  - [ ] Phase 3 全部完成後：`bun run test` 全綠 + `bun run style` 全綠
  - [ ] 確認 `tests/mocks/` 目錄下不再殘留 `workflowModuleMocks.ts` / `workflowSpySetup.ts` / `workflowImplMocks.ts` / `workflowTestFactories.ts`（亦不在 git 工作樹中）
  - [ ] 風險：真 SQLite 測試耗時上升 → 用 `:memory:` mode 並確保每個測試獨立 db instance
  - [ ] 風險：併入舊測試 case 時遺漏邊界條件 → 重寫前先列出原檔所有 it() 名稱清單，逐一對照
  - [ ] 回滾：**回滾整波 revert**（單一 commit），若需要更細粒度回退請使用 git reflog 或在開發中的 stash

---

### Phase 4 重複合併與命名統一（4 動作）

A. 重複測試最終整併

  - [ ] `backend/tests/unit/database.test.ts` 與 `backend/tests/database/podModelMigration.test.ts` 內容檢視
    - 把 unit 中的 schema 驗證移到 `tests/database/` 目錄
    - 統一目錄歸屬，刪除 `tests/unit/database.test.ts`（純函數 schema case 改放 `tests/database/schema.test.ts`）
  - [ ] `backend/tests/utils/staticFileServer.test.ts` 與 `backend/tests/unit/staticFileServer.test.ts` 比對後合併為單一檔（保留 `tests/unit/staticFileServer.test.ts`），刪除 utils 版

B. 目錄結構整理

  - [ ] **事實**：Phase 1 刪除三檔後 `tests/handlers/` 仍剩 `providerHandlers.test.ts`（黃金示範），**保留目錄**。評估是否將 `providerHandlers.test.ts` 搬遷到 `tests/provider/` 與其他 provider 測試集中（建議搬遷，因內容性質一致）；搬遷後若 `tests/handlers/` 才清空，再刪除目錄。
  - [ ] 檢查 `backend/tests/api/` 經 Phase 1 刪除後剩餘檔案（uploadApi.test.ts 在黃金名單內保留），確認結構合理
  - [ ] 命名一致性檢查：所有「跑真 server / 真 SQLite」的測試應放在 `tests/integration/`，所有「純函數 / 單一 store」的測試放 `tests/unit/`，避免混雜

C. 文件更新

  - [ ] 若 `backend/README.md` 或專案文件有提到「mock-only handler 測試」、「workflowModuleMocks」等，同步刪除相關段落
  - [ ] 不新增新文件（依使用者規範，除非另有要求）

D. Phase 4 驗證

  - [ ] `bun run test` 全綠
  - [ ] `bun run style` 全綠
  - [ ] 統計新檔數與行數，確認接近預估目標（110-120 檔 / 30k 行）
  - [ ] 提醒使用者重啟後端（依 CLAUDE.md，後端程式碼若同步有改才需，本計畫純測試不需重啟）
  - [ ] 回滾：**回滾整波 revert**（單一 commit），若需要更細粒度回退請使用 git reflog 或在開發中的 stash

---

## 3. 重寫指南

### 3.1 `initTestDb()` + 真 store 標準替換模式

針對 SQLite-backed store（podStore / connectionStore / runStore / messageStore / workflowStore / integrationAppStore / configStore），重寫前後對照如下：

**反模式（要刪除）**

- 在檔頭 `vi.mock("@/stores/podStore", () => ({ ... }))` 並提供假實作
- 在每個 it() 內 `vi.mocked(podStore.getById).mockResolvedValue(...)`
- 斷言 `expect(podStore.update).toHaveBeenCalledWith(...)` 而不驗 DB 真實狀態

**正確模式**

- `beforeEach` 呼叫 `initTestDb()`（已存在於 `tests/helpers/index.ts`）拿到一個獨立的 `:memory:` DB instance
- 直接 import 真實 store，呼叫真實 `create` / `update` 方法準備測試資料
- 行為驗證：對 store 再呼叫 `getById` / `list` 等方法讀回 DB，斷言實際儲存內容
- emit 驗證：用 `vi.spyOn(socketService, "emitToCanvas")` 取代 `vi.mock`，只觀察不改流程

**參考既有檔**：`tests/unit/podStoreIntegration.test.ts`（只 mock encryptionService，其餘全真）、`tests/unit/integrationAppStore.test.ts`（mock config + logger，真 SQLite + tmp fs）

### 3.2 tmp dir 取代 `vi.mock("fs")` 標準寫法

**反模式**

- `vi.mock("fs")` + `vi.mocked(fs.readFileSync).mockReturnValue("...")`
- 假設 `~/.claude.json` 內容並 mock 整個讀檔鏈路

**正確模式**

- `beforeEach` 用 `node:fs/promises.mkdtemp(path.join(os.tmpdir(), "ccc-test-"))` 建立 tmp 目錄
- 在 tmp 目錄內用 `fs.writeFile` 真實寫入要測的設定檔（`.claude.json`、`installed_plugins.json`、`config.toml`）
- 用 try/finally 暫覆寫 `process.env.HOME = tmpDir`，`afterEach` 還原
- `afterEach` `fs.rm(tmpDir, { recursive: true, force: true })`
- 抽共用 helper 至 `tests/helpers/tmpDirHelper.ts`，提供 `withTmpHome(setupFn)` 樣式

**適用檔**：`pluginScanner.test.ts` / `claudeMcpReader.test.ts` / `codexMcpReader.test.ts` / `backupService.test.ts` / `buildClaudeOptions.test.ts`

### 3.3 tmp git repo 用 `gitTestHelper.ts` 標準寫法

**反模式**

- `vi.mock("simple-git")` 並回傳假 commit hash 陣列

**正確模式**

- 使用 `tests/helpers/gitTestHelper.ts` 已存在的工具，建立 tmp git repo
- 跑真 git CLI（`git init` / `git commit` / `git checkout`），驗證 simple-git 包裝後的真實行為
- 例外情境（網路失敗、認證錯誤）才在該特定 case mock simple-git 對應方法

**適用檔**：`gitService.test.ts` / `backupService.test.ts`（push 部分）

### 3.4 合理的 boundary mock

下列才是合理的 mock 對象，重寫後仍應保留：

- `@anthropic-ai/claude-agent-sdk`（spawn CLI 子程序，不可控）
- `Bun.spawn` 對 codex CLI 的呼叫（外部執行檔）
- `simple-git` 的特定錯誤情境（網路/認證失敗模擬）
- 第三方 HTTP API 呼叫（OAuth / 外部 webhook）
- `socketService.emit*`（用 `vi.spyOn` 不用 `vi.mock`，避免污染真連線）

### 3.5 如何辨識「假整合測試」反模式

符合以下任一即為假整合，應視為 mock-only unit 測試處理：

- 檔名含 `Integration` / `Flow` / `Pipeline`，但檔頭仍見 `vi.mock("@/stores/...")`
- 檔內 mock 自家 store / service / handler 超過 3 個
- 沒有 `initTestDb()` 也沒有真 server / 真 socketClient
- 斷言全部是 `toHaveBeenCalledWith`，沒有驗 DB 或真實 emit 內容

真整合測試特徵：放在 `tests/integration/`、用 `setup/testServer.ts` 起真 server、用 `setup/socketClient.ts` 連真 ws、查真 SQLite 驗證結果。

---

## 4. 必須移除的反模式工具

### 4.1 必刪檔案

- `backend/tests/mocks/workflowModuleMocks.ts`
- `backend/tests/mocks/workflowSpySetup.ts`
- `backend/tests/mocks/workflowImplMocks.ts`
- `backend/tests/mocks/workflowTestFactories.ts`

刪除時機：**Phase 3 A 開始前先全面停用**（從引用方移除），Phase 3 B-C 重寫所有 workflow 系列與 run 系列測試完成後，這四檔一併從 git 樹中移除。

### 4.2 引用這些檔案的測試（共 12 檔：11 檔 unit + runQueueService，全部於 Phase 3 重寫）

- `backend/tests/unit/workflowQueueFlow.test.ts`
- `backend/tests/unit/workflowMultiInputService.test.ts`
- `backend/tests/unit/workflowDirectTriggerFlow.test.ts`
- `backend/tests/unit/workflowExecutionService.test.ts`
- `backend/tests/unit/workflowQueueService.test.ts`
- `backend/tests/unit/workflowHelpers.test.ts`
- `backend/tests/unit/workflowAiDecideTriggerService.test.ts`
- `backend/tests/unit/workflowPipeline.test.ts`
- `backend/tests/unit/workflowStateService.test.ts`
- `backend/tests/unit/workflowClearService.test.ts`（Phase 1 已刪除）
- `backend/tests/unit/workflowStatusDelegate.test.ts`（Phase 1 已刪除）
- `backend/tests/unit/runQueueService.test.ts`（雖列於 D 區黃金範本，實際 import `workflowImplMocks`，本波須一併移除其 import）

另：`backend/tests/mocks/index.ts` re-export `workflowModuleMocks` / `workflowSpySetup` / `workflowTestFactories`，需同步移除 export 行。

### 4.3 必刪檔案（追加說明）

- 上述 4.1 列的四檔（`workflowModuleMocks` / `workflowSpySetup` / `workflowImplMocks` / `workflowTestFactories`）為**統一淘汰**，不再採「Phase 3 結束評估」策略
- Phase 3 結束後，`runQueueService.test.ts` 改用真 SQLite + 真 store 後，才符合 D 區「純函數 0 mock」黃金範本描述
- 真正應保留的 mock 模組：`tests/mocks/claudeSdkMock.ts`（SDK 邊界）、`tests/mocks/summaryServiceMock.ts`（外部 SDK 呼叫包裝），這兩檔是合理 boundary

---

## 5. 不在範圍內的事項

- 不動 D 區黃金測試（純函數 0 mock 系列、`tests/integration/` 既有檔、provider/abortRegistry/codexService/claudeService/disposableChatService/diskSpace/uploadApi/providerHandlers/createResourceHandlers 等）
- 不引入新測試框架，沿用 Bun 啟動 + Vitest（`bun run test`）
- 不調整 CI 設定，假設 CI 直接跑 `bun run test` + `bun run style`
- 不修改任何非測試的後端程式碼（store / service / handler 行為不變）
- 不變更 WebSocket / API 對外契約（前端不受影響，無需同步前端改動）
- 不更新 skill / API 文件（依 CLAUDE.md「WebSocket 不需要更新」原則，且本計畫不動 REST router）
- 不為了測試覆蓋率而新增業務功能測試，僅做清理與重寫

---

## 6. 待確認事項

（目前已無待確認事項，使用者已就 mock 工廠淘汰、startup 整合測試、覆蓋缺口處理、handlers 目錄、commit 粒度等決策完成確認，相關內容已併入正文。）
