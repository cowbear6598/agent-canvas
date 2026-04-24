# 前端實作計畫書 — Pod Model Selector 動態模型清單

> 目的：把 `PodModelSelector.vue` 內的硬編碼 `CLAUDE_OPTIONS` / `CODEX_OPTIONS` 常數移除，改為從 `providerCapabilityStore` 動態取得 `availableModels`（後端透過 `provider:list` WebSocket 事件推送）。資料未載入時沿用既有 `isSingleOption` 機制只顯示 currentModel，不新增 skeleton/loading UI。前端驗證（白名單）也一併改用 store 動態資料，不保留向後相容。

---

## 測試案例列表（先列名稱，Phase 實作時才寫內容）

### `frontend/tests/stores/providerCapabilityStore.test.ts`
1. `syncFromPayload` 收到含 `availableModels` 的 payload 後，`getAvailableModels(provider)` 回傳與 payload 一致的清單
2. 查詢未知 provider 時，`getAvailableModels` 回傳空陣列
3. `loadFromBackend` 成功後 state 內含正確的 `availableModels`

### `frontend/tests/components/pod/PodModelSelector.test.ts`
4. Store 的 `getAvailableModels` 回傳空陣列時（Loading 情境），元件只顯示 currentModel 一張卡片（取消原先被 skip 的 `isSingleOption` 測試）
5. Provider 為 `claude` 時，顯示 store 回傳的 claude 模型清單
6. Provider 為 `codex` 時，顯示 store 回傳的 codex 模型清單
7. （改寫既有測試）「Codex 三個選項可切換」改為從 mock store 注入資料後驗證切換行為
8. 點擊清單中選項會 emit `update:model` 帶正確 value
9. 白名單驗證：當欲切換的 model 不在 store 回傳的 availableModels 中時，`selectModel` 不會 emit
10. Hover / animation / guard（動畫期間二次點擊）等既有行為在注入 mock store 後仍正常

---

## Phase 1（可並行）

A. 型別定義擴充
  - [ ] 打開 `frontend/src/types/pod.ts`，新增（或從 `PodModelSelector.vue` 搬遷）共用型別 `ModelOption`，欄位為 `label: string` 與 `value: string`，並使用 `ReadonlyArray<ModelOption>` 作為清單型別
  - [ ] 在同一檔案（或 WebSocket 型別定義所在檔）找到 `ProviderListItem`（或 `provider:list` 事件 payload 的 Item 型別），補上 `availableModels: ReadonlyArray<ModelOption>` 欄位
  - [ ] 匯出 `ModelOption`，讓 store 與元件都從 `types/pod.ts` import，避免重複定義
  - [ ] 全域搜尋既有 `{ label: string; value: string }` 內嵌型別的使用點，統一替換為匯入 `ModelOption`（範圍限於 pod 相關檔，不改無關的地方）

B. providerCapabilityStore 擴充
  - [ ] 打開 `frontend/src/stores/providerCapabilityStore.ts`
  - [ ] 在檔頭常數區（`CONSERVATIVE_FALLBACK_CAPABILITIES` 附近）新增 `EMPTY_AVAILABLE_MODELS` 常數，內容為空陣列，型別 `ReadonlyArray<ModelOption>`，作為 `getAvailableModels` 找不到時的回傳值
  - [ ] 於 state 區段新增 `availableModelsByProvider: Record<PodProvider, ReadonlyArray<ModelOption>>`，初始值為空物件（或以 `{}` 為初始值並由 getter 做保底）
  - [ ] 於 getters 新增 `getAvailableModels(provider: PodProvider): ReadonlyArray<ModelOption>`；找不到對應 provider 時回傳 `EMPTY_AVAILABLE_MODELS`，並在註解以 zh-TW 說明「後端資料尚未載入或 provider 未聲告時回傳空陣列」
  - [ ] 修改 action `syncFromPayload(providers)`：遍歷 providers 時除了原本的 capabilities，也把每個 provider 的 `availableModels` 寫入 `availableModelsByProvider[provider.name]`
  - [ ] 確認 `loadFromBackend` 失敗分支不會覆寫 availableModels（維持上一次成功值），並以 zh-TW 註解寫明理由
  - [ ] 確認 reset / disconnect 相關 action（若有）會把 `availableModelsByProvider` 清為空物件，避免重連時殘留舊資料；若無既有 reset action 則不新增，讓 `syncFromPayload` 直接以新 payload 覆蓋即可

## Phase 2

A. PodModelSelector.vue 改為動態取用 store
  - [ ] 打開 `frontend/src/components/pod/PodModelSelector.vue`
  - [ ] 刪除第 58-62 行 `CODEX_OPTIONS` 常數
  - [ ] 刪除第 65-69 行 `CLAUDE_OPTIONS` 常數
  - [ ] 刪除第 71-75 行的 TODO 註解（這次就是要實現它）
  - [ ] 在 `<script setup>` 中 import `useProviderCapabilityStore`，並於元件內以 `storeToRefs` 或直接呼叫方式取得 store
  - [ ] 修改 `allOptions = computed(...)`：移除 `if (props.provider === "codex")` 的硬編碼分支，改為 `providerCapabilityStore.getAvailableModels(props.provider)`，並確保回傳型別仍為 `ReadonlyArray<ModelOption>`
  - [ ] 確認 `sortedOptions`（active 置頂）computed 不需變動（上游 allOptions 已動態化）
  - [ ] 確認 `isSingleOption` computed 不需變動；當 store 尚未載入時 `allOptions.value.length === 0`，需在 computed 內加入 zh-TW 註解並處理「空清單時 fallback 為只顯示 currentModel」
    - 作法：若 `allOptions.value.length === 0`，在 template/computed 層直接視為只有 currentModel 一筆（可另建一個 `effectiveOptions` computed，當空時回傳 `[{ label: currentModel, value: currentModel }]`，由 `sortedOptions` 與 `isSingleOption` 改為以 `effectiveOptions` 為基礎）
  - [ ] 修改 `selectModel` 的白名單驗證 `inAllOptions`：改用動態 `allOptions.value`（或 `effectiveOptions.value`）判斷；行為不變（不在清單內時直接 return 不 emit），保留既有 zh-TW 錯誤註解並更新為「以 providerCapabilityStore 的 availableModels 為白名單」
  - [ ] 從 `<script setup>` 與 `<template>` 檢查所有對 `ModelOption` 的 import 是否改為來自 `types/pod.ts`，移除本檔內重複定義
  - [ ] Props / Emits 維持不變（`provider` / `currentModel` / `update:model`），不改 `CanvasPod.vue` 端的呼叫方式

B. 連動檢查（不改動但需確認）
  - [ ] 開啟 `frontend/src/App.vue` 第 292-304 行，確認 WebSocket 連線就緒時已呼叫 `providerCapabilityStore.loadFromBackend()`（重連情境由既有流程處理），不需修改
  - [ ] 確認 `frontend/src/lib/providerOptions.ts`、`frontend/src/composables/pod/usePodCapabilities.ts`、`CanvasPod.vue` 不需改動
  - [ ] 全域搜尋 `CLAUDE_OPTIONS`、`CODEX_OPTIONS`，確認已完全移除（除了舊測試會在下一個 Phase 處理）

## Phase 3

A. providerCapabilityStore 測試
  - [ ] 打開 `frontend/tests/stores/providerCapabilityStore.test.ts`
  - [ ] 既有 capabilities 相關測試保留不動
  - [ ] 新增測試 1：`syncFromPayload` 寫入含 `availableModels` 的 providers 後，`getAvailableModels("claude")` 與 `getAvailableModels("codex")` 分別回傳對應清單（斷言 label/value 完整對上）
  - [ ] 新增測試 2：呼叫 `getAvailableModels` 傳入未知 provider（例如字串 `"unknown"` 或未聲告的 provider）時回傳空陣列
  - [ ] 新增測試 3：模擬 `loadFromBackend` 成功（以 fetch mock 或對應的 WebSocket 模擬機制）後，state 的 `availableModelsByProvider` 內包含預期的 provider 與 availableModels
  - [ ] 測試中使用的 mock payload 需符合新的 `ProviderListItem` 型別（含 `availableModels`）

B. PodModelSelector.vue 測試
  - [ ] 打開 `frontend/tests/components/pod/PodModelSelector.test.ts`
  - [ ] 在既有 `beforeEach` 內建立 Pinia testing instance，並準備一個可設定 `availableModelsByProvider` 的 helper，讓每個 it 能注入 mock 資料
  - [ ] 取消第 237 行附近原本 skip 的 `isSingleOption` 測試，改寫為：「store 回傳空陣列時，元件只顯示 currentModel 一張卡片、`isSingleOption` 為 true、非 active 區塊不展開」（涵蓋 Loading 情境）
  - [ ] 新增測試：`provider="claude"` 且 store 注入 claude 模型清單時，畫面顯示所有 claude 選項，active 在對應位置
  - [ ] 新增測試：`provider="codex"` 且 store 注入 codex 模型清單時，畫面顯示所有 codex 選項
  - [ ] 將既有「Codex 三個選項可切換」測試改寫為：透過 mock store 注入三個 codex 選項，驗證點擊切換仍能 emit 正確 value，不再依賴硬編碼 `CODEX_OPTIONS`
  - [ ] 新增白名單驗證測試：當 `selectModel` 被以不在 store availableModels 的 value 呼叫時，元件不會 emit `update:model`（可透過直接呼叫 component instance method 或模擬 DOM 事件）
  - [ ] 既有 hover / animation / guard（動畫期間二次點擊）測試保留，但在 mount 前先注入 mock store 資料，確保 `allOptions` 不為空導致行為改變

## Phase 4

A. 風格檢查與測試
  - [ ] 於 `frontend` 目錄跑 `bun run style` 確認 ESLint + TypeScript 無錯誤、無新增 warning
  - [ ] 於 `frontend` 目錄跑 `bun run test` 確認本次所有新增 / 改寫的測試全通過，既有測試無回歸
  - [ ] 告知使用者此改動屬於純前端，不需重啟後端；但需等後端完成 `availableModels` 推送後才能在實機觀察到真實資料（本地測試以 mock store 驗證即可）
