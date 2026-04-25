# Backend 重構計畫：統一 Pod 路徑解析 + Codex 切換為 --full-auto

## 背景與目標

目前 `resolvePodCwd` 已寫在 `backend/src/services/provider/claude/buildClaudeOptions.ts`，但實際上是死碼（沒人呼叫）。Claude 端 cwd 由 `streamingChatExecutor.resolveWorkspacePath` 決定，Codex 端 cwd 直接吃 `ctx.workspacePath`，兩條路徑解析邏輯不一致。

本次重構目標：

1. 把 `resolvePodCwd` 抽到 `backend/src/services/shared/podPathResolver.ts`，作為兩個 provider 唯一的 cwd 解析來源。
2. Claude 端與 Codex 端在 `streamingChatExecutor` 統一呼叫 `resolvePodCwd` 取得驗證過的 cwd。
3. Codex 啟動參數從 `--yolo` 改為 `--full-auto + 顯式開放網路 + 加 --cd`，符合「在指定 repo 內可讀寫、可上網」的 user flow。

不做向後相容；不動前端、不動 DB schema、不動 WebSocket protocol、不動 Pod type。

## User Flow 對應的測試案例（只列名稱）

依 `tasks/userflow.md` 需求情境，本次要覆蓋的測試案例如下（具體實作細節在最後一章）：

### Codex provider 相關
- `Codex 綁定 Repository 時 spawn cwd 與 --cd 參數一致為 repositoriesRoot/<repoId>`
- `Codex 未綁定 Repository 時 spawn cwd 與 --cd 參數一致為 pod.workspacePath`
- `Codex 新對話 args 包含 --full-auto、--skip-git-repo-check、--cd、-c sandbox_workspace_write.network_access=true、--model`
- `Codex resume 對話 args 包含 --full-auto、--cd、-c sandbox_workspace_write.network_access=true，且不含 --model`
- `Codex args 不再包含 --yolo`
- `Codex 在 repositoryId 路徑穿越時拋「非法的工作目錄路徑」並中止啟動子程序`
- `Codex 在 workspacePath 跳出 appDataRoot 時拋「工作目錄不在允許範圍內」並中止啟動子程序`
- `Codex 在綁定 Repository 時，args 中不包含 -c sandbox_workspace_write.writable_roots`（負面斷言），確保僅允許 repo 範圍內寫入；對應 userflow「使用者請 Codex 修改 Repo 之外的檔案」情境

### Claude provider 相關
- `Claude 綁定 Repository 時 SDK options.cwd 為 repositoriesRoot/<repoId>`
- `Claude 未綁定 Repository 時 SDK options.cwd 為 pod.workspacePath（在 canvasRoot 內）`
- `Claude 在 repositoryId 路徑穿越時拋「非法的工作目錄路徑」並中止 query`
- `Claude 在 workspacePath 跳出 canvasRoot 時拋「工作目錄不在允許範圍內」並中止 query`

### 共用 helper 行為
- `resolvePodCwd 合法 workspacePath 在 canvasRoot 內回傳 resolved 絕對路徑`
- `resolvePodCwd 合法 repositoryId 回傳 path.join(repositoriesRoot, repositoryId)`
- `resolvePodCwd 在 repositoryId 含 ../ 時拋「非法的工作目錄路徑」`
- `resolvePodCwd 在 workspacePath 跳出 canvasRoot 時拋「工作目錄不在允許範圍內」`

### Provider 切換情境（整合驗證）
- `同 Pod 從 Codex 切到 Claude 後 cwd 落在同一 repo 目錄`
- `同 Pod 從 Claude 切到 Codex 後 cwd 落在同一 repo 目錄`

## 關鍵技術決策

### Codex cwd 接法：方案 B

選擇方案 B：**在 `streamingChatExecutor.resolveWorkspacePath` 統一改為呼叫 `resolvePodCwd(pod)`，讓兩個 provider 都從上層拿到驗證過的路徑**。

理由：
- `codexProvider.chat(ctx)` 的 `ctx` 沒有 pod，要在 chat 內部呼叫 `resolvePodCwd(pod)` 必須擴充 `ChatRequestContext`，污染所有 provider 介面。
- 在最上層統一處理，兩個 provider 都拿到驗證過的 `workspacePath`，符合「single source of truth」。
- 路徑驗證錯誤會在進入 provider 之前就拋出，行為一致；前端錯誤訊息走既有 chat 失敗路徑。
- `streamingChatExecutor.resolveWorkspacePath` 原本還處理 `runContext.worktreePath` 的 Run mode 分支，這部分保留——只把「沒有 worktree」的分支換成 `resolvePodCwd(pod)`。

Codex 端額外做雙保險：除了 `Bun.spawn` 的 cwd 用 `ctx.workspacePath`，`buildCodexArgs` 也加 `--cd <repoPath>`，避免 codex 自身的 cwd 推斷分歧。

### resume 模式新 flag 是否一併保留

決策：**resume 模式也加上 `--cd <repoPath>` 與 `-c sandbox_workspace_write.network_access=true`**。理由：
- `--cd` 是 codex 通用旗標，resume 仍需要正確的工作目錄。
- 沙箱網路設定屬於每次執行的旗標，session 不會繼承，所以 resume 也要顯式帶。
- 但 `--skip-git-repo-check` 與 `--model` 維持原狀（resume 不帶），與既有行為一致。

### 驗收條件

實作完成後必須全部通過：

- [ ] `backend/src/services/shared/podPathResolver.ts` 已建立，export `resolvePodCwd(pod: Pod): string`，行為與舊 `buildClaudeOptions.resolvePodCwd` 一致（含中文錯誤訊息與 logger 記錄）。
- [ ] `backend/src/services/provider/claude/buildClaudeOptions.ts` 不再定義 `resolvePodCwd`，改為從 `../../shared/podPathResolver.js` re-export 或直接由呼叫端使用。
- [ ] `streamingChatExecutor.resolveWorkspacePath` 在無 Run mode worktree 時，改呼叫 `resolvePodCwd(pod)` 取得 cwd（取代原本只驗 `appDataRoot` 的邏輯）。
- [ ] Claude provider 經由 `ctx.workspacePath` 拿到的 cwd 已是 `resolvePodCwd` 解析過的結果（`runClaudeQuery.ts:360` 仍直接傳 `workspacePath` 給 SDK，但內容已驗證）。
- [ ] Codex provider 的 `chat()` 同樣使用 `ctx.workspacePath`（已驗證），並把該值同時傳給 `buildCodexArgs` 的 `--cd` 與 `Bun.spawn` 的 cwd。
- [ ] `buildCodexArgs(resumeSessionId, model, repoPath)` 簽名擴充為三參數，新對話與 resume 對話 args 內容符合本文件「Codex args 規格」章節。
- [ ] Codex args 完全不再出現 `--yolo`。
- [ ] 路徑驗證失敗時前端會收到一則中文錯誤事件並停止對話（無 silent fallback）。
- [ ] `bun run test` 全部通過。
- [ ] `bun run style`（eslint + type）零錯誤。
- [ ] 既有 `backend/tests/unit/buildClaudeOptions.test.ts` 的 `resolvePodCwd` 測試已搬到 `backend/tests/unit/podPathResolver.test.ts` 並通過。
- [ ] `backend/tests/provider/codexProvider.test.ts` 既有 args assertion 已更新為新格式並通過，且新增「spawn cwd 與 --cd 路徑一致」測試。

## Codex args 規格（本次最終版）

新對話：
- `["exec", "-", "--json", "--skip-git-repo-check", "--cd", <repoPath>, "--full-auto", "-c", "sandbox_workspace_write.network_access=true", "--model", <model>]`

resume 對話：
- `["exec", "resume", <resumeSessionId>, "-", "--json", "--cd", <repoPath>, "--full-auto", "-c", "sandbox_workspace_write.network_access=true"]`

resumeSessionId 格式不合法時的 fallback：照「新對話」規格組 args（與目前行為一致，僅替換旗標集）。

## 已知 trade-off（不在本次範圍）

- Claude `permissionMode: "bypassPermissions"` 不動，留待下一輪 discuss。
- Codex 整碟可讀屬其本身設計，無法收緊。
- `sandbox-runtime` 整合留待下一輪 discuss。

---

## 實作計畫

### Phase 1

A. 建立共用 podPathResolver
  - [ ] 建立目錄與檔案 `backend/src/services/shared/podPathResolver.ts`
  - [ ] 在新檔內實作 export function `resolvePodCwd(pod: Pod): string`
    - 依賴匯入：`path`（內建）、`Pod` from `../../types/pod.js`、`config` from `../../config/index.js`、`isPathWithinDirectory` from `../../utils/pathValidator.js`、`logger` from `../../utils/logger.js`
    - 行為一：當 `pod.repositoryId` 有值，回傳 `path.resolve(path.join(config.repositoriesRoot, pod.repositoryId))`
    - 在回傳前用 `isPathWithinDirectory(resolvedCwd, path.resolve(config.repositoriesRoot))` 驗證，失敗時 logger.error 記錄 podId 與 repositoryId，然後 `throw new Error("非法的工作目錄路徑")`
    - 行為二：當 `pod.repositoryId` 為空，回傳 `path.resolve(pod.workspacePath)`
    - 在回傳前用 `isPathWithinDirectory(resolvedCwd, path.resolve(config.canvasRoot))` 驗證，失敗時 logger.error 記錄 podId 與 workspacePath，然後 `throw new Error("工作目錄不在允許範圍內")`
    - 註解使用 zh-TW，描述兩條分支的判定條件
  - [ ] 在檔頭以 JSDoc 標註此 helper 是 Claude 與 Codex provider 共用的唯一 cwd 解析來源

### Phase 2

A. 移除 buildClaudeOptions 內的 resolvePodCwd 並更新匯入
  - [ ] 開啟 `backend/src/services/provider/claude/buildClaudeOptions.ts`
  - [ ] 刪除 `resolvePodCwd` 函式定義（以 function 名稱定位，連同其上方的 zh-TW 註解一併刪除）
  - [ ] 移除因刪除而不再使用的 import（`path`、`config`、`isPathWithinDirectory`、`logger` 若僅此函式用到）
  - [ ] 在檔案 export 區重新加上：`export { resolvePodCwd } from "../../shared/podPathResolver.js";`，避免外部 import 路徑變動連鎖修改
  - [ ] 確認檔案其它 export 行為不變

B. 更新 streamingChatExecutor.resolveWorkspacePath 接到新 helper
  - [ ] 開啟 `backend/src/services/claude/streamingChatExecutor.ts`
  - [ ] 在檔頂加上 `import { resolvePodCwd } from "../shared/podPathResolver.js";`
  - [ ] 改寫 `resolveWorkspacePath(pod, runContext)`：
    - Run mode worktree 分支保留（仍走原本 `runStore.getPodInstance` 與 `repositoriesRoot` 驗證）
    - 移除原本「驗證 pod.workspacePath 在 appDataRoot 內」的區塊
    - 改在末段直接 `return resolvePodCwd(pod)` 取代回傳 `pod.workspacePath`
  - [ ] 移除因刪除而不再使用的 import（檢查 `isPathWithinDirectory`、`config.appDataRoot` 是否還有其它呼叫；若無則移除）
  - [ ] 註解 zh-TW 補充：說明非 Run mode 時 cwd 由 `resolvePodCwd` 統一解析，repositoryId 路徑與 workspacePath 兩條分支皆由 helper 處理

### Phase 3

A. 更新 buildCodexArgs 與 codexProvider.chat 使用新 args + 新 cwd 流程
  - [ ] 開啟 `backend/src/services/provider/codexProvider.ts`
  - [ ] 修改 `buildCodexArgs` 簽名為 `(resumeSessionId: string | null, model: string, repoPath: string): string[]`
  - [ ] 「新對話」分支 args 改為：`exec`、`-`、`--json`、`--skip-git-repo-check`、`--cd`、`<repoPath>`、`--full-auto`、`-c`、`sandbox_workspace_write.network_access=true`、`--model`、`<model>`（順序按此清單）
  - [ ] 「resume 對話」分支 args 改為：`exec`、`resume`、`<resumeSessionId>`、`-`、`--json`、`--cd`、`<repoPath>`、`--full-auto`、`-c`、`sandbox_workspace_write.network_access=true`
  - [ ] 「resumeSessionId 格式不合法 fallback」分支套用「新對話」args 規格（非 resume），保留現有 logger.warn 訊息
  - [ ] 在 `chat()` 內部 `buildCodexArgs(resumeSessionId, model)` 的呼叫點改為 `buildCodexArgs(resumeSessionId, model, ctx.workspacePath)`
  - [ ] `Bun.spawn` 的 cwd 維持使用 `ctx.workspacePath`（此值已由 Phase 2-B 上層解析過）
  - [ ] 將 `spawnCodexProcess` 第二參數改名為 `repoPath` 以對齊 `buildCodexArgs` 的命名語意
  - [ ] 註解 zh-TW 補充：說明 args 含 `--cd` 是雙保險，cwd 由上層 `resolvePodCwd` 統一解析

### Phase 4

A. 移轉與更新測試
  - [ ] 建立 `backend/tests/unit/podPathResolver.test.ts`
  - [ ] 從 `backend/tests/unit/buildClaudeOptions.test.ts` 以 `describe("resolvePodCwd"` 為定位錨點搬移整個 describe block 到新檔
  - [ ] 新檔的 import 字串範例：`import { resolvePodCwd } from "../../src/services/shared/podPathResolver";`
  - [ ] 新檔保留四個 case：合法 workspacePath、合法 repositoryId、repositoryId 路徑穿越、workspacePath 跳出 canvasRoot
  - [ ] 在原 `buildClaudeOptions.test.ts` 刪除 `describe("resolvePodCwd", ...)` 區塊與相關 import（保留其它測試不動）
  - [ ] 開啟 `backend/tests/provider/codexProvider.test.ts`，更新 Case 1（首次對話 spawn 指令）的 `expect(spawnArgs).toEqual([...])`：
    - 新值為 `["codex", "exec", "-", "--json", "--skip-git-repo-check", "--cd", <測試 ctx 的 workspacePath>, "--full-auto", "-c", "sandbox_workspace_write.network_access=true", "--model", "gpt-4o"]`
  - [ ] 更新 Case 2（resume spawn 指令）的 `expect(spawnArgs).toEqual([...])`：
    - 新值為 `["codex", "exec", "resume", "session-abc123", "-", "--json", "--cd", <測試 ctx 的 workspacePath>, "--full-auto", "-c", "sandbox_workspace_write.network_access=true"]`
  - [ ] 在 `codexProvider.test.ts` 新增測試：`spawn 的 cwd 與 args 中 --cd 後一個元素必須相同`
    - 從 `spawnSpy.mock.calls[0]` 取出 args 與 spawn options，找到 `--cd` 索引並讀取下一個元素，與 spawn options.cwd 比對
  - [ ] 確認 makeCtx helper 提供的 `workspacePath` 在所有 Codex 測試案例中是同一個常數，方便斷言
  - [ ] 新增 Codex provider 路徑驗證測試：codexProvider.chat 在 `ctx.workspacePath` 為非法值時不呼叫 `Bun.spawn`（測試做法：mock 上層丟錯，用 `spawnSpy.toHaveBeenCalled()` 為 false 斷言）

B. 補強 Claude 端 workspace 解析整合
  - [ ] 在 `backend/tests/services` 或既有 streamingChatExecutor 測試檔內新增（或更新既有）case：
    - `streamingChatExecutor 在無 Run mode 時呼叫 resolvePodCwd 解析 cwd（綁定 Repository 走 repositoriesRoot 分支、未綁定走 canvasRoot 分支）`
    - `streamingChatExecutor 在 resolvePodCwd 拋錯時不會進到 provider.chat`

### Phase 5

A. 驗證與回報
  - [ ] 執行 `bun run test` 並確認 0 失敗
  - [ ] 執行 `bun run style` 並確認 eslint 與 type 0 錯誤
  - [ ] 手動 smoke check（由開發者本人執行，不在 agent 範圍）：
    - 一個綁定 Repository 的 Pod 用 Codex 對話，確認 codex 能讀寫 repo 內檔案、能成功 npm install 或 git push
    - 同一個 Pod 切到 Claude 後再對話，確認 Claude cwd 仍在同 repo 目錄
    - 不綁定 Repository 的 Pod 用 Codex 與 Claude 各自對話，確認都落在 `pod.workspacePath`
    - 把 pod 的 workspacePath 手動改成 `/tmp/evil` 後對話，確認前端收到中文錯誤訊息「工作目錄不在允許範圍內」
  - [ ] 提醒使用者：本次改動了後端，需要重啟後端服務
