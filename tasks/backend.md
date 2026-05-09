# Backend 重構計畫書：connection.status / decideStatus 拆分

## 目標摘要

- `connection.status`（`connectionStatus`）純剩執行狀態：`idle | active | queued | waiting`
- `connection.decideStatus` 成為決策結果唯一來源：`none | pending | approved | rejected | error`
- 移除 `branch:pending / branch:result / branch:clear / branch:error` 四個 WS 事件，改由 `CONNECTION_UPDATED` 廣播 `decideStatus` 變動
- 修 Bug A（`recordSourceRejection` 沒有 lazy init）與 Bug B（multi-input rejected 路徑 approved 連線卡 active/idle）

---

### Phase 1：型別 + DB schema migration

A. 移除 ConnectionStatus 中的 `ai-*` 值並執行 DB migration

- [ ] 在 `backend/src/types/connection.ts` 將 `ConnectionStatus` 型別改為只含 `"idle" | "active" | "queued" | "waiting"`，刪除 `"ai-deciding" | "ai-approved" | "ai-rejected" | "ai-error"` 四個值，同步刪除檔案頂部已過時的 JSDoc 說明（原本說明 `ai-*` 前綴保留理由）
- [ ] 在 `backend/src/database/schema.ts` 新增 migration 函式 `migrateConnectionStatusAiValues(db)`：
  - 執行 `UPDATE connections SET connection_status = 'idle' WHERE connection_status LIKE 'ai-%'`
  - 回傳 affected rows 數量，方便測試驗證
  - 在 `createTables()` 尾端呼叫此函式（位於 `cleanupLegacyAiDecideRows` 之後）
- [ ] 執行 `bun run style` 確認型別錯誤全部顯現（此步驟刻意讓編譯失敗，以找出所有需要修改的呼叫點）

**Phase 1 驗證**：`bun run style` 應顯示所有 `"ai-*"` 相關型別錯誤（compile error 是預期內），待 Phase 2 修完後才回到全綠

---

### Phase 2（可並行）

A. 修 workflowBranchTriggerService 寫入點 + 換成 CONNECTION_UPDATED 廣播

- [ ] 在 `backend/src/services/workflow/workflowBranchTriggerService.ts` 的 `setConnectionsToDeciding()` 方法：
  - 刪除 `updateConnectionStatus(..., "ai-deciding")` 呼叫
  - 改為在 `updateDecideStatus(..., "pending", null)` 之後，立即用 `connectionStore.getById()` 取回最新 connection，以 `socketService.emitToCanvas(canvasId, WebSocketResponseEvents.CONNECTION_UPDATED, payload)` 廣播（payload 型別 `ConnectionUpdatedPayload`，`requestId` 傳空字串 `""`）
- [ ] 在 `handleApprovedConnection()` 方法：
  - 刪除 `updateConnectionStatus(..., "ai-approved")` 呼叫
  - 刪除 `eventEmitter.emitBranchResult(...)` 呼叫
  - 改為在 `updateDecideStatus(..., "approved", null)` 之後廣播 `CONNECTION_UPDATED`（同上 `connectionStore.getById` 取回後廣播）
- [ ] 在 `handleRejectedConnection()` 方法：
  - 刪除 `updateConnectionStatus(..., "ai-rejected")` 呼叫
  - 改為在 `updateDecideStatus(..., "rejected", null)` 之後廣播 `CONNECTION_UPDATED`
- [ ] 在 `clearConnectionsDecidingStatus()` 方法（abort 路徑）：
  - 確認 `updateConnectionStatus(..., "idle")` 保留（`"idle"` 已是合法值，不需異動）
  - 在 `updateDecideStatus(..., "none", null)` 之後廣播 `CONNECTION_UPDATED`
- [ ] 在 `processBranchConnections()` 方法：
  - 刪除 `eventEmitter.emitBranchPending(...)` 呼叫（此事件整個移除，由 `setConnectionsToDeciding` 廣播的 `CONNECTION_UPDATED` 取代）
  - 刪除 AI 選 None 時對 `representativeConn` 的 `eventEmitter.emitBranchResult(...)` 呼叫（rejected path 已在 `handleRejectedConnection` 逐條廣播 `CONNECTION_UPDATED`）

B. 修 Bug A（`recordSourceRejection` lazy init）+ Bug B（multi-input rejected 收尾）+ 放鬆 `shouldDeferToMultiInput`

- [ ] 在 `backend/src/services/pendingTargetStore.ts` 的 `recordSourceRejection()` 方法：
  - 更新方法簽名，加上 `requiredSourcePodIds?: string[]` 選填參數（第三個參數）
  - 在方法首行加上 lazy init：若 `!this.pendingTargets.has(targetPodId) && requiredSourcePodIds` 為真，先呼叫 `this.initializePendingTarget(targetPodId, requiredSourcePodIds)` 再繼續執行原有邏輯
- [ ] 在 `backend/src/services/workflow/workflowBranchTriggerService.ts` 的 `handleRejectedMultiInput()` 方法：
  - 呼叫 `this.deps.pendingTargetStore.recordSourceRejection(...)` 時，新增第四個引數傳入 `requiredSourcePodIds`
  - `requiredSourcePodIds` 的值從 `this.deps.stateService.checkMultiInputScenario(canvasId, connection.targetPodId).requiredSourcePodIds` 取得
- [ ] 在 `shouldDeferToMultiInput()` 方法：
  - 移除 `this.deps.pendingTargetStore.hasPendingTarget(pendingKey)` 條件
  - 回傳值改為只要 `isMultiInput` 為 true 就回傳 true（即 `return isMultiInput`）
- [ ] 在 `backend/src/services/workflow/workflowMultiInputService.ts` 的 `handleMultiInputForConnection()` 方法，在 `readiness !== "ready"` 的 return 前加入 Bug B 收尾邏輯：
  - 判斷條件：`readiness === "rejected"` 時才執行
  - 從 `getMultiInputGroupConnections(canvasId, connection.targetPodId)` 取得同組連線
  - 過濾出 `conn.decideStatus === "approved"` 的連線（表示這些連線已被 AI 選中但 multi-input 整組被 rejected）
  - 對每條 approved 連線呼叫 `connectionStore.updateConnectionStatus(canvasId, conn.id, "idle")`
  - 再呼叫 `connectionStore.getById(canvasId, conn.id)` 取回最新資料，廣播 `CONNECTION_UPDATED`
  - 此操作不改 `decideStatus`（維持 `"approved"`），只收回執行狀態

C. 移除 branch:* 事件定義

- [ ] 在 `backend/src/services/workflow/workflowEventEmitter.ts` 刪除以下方法整體（含 import 若無其他使用者）：
  - `emitBranchPending()`
  - `emitBranchResult()`
  - `emitBranchError()`
  - `emitBranchClear()`
- [ ] 在 `backend/src/schemas/events.ts` 的 `WebSocketResponseEvents` enum 刪除以下四個 entry：
  - `WORKFLOW_BRANCH_PENDING = "workflow:branch:pending"`
  - `WORKFLOW_BRANCH_RESULT = "workflow:branch:result"`
  - `WORKFLOW_BRANCH_ERROR = "workflow:branch:error"`
  - `WORKFLOW_BRANCH_CLEAR = "workflow:branch:clear"`
- [ ] 在 `backend/src/types/responses/workflow.ts` 刪除以下四個 interface 與相關 import：
  - `WorkflowBranchPendingPayload`
  - `WorkflowBranchResultPayload`
  - `WorkflowBranchErrorPayload`
  - `WorkflowBranchClearPayload`
- [ ] 在 `backend/src/handlers/workflowHandlers.ts`，找到 workflow:clear handler 中的 `workflowEventEmitter.emitBranchClear(...)` 區塊：
  - 改為對 `result.clearedConnectionIds` 中每條連線呼叫 `connectionStore.getById(canvasId, connId)`，廣播 `CONNECTION_UPDATED`
- [ ] 執行 `bun run style`，根據輸出清除所有殘留引用（被刪除 payload type、enum entry、emitBranch* 方法）

**Phase 2 驗證**：
- `bun run style` 全綠（型別錯誤歸零）
- `bun run test` 大量測試失敗（預期，Phase 3 修）

---

### Phase 3：BE 測試改寫 + 補新測試

A. 改寫既有測試斷言

- [ ] `backend/tests/unit/connectionStatusPersistence.test.ts`：
  - 第 11–19 行：刪除 `ALL_CONNECTION_STATUSES` 陣列中的 `"ai-deciding" | "ai-approved" | "ai-rejected" | "ai-error"` 四個值，陣列只保留 `"idle" | "active" | "queued" | "waiting"`
  - `it.each` 測試數量從 8 個降為 4 個
- [ ] `backend/tests/unit/workflowBranchTriggerService.test.ts`：
  - 第 118–122 行：刪除 `emitBranchPending` 和 `emitBranchResult` 的 spy setup，改為 spy `socketService.emitToCanvas`（`vi.spyOn(socketService, "emitToCanvas").mockImplementation(() => {})`）
  - 第 163 行附近：approved 路徑斷言，將 `expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, "conn-1", "ai-approved")` 改為：
    - `expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(CANVAS_ID, "conn-1", "approved", null)`
    - `expect(socketService.emitToCanvas).toHaveBeenCalledWith(CANVAS_ID, "connection:updated", expect.objectContaining({ success: true }))`
  - 刪除原有 `expect(workflowEventEmitter.emitBranchResult).toHaveBeenCalledWith(...)` 斷言
  - 第 215 行附近：rejected 路徑斷言，將 `expect(connectionStore.updateConnectionStatus).toHaveBeenCalledWith(CANVAS_ID, "conn-branch-1", "ai-rejected")` 改為 `expect(connectionStore.updateDecideStatus).toHaveBeenCalledWith(CANVAS_ID, "conn-branch-1", "rejected", null)`
  - 刪除原有 `expect(workflowEventEmitter.emitBranchResult).toHaveBeenCalledWith(...)` 斷言
  - 第 250 行附近：None 路徑斷言，同上，對兩條連線各改為斷言 `updateDecideStatus` 為 `"rejected"`
- [ ] `backend/tests/unit/workflowMultiInputService.test.ts`：
  - 第 362–383 行：有拒絕來源時不觸發的測試，新增斷言：`connectionStore.updateConnectionStatus` 對 approved 連線被呼叫為 `"idle"`，且 `socketService.emitToCanvas` 被呼叫帶 `"connection:updated"` 事件

B. 補新測試（Bug A / Bug B 驗收）

- [ ] `backend/tests/unit/pendingTargetStore.test.ts`，新增 describe 區塊「`recordSourceRejection` 早到時的 lazy init 行為」：
  - Case 1：在未呼叫 `initializePendingTarget` 的情況下直接呼叫 `recordSourceRejection(targetPodId, sourcePodId1, "reason", [sourcePodId1, sourcePodId2])`，驗證 `getRejectedSources(targetPodId)?.size` 為 1，`hasPendingTarget(targetPodId)` 為 true
  - Case 2：承接 Case 1，再呼叫 `recordSourceCompletion(targetPodId, sourcePodId2, "summary")`，驗證回傳 `{ allSourcesResponded: true, hasRejection: true }`
- [ ] `backend/tests/unit/workflowBranchTriggerService.test.ts`，新增 describe 區塊「multi-input rejection 早到：`shouldDeferToMultiInput` 不依賴 `hasPendingTarget`」：
  - 設定 `workflowStateService.checkMultiInputScenario` 回傳 `{ isMultiInput: true, requiredSourcePodIds: [SOURCE_POD_ID, "source-pod-2"] }`
  - 設定 `pendingTargetStore.hasPendingTarget` 回傳 `false`
  - 讓 `decideBranch` 回傳 `{ selectedConnectionId: null, rejectedConnectionIds: ["conn-branch-1"] }`
  - 呼叫 `processBranchConnections`，驗證 `pendingTargetStore.recordSourceRejection` 仍被呼叫（不因 `hasPendingTarget: false` 而跳過）
- [ ] `backend/tests/unit/workflowMultiInputService.test.ts`，新增 describe 區塊「rejected 路徑：approved connection 狀態收尾」：
  - 設定 `pendingTargetStore.recordSourceCompletion` 回傳 `{ allSourcesResponded: true, hasRejection: true }`
  - 設定 multi-input group 包含一條 `decideStatus: "approved"` 的連線
  - 呼叫 `handleMultiInputForConnection`，驗證：`connectionStore.updateConnectionStatus` 對 approved 連線被呼叫為 `"idle"`，且 `socketService.emitToCanvas` 被呼叫帶 `"connection:updated"` 事件
  - `executionService.triggerWorkflowWithSummary` 不被呼叫

**Phase 3 驗證**：
- `bun run test` 全綠
- `bun run style` 全綠
- 告知使用者重啟後端

---

## 測試規劃

### Mock 邊界

**必須 mock**（外部邊界）：
- `branchDecisionService.decideBranch`（外部 AI 呼叫邊界）
- `workflowPipeline.execute`（下游 pipeline，避免觸發真實執行）
- `podStore.getById`（DB 邊界，unit test 用假 pod）
- `socketService.emitToCanvas`（side-effect only，驗證廣播呼叫）
- `connectionStore.updateDecideStatus` / `updateConnectionStatus` / `getById`（DB 邊界，unit test 控制回傳值）
- `workflowStateService.checkMultiInputScenario`（避免真實 DB 查詢）
- `logger`（side-effect only）

**不能 mock**（內部邏輯，必須用真實實例）：
- `pendingTargetStore`：測試 Bug A lazy init 行為，需要驗證真實 in-memory 狀態，mock 掉就失去意義
- `workflowBranchTriggerService` / `workflowMultiInputService`：被測試的對象本身，不可 mock 自己測試的 service

### A 類（Schema / 型別）

- `connectionStatusPersistence.test.ts`：每個合法 `ConnectionStatus` 值（`idle / active / queued / waiting`）寫入後可正確讀取，共 4 個 smoke test（從原本 8 個改為 4 個）

### B 類（業務規則）

- Branch approved 路徑：`decideBranch` 選中 → `updateDecideStatus("approved")` 被呼叫、`CONNECTION_UPDATED` 被廣播、pipeline 被觸發
- Branch rejected 路徑：所有連線被拒 → `updateDecideStatus("rejected")` 被呼叫、`CONNECTION_UPDATED` 被廣播、pipeline 不觸發
- Branch None 路徑（AI 選 None）：`selectedConnectionId=null`，所有連線 `updateDecideStatus("rejected")`、pipeline 不觸發
- Branch abort 路徑：`BranchAbortError` → 所有連線 `updateDecideStatus("none")` + `updateConnectionStatus("idle")`、pipeline 不觸發
- Bug A — rejection 早到 lazy init：`recordSourceRejection` 在無 pending target 時傳入 `requiredSourcePodIds` 後仍正確記錄 rejection 並計算 `allSourcesResponded`
- Bug A — `shouldDeferToMultiInput` 不依賴 `hasPendingTarget`：`isMultiInput: true` + `hasPendingTarget: false` → 仍進入 multi-input rejection 路徑
- Bug B — approved connection 收尾：multi-input 有 rejection 時，已 approved 的連線 `connectionStatus` 被更新為 `"idle"` 且廣播 `CONNECTION_UPDATED`
- multi-input 部分拒絕不觸發 workflow（已有）：`hasRejection: true` 時 `triggerWorkflowWithSummary` 不被呼叫
