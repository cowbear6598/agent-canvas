# 後端實作計畫書 — Provider 抽象層擴充性補齊

## 目的

補齊 Provider 抽象層的三個擴充性缺口：
1. 讓每個 Provider 在 metadata 聲告自己的 `availableModels`，前端透過 `provider:list` 事件動態取得模型清單，不再於前端硬編碼。
2. 將 `podStore` 內的 provider 白名單從字串硬編碼改為動態從 `providerRegistry` 推導，新增 provider 時零改動。
3. 於 `podStore` 建立 / 更新 Pod 時驗證 model 是否在該 provider 的 `availableModels` 清單內；不合法直接 throw error（不 fallback），確保 DB 不被寫入非法值。

---

## 測試案例列表（先列名稱，Phase 實作時才寫內容）

### providerIndex.test.ts（新增 / 擴充）
- [ ] claudeProvider metadata 應包含 availableModels 且為 Claude 模型清單
- [ ] codexProvider metadata 應包含 availableModels 且為 Codex 模型清單
- [ ] 每個 provider 的 availableModels 皆為唯讀（Object.freeze）

### providerHandlers.test.ts（擴充）
- [ ] `provider:list` 回應每個 provider 皆含 availableModels 陣列
- [ ] `provider:list` 回應的 availableModels 內容與 provider metadata 一致

### podStoreIntegration.test.ts（新增）
- [ ] create 時 provider 合法但 model 不在 availableModels 內應 throw error，DB 不寫入
- [ ] update 時 provider 合法但 model 不在 availableModels 內應 throw error，DB 不變動
- [ ] create 時使用 availableModels 內的合法 model 可正常寫入
- [ ] update 時使用 availableModels 內的合法 model 可正常寫入
- [ ] resolveProvider 對已註冊的 provider 字串（claude / codex）正常回傳
- [ ] resolveProvider 對未知 provider 字串 fallback 為 claude 並輸出 warn log（驗證白名單動態化後行為不變）
- [ ] resolveProviderConfig 從 DB 讀到沒有 model 欄位時，補 defaultOptions.model
- [ ] resolveProviderConfig 從 DB 讀到 model 不在 availableModels 內時，保留原值（不 throw，可選擇 warn log）

---

## Phase 1

A. 新增 availableModels 型別與常數

- [ ] 編輯 `backend/src/services/provider/types.ts`
  - 在 `ProviderMetadata` 介面新增 `availableModels` 欄位
  - 型別為 `ReadonlyArray<{ label: string; value: string }>`
  - 欄位放在 `defaultOptions` 之後
  - 補上 zh-TW 註解說明：此欄位用於聲告 Provider 支援的模型清單，供前端選擇器動態渲染
- [ ] 編輯 `backend/src/services/provider/capabilities.ts`
  - 新增常數 `CLAUDE_AVAILABLE_MODELS`，內容為三筆：Opus / opus、Sonnet / sonnet、Haiku / haiku
  - 新增常數 `CODEX_AVAILABLE_MODELS`，內容為三筆：GPT-5.4 / gpt-5.4、GPT-5.5 / gpt-5.5、GPT-5.4-mini / gpt-5.4-mini
  - 兩個常數皆使用 `Object.freeze` 包裹，並標註為 `as const` 以維持與現有 `CLAUDE_CAPABILITIES` / `CODEX_CAPABILITIES` 風格一致
  - 補上 zh-TW 註解說明用途

---

## Phase 2（可並行）

A. Claude Provider 補 availableModels

- [ ] 編輯 `backend/src/services/provider/claudeProvider.ts`
  - 在 `metadata` 物件（約第 41-53 行）新增 `availableModels: CLAUDE_AVAILABLE_MODELS`
  - 從 `./capabilities` 補上對應的 import
  - 確認欄位順序與 types.ts 定義一致（`name` / `capabilities` / `defaultOptions` / `availableModels`）

B. Codex Provider 補 availableModels

- [ ] 編輯 `backend/src/services/provider/codexProvider.ts`
  - 在 `metadata` 物件（約第 351-358 行）新增 `availableModels: CODEX_AVAILABLE_MODELS`
  - 從 `./capabilities` 補上對應的 import
  - 確認欄位順序與 types.ts 定義一致

---

## Phase 3

A. 擴充 provider:list schema 與 handler

- [ ] 編輯 `backend/src/schemas/providerSchemas.ts`
  - 找到 `ProviderListResultPayload`
  - 新增 `availableModels` 欄位，型別為 `{ label: string; value: string }[]`（唯讀陣列）
  - 若有對應的 Zod schema，也要同步補上 `availableModels` 欄位驗證
- [ ] 編輯 `backend/src/handlers/providerHandlers.ts`（約第 23-32 行）
  - 建立 `provider:list` 回應時，每個 provider 的 payload 物件額外塞入 `availableModels: provider.metadata.availableModels`
  - 確保輸出結構與 schema 一致

---

## Phase 4（可並行）

A. podStore resolveProvider 白名單動態化

- [ ] 編輯 `backend/src/services/podStore.ts` `resolveProvider`（約第 300-313 行）
  - 從 `./provider` 引入 `providerRegistry`
  - 移除硬編碼的 `value === "claude" || value === "codex"` 判斷
  - 改為檢查 `value` 是否為 `providerRegistry` 的 key（`Object.prototype.hasOwnProperty.call(providerRegistry, value)` 或 `value in providerRegistry`）
  - 合法則原值回傳，不合法則保留「fallback 為 claude + warn log」的原行為
  - warn log 訊息使用 zh-TW，內容說明「收到未知 provider 值，已 fallback 為 claude」

B. podStore sanitizeProviderConfig 加上 model 白名單驗證

- [ ] 編輯 `backend/src/services/podStore.ts` `sanitizeProviderConfig`（約第 319-327 行）
  - 調整函式簽名，新增 `provider` 參數（型別為現有 provider 字面型別或 `keyof typeof providerRegistry`）
  - 在保留 model 欄位之後，讀取該 provider 的 metadata.availableModels
  - 判斷 model 是否在 availableModels 的 value 清單內
  - 不合法時 throw error，錯誤訊息使用 zh-TW，明確指出：provider 名稱、收到的 model 值、合法選項清單
  - 合法時回傳原 config
- [ ] 同步更新呼叫端
  - `create()`（約第 420 行）呼叫 `sanitizeProviderConfig` 時把該 Pod 的 provider 傳入
  - `update()`（約第 634 行）呼叫 `sanitizeProviderConfig` 時把解析後的 provider 傳入
  - 兩處呼叫端本身已經會把錯誤回傳給 WebSocket 客戶端，不需要額外處理
- [ ] 調整 `resolveProviderConfig`（約第 330-346 行）
  - 維持「DB 讀取時不強制驗證」的行為（避免舊 pod 打不開）
  - 若 DB 內沒有 model 欄位，仍用 `defaultOptions.model` 補上（原行為保留）
  - 可選：若 DB 內 model 不在 availableModels 內，輸出 warn log 標記異常但保留原值（zh-TW 訊息）

---

## Phase 5

A. 撰寫 / 更新測試

- [ ] 編輯 `backend/tests/provider/providerIndex.test.ts`
  - 補上 3 個測試：
    1. claudeProvider metadata 含 availableModels，陣列內容比對 Opus / Sonnet / Haiku 三筆（label + value 完全一致）
    2. codexProvider metadata 含 availableModels，陣列內容比對 GPT-5.4 / GPT-5.5 / GPT-5.4-mini 三筆
    3. 斷言兩個 availableModels 為 frozen（`Object.isFrozen` 為 true）
- [ ] 編輯 `backend/tests/handlers/providerHandlers.test.ts`
  - 在 `provider:list` 測試中補上 availableModels 斷言
  - 驗證每個 provider 的 availableModels 與該 provider metadata 完全一致
- [ ] 編輯 / 新增 `backend/tests/unit/podStoreIntegration.test.ts`
  - 測試 1（create + 非法 model）：呼叫 create 並傳入 `{ provider: "claude", model: "not-a-model" }`，斷言會 throw，且 DB 查不到新紀錄
  - 測試 2（update + 非法 model）：先 create 合法 Pod，再 update 成非法 model，斷言會 throw，且 DB 內容未變動
  - 測試 3（create + 合法 model）：傳入 `{ provider: "codex", model: "gpt-5.5" }`，斷言成功建立並可從 DB 讀出
  - 測試 4（update + 合法 model）：先 create，再 update 成另一個合法 model，斷言 DB 內容已更新
  - 測試 5（resolveProvider + 合法）：分別傳入 "claude" / "codex"，斷言回傳原值且沒有 warn log
  - 測試 6（resolveProvider + 非法）：傳入 "gemini"，斷言回傳 "claude" 且 console.warn 被呼叫至少一次
  - 測試 7（resolveProviderConfig + 缺 model）：模擬 DB row 沒有 model 欄位，斷言補上 defaultOptions.model
  - 測試 8（resolveProviderConfig + DB 內非法 model）：模擬 DB row 有 model 但值不在 availableModels 內，斷言保留原值不 throw

---

## Phase 6

A. 風格檢查與提醒使用者重啟

- [ ] 執行 `bun run test`，確認所有新舊測試通過
- [ ] 執行 `bun run style`，確認 ESLint 與 TypeScript 無錯誤無新增 warning
- [ ] 若有失敗，回到對應 Phase 修正直到全綠
- [ ] 告知使用者：後端程式碼已改動（provider metadata、providerHandlers、podStore、schemas），請手動重啟後端服務
