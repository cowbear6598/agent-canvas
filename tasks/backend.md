# 修復 WriteQueue 非同步寫入 Race Condition

## 問題描述

`podStore.modifyPod()` 呼叫 `persistPodAsync()` 是 fire-and-forget（回傳 void），導致 handler 發 WS 回應時磁碟可能還沒寫完。測試中 `loadFromDisk` 讀到舊資料，造成 flaky test。

## 修復策略

讓 `WriteQueue.enqueue` 回傳 `Promise<void>`，一路往上傳遞到 setter 方法，使 handler 層可以選擇 await 確保磁碟寫完。

核心設計決策：setter 方法的回傳型別從 `void` 改為 `Promise<void>`，呼叫端可以選擇 await 或 fire-and-forget。

---

## 測試案例定義

### `backend/tests/unit/writeQueue.test.ts`（新增或補充）

- enqueue 回傳 Promise 且該 Promise 在 writeFn 完成後 resolve
- enqueue 回傳的 Promise 在 writeFn 失敗後仍 resolve（不 reject，因為錯誤已被 catch 處理）
- 連續 enqueue 同一個 key，後續的 Promise 等待前一個完成後才 resolve

### `backend/tests/integration/command.test.ts`（修改現有）

- 綁定 Command 後重新載入仍保留（修正 race condition）

---

## 實作計畫

### 第 1 步：修改 WriteQueue.enqueue 回傳 Promise

- [ ] 修改 `backend/src/utils/writeQueue.ts` 的 `enqueue` 方法
  - 回傳型別從 `void` 改為 `Promise<void>`
  - 回傳 `nextWrite` 這個已經存在的 Promise（即 `this.queues.set(key, nextWrite)` 中的 nextWrite）
  - 注意：`nextWrite` 的 `.catch()` 已經處理了錯誤並回傳 `undefined`，所以回傳的 Promise 永遠 resolve 不會 reject，這是正確行為

### 第 2 步：修改 persistPodAsync 回傳 Promise

- [ ] 修改 `backend/src/services/podStore.ts` 的 `persistPodAsync` 方法
  - 回傳型別從 `void` 改為 `Promise<void>`
  - 找不到 canvasDir 時回傳 `Promise.resolve()`（而非 return）
  - 回傳 `this.writeQueue.enqueue(...)` 的結果

### 第 3 步：修改 modifyPod 回傳結構

- [ ] 修改 `backend/src/services/podStore.ts` 的 `modifyPod` 方法
  - 回傳型別從 `Pod | undefined` 改為 `{ pod: Pod | undefined; persisted: Promise<void> }`
  - 當 `shouldPersist` 為 true 時，`persisted` 為 `this.persistPodAsync(...)` 的結果
  - 當 `shouldPersist` 為 false 或 pod 不存在時，`persisted` 為 `Promise.resolve()`

### 第 4 步：修改所有 setter 方法回傳 Promise

以下所有方法的回傳型別從 `void` 改為 `Promise<void>`，回傳 `this.modifyPod(...).persisted`：

- [ ] `setClaudeSessionId` — 回傳 `this.modifyPod(...).persisted`
- [ ] `resetClaudeSession` — 回傳 `this.setClaudeSessionId(...)`
- [ ] `setOutputStyleId` — 回傳 `this.modifyPod(...).persisted`
- [ ] `addIdToArrayField` — 回傳 `this.modifyPod(...).persisted`，注意提前 return 時回傳 `Promise.resolve()`
- [ ] `addSkillId` — 回傳 `this.addIdToArrayField(...)`
- [ ] `addSubAgentId` — 回傳 `this.addIdToArrayField(...)`
- [ ] `addMcpServerId` — 回傳 `this.addIdToArrayField(...)`
- [ ] `removeMcpServerId` — 回傳 `this.modifyPod(...).persisted`，注意提前 return 時回傳 `Promise.resolve()`
- [ ] `setRepositoryId` — 回傳 `this.modifyPod(...).persisted`
- [ ] `setAutoClear` — 回傳 `this.modifyPod(...).persisted`
- [ ] `setCommandId` — 回傳 `this.modifyPod(...).persisted`
- [ ] `setScheduleLastTriggeredAt` — 回傳 `this.modifyPod(...).persisted`，注意提前 return 時回傳 `Promise.resolve()`

### 第 5 步：修改 setSlackBinding 回傳 Promise

- [ ] `setSlackBinding` 回傳型別從 `void` 改為 `Promise<void>`
  - binding 為 null 的分支：直接回傳 `this.persistPodAsync(canvasId, rest as Pod)`
  - binding 非 null 的分支：回傳 `this.modifyPod(...).persisted`
  - pod 不存在時回傳 `Promise.resolve()`

### 第 6 步：修改 create 和 update 回傳 persist Promise

- [ ] 修改 `create` 方法
  - 回傳型別從 `Pod` 改為 `{ pod: Pod; persisted: Promise<void> }`
  - 回傳 `{ pod, persisted: this.persistPodAsync(canvasId, pod) }`

- [ ] 修改 `update` 方法
  - 回傳型別從 `Pod | undefined` 改為 `{ pod: Pod; persisted: Promise<void> } | undefined`
  - pod 不存在時仍回傳 `undefined`
  - 回傳 `{ pod: updatedPod, persisted: this.persistPodAsync(canvasId, updatedPod) }`

### 第 7 步：更新 create 的呼叫端

- [ ] 修改 `backend/src/services/podService.ts` 的 `createPodWithWorkspace`
  - `podStore.create(...)` 改為解構 `const { pod } = podStore.create(...)`
  - `persisted` 不需要 await（create 後不會立即 loadFromDisk）

- [ ] 修改 `backend/src/handlers/paste/pasteHelpers.ts` 第 77 行
  - `podStore.create(...)` 改為解構 `const { pod } = podStore.create(...)`

### 第 8 步：更新 update 的呼叫端

- [ ] 修改 `backend/src/handlers/podHandlers.ts` 的 `handlePodUpdate` 函式（第 105 行）
  - `podStore.update(...)` 回傳值改為解構 `const result = podStore.update(...)`
  - `result` 為 `undefined` 時走原本的錯誤路徑
  - 否則取 `result.pod` 作為 `updatedPod` 使用

- [ ] 修改 `handlePodSetSchedule` 中的 `podStore.update` 呼叫（第 207 行）
  - 同上解構處理

- [ ] 修改 `backend/src/handlers/connectionHandlers.ts` 第 102 行
  - `podStore.update(...)` 回傳值改為解構取 `.pod`
  - `const result = podStore.update(canvasId, targetPodId, { schedule: null })`
  - `if (result)` 改為使用 `result.pod`

### 第 9 步：更新 createBindHandlers 的型別

- [ ] 修改 `backend/src/handlers/factories/createBindHandlers.ts`
  - `BindResourceConfig.podStoreMethod.bind` 型別從 `(...) => void` 改為 `(...) => void | Promise<void>`
  - `BindResourceConfig.podStoreMethod.unbind` 型別從 `(...) => void` 改為 `(...) => void | Promise<void>`
  - 這樣既接受新的回傳 `Promise<void>` 的 setter，也不需要修改呼叫邏輯（bind/unbind 結果目前不需要 await）

### 第 10 步：更新其他受影響的測試與呼叫端

- [ ] 確認 `backend/tests/integration/store-coverage.test.ts` 第 178 行
  - 此處 `podStore.create(...)` 預期會 throw，throw 發生在 return 之前，不需要修改

### 第 11 步：修正失敗的測試

- [ ] 修改 `backend/tests/integration/command.test.ts` 第 141 行「綁定 Command 後重新載入仍保留」
  - 在 `emitAndWaitResponse` 之後、`loadFromDisk` 之前，加入 `await podStore.flushWrites(pod.id)`
  - 這確保磁碟寫入完成後才載入

### 第 12 步：撰寫 WriteQueue 單元測試

- [ ] 在 `backend/tests/unit/writeQueue.test.ts` 新增或補充測試
  - 測試 enqueue 回傳 Promise 且在 writeFn 完成後 resolve
    - 建立 WriteQueue 實例
    - enqueue 一個延遲 resolve 的 writeFn
    - await enqueue 回傳的 Promise
    - 驗證 writeFn 已被呼叫
  - 測試 enqueue 回傳的 Promise 在 writeFn 失敗後仍 resolve（不 reject）
    - enqueue 一個會 throw 的 writeFn
    - await enqueue 回傳的 Promise，不應該 throw
  - 測試連續 enqueue 同一個 key 的排隊行為
    - 依序 enqueue 兩個 writeFn
    - 驗證第二個在第一個完成後才執行

---

## 風險與注意事項

1. **向後相容性**：setter 回傳型別從 `void` 改為 `Promise<void>`，所有現有呼叫端如果不 await 也不會出錯（Promise 被靜默忽略），但 ESLint 的 `@typescript-eslint/no-floating-promises` 規則可能會報警。如果有此規則，需要在不需要 await 的地方加 `void` 前綴（如 `void podStore.setClaudeSessionId(...)`）。

2. **create/update 回傳型別變更是破壞性改動**：所有呼叫 `podStore.create()` 和 `podStore.update()` 的地方都必須更新解構方式，否則編譯會失敗。TypeScript 編譯器會幫忙找到所有需要修改的地方。

3. **modifyPod 不再直接回傳 Pod**：改為回傳 `{ pod, persisted }` 結構，所有 setter 需要對應調整取值方式。

4. **不需要在所有 handler 都 await persist**：大部分 handler 在記憶體更新後發 WS 回應就夠了，只有需要「寫入後立即讀取磁碟」的場景（如測試）才需要 await 或 flushWrites。

5. **`setStatus` 不需要改動**：此方法不走 `modifyPod` 也不持久化，維持原樣。

6. **`delete` 方法不需要改動**：delete 後立即呼叫 `writeQueue.delete(id)` 清除佇列，不需要等待寫入。

---

## 修改順序總結

1. `writeQueue.ts`（底層，無依賴）
2. `podStore.ts`（persistPodAsync -> modifyPod -> 所有 setter -> create/update）
3. `createBindHandlers.ts`（型別調整）
4. `podService.ts`（create 呼叫端）
5. `pasteHelpers.ts`（create 呼叫端）
6. `podHandlers.ts`（update 呼叫端）
7. `connectionHandlers.ts`（update 呼叫端）
8. `command.test.ts`（修正 flaky test）
9. `writeQueue.test.ts`（新增測試）
