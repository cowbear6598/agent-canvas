# Frontend 重構計畫 — connection.status / decideStatus 拆分

> 把 `connection.status` 上「執行狀態」與「AI 決策結果」兩個概念拆開：
> - `connection.status` 純剩執行狀態（`idle | active | queued | waiting`）
> - `connection.decideStatus` 承載決策結果（`none | pending | approved | rejected | error`）
> - 移除 `branch:pending / branch:result / branch:clear / branch:error` 四個 WS event 的 FE handler，改靠 `CONNECTION_UPDATED` 事件廣播的 `decideStatus` 做狀態同步
> - 修正 Bug A（multi-input rejection 早於 approval 到達時被靜默丟掉）與 Bug B（approved branch 卡在 running 樣式導致橡皮擦永遠 disabled）

---

## 測試案例（先列出名稱，最後展開）

依 user flow 步驟對應（B 類業務規則為主）：

1. `connectionStore — isWorkflowRunning`：branch connection 的 `decideStatus === "pending"` 也算 running，橡皮擦應 disabled
2. `connectionStore — isWorkflowRunning`：所有 connection 回到 `status=idle` 且 `decideStatus` 不為 pending，橡皮擦應 enabled
3. `connectionStore — isWorkflowRunning`：multi-input 情境 — 一條 approved 一條 rejected，整條 workflow 算完成後橡皮擦 enabled（Bug B 修正驗證）
4. `connectionStore — isOutOfOrderUpdate`（重命名後）：`decideStatus === "pending"` 時收到 `status = "active"` 的 CONNECTION_UPDATED → 應被拒絕覆蓋
5. `connectionStore — updateConnectionFromEvent`：收到含 `decideStatus: "approved"` 的 payload → `connection.decideStatus` 更新為 `"approved"`
6. `connectionStore — updateConnectionFromEvent`：收到不含 `decideStatus` 欄位的 payload → 保留 connection 現有 `decideStatus`
7. `workflowEventHandlers`：移除 `handleBranchPending / handleBranchResult / handleBranchError / handleBranchClear` 後，這四個 handler 不再存在於導出物件

排除（無邏輯測試，依 plan-guide.md）：
- ConnectionLine template / DOM 渲染結果（class binding 本身由 Vue 保證，只要 props 正確即可）
- Store 初始狀態欄位
- 一行 computed getter（`getBranchConnectionsBySourcePodId` 等）

Mock 邊界：
- 可 mock：`websocketClient`（最外層 WS wrapper，既有測試已用此切點）
- 不 mock：`useConnectionStore`、`usePodStore`（Pinia store 用真實實作，直接操作 state 驗證行為）
- 不 mock：`vue-i18n`、`pinia` 內部

---

## Phase 1：型別擴充

### A. 型別變更（connection.ts / websocket/responses.ts）

- [ ] 在 `frontend/src/types/connection.ts`，`ConnectionStatus` union 移除四個值：`"ai-deciding" | "ai-approved" | "ai-rejected" | "ai-error"`；保留 `"idle" | "active" | "queued" | "waiting"`
- [ ] 在 `frontend/src/types/connection.ts`，新增型別匯出：
  ```
  export type DecideStatus = "none" | "pending" | "approved" | "rejected" | "error";
  ```
- [ ] 在 `frontend/src/types/connection.ts`，`Connection` interface 新增欄位：
  - `decideStatus: DecideStatus`（必填，BE DB 有 default `'none'`，正規路徑一定帶值）
- [ ] 在 `frontend/src/types/websocket/responses.ts`，`ConnectionPayloadItem` 的 `connectionStatus` union 移除四個值，僅保留 `"idle" | "active" | "queued" | "waiting"`；`decideStatus` 欄位已存在（第 143 行），確認型別與 `DecideStatus` 一致即可（若已是 optional literal union，只需對齊 `none | pending | approved | rejected | error`）

驗證點：執行 `bun run style`，確認 TypeScript 對 `connection.status` 型別的使用全部通過，無 `ai-deciding` 等舊值殘留錯誤。

---

## Phase 2（可並行）

### A. connectionStore — RUNNING 集合 / BFS / isOutOfOrderUpdate 改寫

- [ ] 在 `frontend/src/stores/connectionStore.ts`，`RUNNING_CONNECTION_STATUSES` 集合移除 `"ai-deciding"` 與 `"ai-approved"`，保留 `"active" | "queued" | "waiting"`（三個執行中狀態）
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`RawConnection` interface（第 46–67 行）新增欄位 `decideStatus?: string`（接收 WS payload 的 decideStatus 字串）
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`normalizeConnection` 函式（第 77–92 行）新增對應：`decideStatus: (raw.decideStatus as DecideStatus) ?? "none"` — 此處 `?? "none"` 僅做型別 narrowing 用，BE 正規路徑必然帶值
  - 同時移除 `status` 從 `raw.connectionStatus` 中接收 `ai-*` 的路徑（型別收窄後 TypeScript 自動保證）
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`isOutOfOrderUpdate` 函式（第 109–114 行）改為比較 `decideStatus`：
  - 函式簽名改為 `isOutOfOrderUpdate(currentDecideStatus: DecideStatus | undefined, incomingStatus: ConnectionStatus): boolean`
  - 邏輯改為：`return currentDecideStatus === "pending" && incomingStatus === "active"`
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`shouldUpdateConnection` 函式（第 116–126 行）傳遞參數對齊：把 `connection.status` 改為 `connection.decideStatus` 傳入 `isOutOfOrderUpdate`
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`isAnyNeighborRunning` 函式（第 132–149 行）BFS 判斷條件改為 OR 組合：
  - 既有 `RUNNING_CONNECTION_STATUSES.has(connection.status)` 保留
  - 新增條件：`|| connection.decideStatus === "pending"`
  - 完整條件：`RUNNING_CONNECTION_STATUSES.has(connection.status) || connection.decideStatus === "pending"`
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`updateConnectionFromEvent` 函式（第 979–1010 行）新增 `decideStatus` 的合併邏輯：
  - 若 incoming connection 有帶 `decideStatus`（非 undefined）→ 以 incoming 值覆寫
  - 若 incoming 未帶（undefined）→ 保留 `existingConnection.decideStatus`
  - 同時移除 `status: existingConnection.status` 這行（改靠 `decideStatus` 管理決策狀態；`status` 欄位仍保留但只反映執行狀態，由 workflow event handlers 維護）
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`addConnectionFromEvent` 函式（第 962–977 行）初始化新增 `decideStatus: "none" as DecideStatus`
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`loadConnectionsFromBackend` 透過 `normalizeConnection` 處理，不需額外改動（`normalizeConnection` 已包含 `decideStatus` 轉換）

### B. workflowEventHandlers — 移除 branch:* handler

- [ ] 在 `frontend/src/stores/workflowEventHandlers.ts`，移除以下四個 handler 及其依賴的 helper（`updateConnectionStatuses` 若僅被這四個 handler 使用則一併移除）：
  - `handleBranchPending`
  - `handleBranchResult`
  - `handleBranchError`
  - `handleBranchClear`
- [ ] 在 `frontend/src/stores/workflowEventHandlers.ts`，更新 `createWorkflowEventHandlers` 的回傳型別，移除這四個方法的型別宣告（第 42–61 行的 return type interface）
- [ ] 在 `frontend/src/stores/workflowEventHandlers.ts`，移除 `clearAiDecideStatusByConnectionIds` 函式（此函式是為了讓 `handleBranchClear` 呼叫；clear 功能改由 `updateConnectionFromEvent` 消費 `CONNECTION_UPDATED` 的 `decideStatus` 完成）
- [ ] 在 `frontend/src/stores/connectionStore.ts`，`workflowEventMap` 陣列（第 397–442 行）移除以下四個 event 的綁定：
  - `WebSocketResponseEvents.WORKFLOW_BRANCH_PENDING`
  - `WebSocketResponseEvents.WORKFLOW_BRANCH_RESULT`
  - `WebSocketResponseEvents.WORKFLOW_BRANCH_ERROR`
  - `WebSocketResponseEvents.WORKFLOW_BRANCH_CLEAR`
- [ ] 在 `frontend/src/stores/connectionStore.ts`，移除對應 handler 的 import（`handleBranchPending` 等）與 event 型別 import（`WorkflowBranchPendingPayload` 等）
- [ ] 在 `frontend/src/stores/connectionStore.ts`，移除 `clearAiDecideStatusByConnectionIds` 方法的定義與 return 中的匯出
- [ ] 在 `frontend/src/composables/pod/useWorkflowClear.ts`，移除呼叫 `connectionStore.clearAiDecideStatusByConnectionIds(...)` 的段落（第 110–123 行），改靠後端廣播的 `CONNECTION_UPDATED` 帶 `decideStatus: "none"` 自動清除
  - 同時移除 `ClearStores` interface 中的 `clearAiDecideStatusByConnectionIds` 欄位定義
- [ ] 在呼叫 `useWorkflowClear` 的組件（`frontend/src/composables/pod/` 或相關 Pod 組件），移除傳入 `connectionStore.clearAiDecideStatusByConnectionIds` 的地方

### C. ConnectionLine.vue + CSS class binding 改寫

- [ ] 在 `frontend/src/components/canvas/ConnectionLine.vue`，props 新增 `decideStatus?: DecideStatus`，預設值 `"none"`；同時保留 `status?: ConnectionStatus`
- [ ] 在 `ConnectionLine.vue`，`BRANCH_STATUS_COLOR_MAP`（第 87–94 行）key 改為 `decideStatus` 的值：
  - `"pending"` → `oklch(0.65 0.14 300 / 0.8)`（原 `ai-deciding`，顏色值不變）
  - `"rejected"` → `oklch(0.65 0.15 20)`（原 `ai-rejected`，顏色值不變）
  - `"error"` → `oklch(0.7 0.15 60 / 0.8)`（原 `ai-error`，顏色值不變）
  - `"approved"` → `BRANCH_STATUS_COLOR_DEFAULT`（原 `ai-approved`，顏色值不變）
  - 移除 map 中以 `ai-` 為 key 的四個舊項目
- [ ] 在 `ConnectionLine.vue`，`getBranchStatusColor` 函式（第 96–98 行）傳入 `props.decideStatus` 而非 `props.status`
- [ ] 在 `ConnectionLine.vue`，`lineColor` computed（第 105–110 行）改為：若 `triggerMode === "branch"` 則傳入 `decideStatus` 給 `getBranchStatusColor`
- [ ] 在 `ConnectionLine.vue`，`BRANCH_STATUS_LABEL_MAP`（第 121–125 行）key 改為 `decideStatus` 的值：
  - `"pending"` → `{ type: "deciding", text: "", class: "deciding-label" }`（原 `ai-deciding`）
  - `"rejected"` → `null`（原 `ai-rejected`）
  - `"error"` → `{ type: "error", text: "!", class: "error-label" }`（原 `ai-error`）
  - 移除 `ai-` 前綴的三個舊 key
- [ ] 在 `ConnectionLine.vue`，`midLabel` computed（第 127–141 行）改為用 `props.decideStatus` 查表，而非 `props.status`
- [ ] 在 `ConnectionLine.vue`，`tooltipText` computed（第 143–159 行）條件改為：
  - `props.decideStatus === "rejected"` → 顯示 rejected tooltip
  - `props.decideStatus === "error"` → 顯示 error tooltip
- [ ] 在 `ConnectionLine.vue`，`useXMarker` computed（第 205–207 行）條件改為：
  - `props.triggerMode === "branch" && props.decideStatus === "rejected"`
- [ ] 在 `ConnectionLine.vue`，template `<g>` root 的 class 綁定（第 278–293 行）改為：
  - 移除 `'ai-deciding': status === 'ai-deciding'`、`'ai-approved': status === 'ai-approved'`、`'ai-rejected': status === 'ai-rejected'`、`'ai-error': status === 'ai-error'`
  - 新增（依 `decideStatus`）：`deciding: decideStatus === 'pending'`、`approved: decideStatus === 'approved'`、`rejected: decideStatus === 'rejected'`、`error: decideStatus === 'error'`
  - 保留 `status === 'active'`、`status === 'idle'`、`status === 'queued'`、`status === 'waiting'` 的 class 綁定（這四個不變）
- [ ] 在 `ConnectionLine.vue`，`v-show` 條件中使用 `status === 'ai-approved'` 的地方（第 324–330 行）改為 `decideStatus === 'approved'`
- [ ] 在 `ConnectionLine.vue`，animated arrows 的 `v-if` 條件（第 338 行）：`status === 'active' || status === 'ai-deciding'` 改為 `status === 'active' || decideStatus === 'pending'`
- [ ] 在 `frontend/src/assets/styles/doodle/connections.css`，selectors 改名（第 107–126 行），顏色值與 keyframes 100% 不動：
  - `.connection-line.ai-deciding` → `.connection-line.deciding`
  - `.connection-line.ai-approved` → `.connection-line.approved`
  - `.connection-line.ai-rejected` → `.connection-line.rejected`
  - `.connection-line.ai-error` → `.connection-line.error`
- [ ] 在 `ConnectionLine.vue` 的 parent（呼叫 `<ConnectionLine>` 的地方），傳入新 prop `decideStatus`（從 `connection.decideStatus` 取）；找出 `frontend/src/components/canvas/` 內所有渲染 ConnectionLine 的地方並補上 prop

驗證點：執行 `bun run style`，確認無型別與 lint 錯誤。

---

## Phase 3：測試改寫

### A. connectionStore 測試改寫

- [ ] 在 `frontend/tests/stores/connectionStore.test.ts`，`createMockConnection` factory 呼叫（或 `frontend/tests/helpers/factories.ts`）新增 `decideStatus: "none"` 預設值
- [ ] 移除所有斷言 `connection.status === "ai-deciding"` / `"ai-approved"` / `"ai-rejected"` / `"ai-error"` 的測試案例（共約 17 個），改為以下新案例：
- [ ] 新增測試：`isWorkflowRunning — branch connection decideStatus === "pending" 時橡皮擦應 disabled`
  - Arrange：head pod + branch connection（`status: "idle"`, `decideStatus: "pending"`）+ downstream pod
  - Act：`isWorkflowRunning("head-pod")`
  - Assert：回傳 `true`
- [ ] 新增測試：`isWorkflowRunning — 所有 connection status=idle 且 decideStatus="none" 時應回 false`
  - Arrange：head pod + connection（`status: "idle"`, `decideStatus: "none"`）+ downstream pod（status: idle）
  - Act：`isWorkflowRunning("head-pod")`
  - Assert：回傳 `false`
- [ ] 新增測試：`isWorkflowRunning — multi-input 一條 approved 一條 rejected 且 downstream pod idle → 橡皮擦 enabled`
  - Arrange：head pod → conn-1（`decideStatus: "approved"`）+ head2 pod → conn-2（`decideStatus: "rejected"`），共同 downstream pod（`status: "idle"`）
  - Act：`isWorkflowRunning("head-pod")`
  - Assert：回傳 `false`（修正 Bug B：`"rejected"` 不再讓 isWorkflowRunning 卡在 true）
- [ ] 新增測試：`isOutOfOrderUpdate — decideStatus 為 pending 時，incoming status = active 應被拒`
  - 透過 `connectionStore`：建立一條 `decideStatus: "pending"` 的 connection，觸發 auto group status update 為 `"active"`
  - Assert：`connection.status` 保持原值，不被更新為 `"active"`
- [ ] 新增測試：`updateConnectionFromEvent — 收到 decideStatus: "approved" → connection.decideStatus 更新`
  - Arrange：store 中有 `decideStatus: "none"` 的 connection
  - Act：`store.updateConnectionFromEvent({ id: "conn-1", ..., decideStatus: "approved" })`
  - Assert：`connection.decideStatus === "approved"`
- [ ] 新增測試：`updateConnectionFromEvent — 收到不含 decideStatus 的 payload → 保留現有 decideStatus`
  - Arrange：store 中有 `decideStatus: "pending"` 的 connection
  - Act：`store.updateConnectionFromEvent({ id: "conn-1", ... })` （無 decideStatus 欄位）
  - Assert：`connection.decideStatus === "pending"`（不被清掉）
- [ ] 在原有 `handleBranchPending / handleBranchResult / handleBranchError / handleBranchClear` 的測試區塊（第 1130–1283 行）刪除全部案例，因為這四個 handler 已被移除

### B. workflowEventHandlers 測試改寫

- [ ] 在 `frontend/tests/stores/workflowEventHandlers.test.ts`，刪除以下 describe 區塊（第 268–398 行）：
  - `handleBranchPending`（7 行）
  - `handleBranchResult`（兩個 case，共約 55 行）
  - `handleBranchError`
  - `handleBranchClear`
  - `clearAiDecideStatusByConnectionIds`
- [ ] 確認保留其餘 handler 的測試（`handleWorkflowAutoTriggered`、`handleWorkflowComplete`、`handleWorkflowDirectTriggered` 等）原封不動

### C. canvasPodFlow 整合測試改寫

- [ ] 在 `frontend/tests/integration/canvasPodFlow.test.ts`，第 362 行測試（`驗證 AI Decide 流程：idle -> ai-deciding -> ai-approved`）改為：
  - 移除 `handleBranchPending` / `handleBranchResult` 呼叫
  - 改為直接呼叫 `store.updateConnectionFromEvent({ id: "conn-1", ..., decideStatus: "approved" })`
  - Assert：`connection.decideStatus === "approved"`（不再檢查 `status`）
- [ ] 第 397 行測試（`idle -> ai-deciding -> ai-rejected`）以相同方式改寫：
  - `updateConnectionFromEvent({ ..., decideStatus: "rejected" })`
  - Assert：`connection.decideStatus === "rejected"`

### D. factories.ts 更新

- [ ] 在 `frontend/tests/helpers/factories.ts`，`createMockConnection` 的預設值加入 `decideStatus: "none" as DecideStatus`
  - 同時 import `DecideStatus` 型別

### E. 驗證

- [ ] 執行 `bun run test`，確認所有測試通過
- [ ] 執行 `bun run style`，確認 eslint + tsc 無錯誤

---

## 測試案例詳述

### Mock 邊界

- **可 mock**：`websocketClient`（`frontend/tests/helpers/mockWebSocket.ts` 既有 factory，沿用）
- **不可 mock**：`useConnectionStore`、`usePodStore`（Pinia store 用真實實作；測試直接操作 `.connections`、讀 computed）
- **不 mock**：`vue-i18n`、`pinia` 內部

### B 類業務規則測試

| 編號 | 規則 | 場景 | 預期結果 |
|------|------|------|----------|
| B1 | BFS 加 decideStatus 條件 | branch connection `decideStatus === "pending"`，其餘 pod idle | `isWorkflowRunning` 回傳 `true` |
| B2 | BFS — 全部完成 | 所有 connection `status=idle, decideStatus="none"` | `isWorkflowRunning` 回傳 `false` |
| B3 | Bug B 修正 | multi-input 一 approved 一 rejected，downstream pod idle | `isWorkflowRunning` 回傳 `false`（不卡） |
| B4 | isOutOfOrderUpdate | connection `decideStatus="pending"` 時收 `status=active` update | `connection.status` 不被覆蓋 |
| B5 | CONNECTION_UPDATED 消費 decideStatus | payload 帶 `decideStatus: "approved"` | `connection.decideStatus === "approved"` |
| B6 | CONNECTION_UPDATED 未帶 decideStatus | payload 不含 `decideStatus` | 保留現有 `connection.decideStatus` |

### 排除（不寫）

- ConnectionLine class binding 的 DOM 渲染（Vue 保證 class binding 正確，不需測）
- store getter（`getBranchConnectionsBySourcePodId` 為純 filter，無業務分支）
- 初始狀態 `connections = []`
- CSS selector 名稱（CSS 由 browser 驗證，不需 JS test）

---

## 提醒

- 錯誤訊息與程式碼註解一律使用 zh-TW（依 CLAUDE.md）
- 後端已改由 `CONNECTION_UPDATED` 事件廣播 `decideStatus`，FE 只需消費 `handleConnectionUpdated` 帶進來的 payload，不需另外訂閱 `branch:pending` 等事件
- `clearAiDecideStatusByConnectionIds` 的清除責任改由後端：清除 workflow 時 BE 會廣播每條 connection 的 `CONNECTION_UPDATED`（`decideStatus: "none"`），FE 的 `handleConnectionUpdated` 自動消費，不需在 `useWorkflowClear` 手動清
- 視覺顏色、動畫、線條樣式 100% 保留（僅 CSS selector 名稱由 `.ai-*` 改為 `.deciding / .approved / .rejected / .error`）
- 後端已有改動，需告知使用者重啟後端服務
