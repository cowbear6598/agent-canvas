# 前端測試清理計畫書

> 範圍：`frontend/tests/**`
> 依據：`tests/` 全面 review 報告（132 檔 / 約 2,773 cases / 72 檔含 vi.mock / 362 處 vi.mock）
> 工具：Vitest + Vue Test Utils + Pinia testing
> 指令：`bun run test`（**不是** `bun test`）、`bun run style`（eslint + type）

---

## 1. 目標與原則

### 1.1 核心原則

**只 mock 第三方、不可控的依賴。** 自家程式碼應該用真實實作 + 注入狀態的方式測試。

具體判斷標準：

| 該 mock | 不該 mock |
|---|---|
| WebSocket server / `WebSocketClient` 底層送收 | 自家 store（`podStore`、`connectionStore`、`chatStore` …） |
| 瀏覽器原生 API（`navigator.clipboard`、`File`、`URL.createObjectURL` …） | 自家 service（`configApi`、`backupApi`、`createWebSocketRequest`） |
| 外部 SDK / 第三方套件 | 自家 composable（`useCanvasWebSocketAction`、`useToast`、`usePodCapabilities` …） |
| 與 jsdom 衝突的 Shadcn UI Teleport / Portal | 自家子元件（`PodSingleBindSlot`、`PodMcpSlot` …） |

最常被誤 mock 的對象：`useCanvasWebSocketAction`。它本身已有完整 unit test，真要切斷對外通訊請改 mock 更底層的 `WebSocketClient` 或 `createWebSocketRequest`。

### 1.2 預期成效

| 指標 | 現況 | 目標 |
|---|---|---|
| 測試檔數 | 132 | ≈ 118（合併 + 刪除淨減 14 檔） |
| `vi.mock` 呼叫總計 | 362 | < 200 |
| 含 `vi.mock` 的測試檔比例 | 54% | < 35% |
| 高 mock 大檔（> 500 行） | 9 檔 | ≤ 3 檔 |
| `bun run test` 全綠 | ✅ | ✅（每個 Phase 結束維持全綠） |
| `bun run style` 全綠 | ✅ | ✅ |
| 行為覆蓋率 | 持平 | 持平或提升 |

---

## 2. 執行波次

四個 Phase 依風險與依賴排序，**Phase 之間嚴格依序執行**，每個 Phase 完成後必須跑 `bun run test` + `bun run style` 雙綠才能進下一個。

---

### Phase 1（可並行）— 高 ROI 零風險刪除

把純 i18n 字面對照、薄包裝 API 測試、與其他 case 重複的整檔直接刪除或縮到 smoke 等級。預估減少 893 行、5 檔。

A. 刪除無價值的整檔測試
  - [ ] 刪除 `frontend/tests/services/configApi.test.ts`（83 行）
    - 理由：`configApi` 只是 `createWebSocketRequest` 的薄包裝，`createWebSocketRequest.test.ts` 已覆蓋
  - [ ] 刪除 `frontend/tests/components/canvas/PullLatestConfirmModal.test.ts`（113 行）
    - 理由：純 i18n 字面對照
    - 替代：保留現有的 e2e / integration 路徑覆蓋
  - [ ] 刪除 `frontend/tests/components/integration/ChatIntegrationBlockedHint.test.ts`（64 行）
    - 理由：3 個 it 都是 i18n key 字面對照，無行為驗證

B. 縮到 smoke level 的整檔
  - [ ] 重寫 `frontend/tests/components/canvas/ConfirmDeleteModal.test.ts`（154 → < 50 行）
    - 保留：`open=true` 時 render 標題；點確認觸發 `confirm` emit；點取消觸發 `cancel` emit；ESC 關閉
    - 刪除：所有 i18n 字面對照、props 透傳純驗證
  - [ ] （可選）若 A1 重寫後仍有殘留無價值 case，在 Phase 1 一併移除

**驗證**
- `bun run test` 全綠
- `bun run style` 全綠
- **強制動作**：Phase 1 完成後執行 `bun run test --coverage`，把覆蓋率報告產出物（或關鍵數字）存到 `tasks/coverage-baseline-frontend.md` 作為基線
- 後續 Phase 不再要求拍覆蓋率，但若全綠驗證時 `bun run test` 出現新錯誤要求 explain why（不一定是覆蓋率問題，但要查清）

**風險與回滾**
- 風險：低。被刪除的檔案均為字面對照或薄包裝。
- 回滾：`git revert` 該 commit；Phase 1 一個 commit 內完成以利回滾

---

### Phase 2（可並行）— 系統性 *WithBackend 重寫

擴散最廣的反模式：mock 自家 `useCanvasWebSocketAction`。**改 mock 邊界至 `createWebSocketRequest` 或更底層的 `WebSocketClient`**。

> 事實核對結果，`integrationStore` 無 *WithBackend 區塊（已查證 `tests/stores/integrationStore.test.ts` 為 711 行 / 36 個 it()，無對 `useCanvasWebSocketAction` 的 `vi.mock`，無 *WithBackend describe/it 區塊），本波只涵蓋 `podStore` 與 `connectionStore`。

A. `podStore` *WithBackend 系列重寫
  - [ ] 在 `frontend/tests/stores/podStore.test.ts` 移除第 40-45 行對 `useCanvasWebSocketAction` 的 `vi.mock`
  - [ ] 改用以下二擇一策略：
    - 策略 A（推薦）：把 *WithBackend 的測試（行 553-729 / 839-958 / 1010-1099 / 1460-1517）整段搬到 `tests/composables/useCanvasWebSocketAction.test.ts`
    - 策略 B：保留在 `podStore.test.ts`，改 mock `@/services/createWebSocketRequest` 的 `createWebSocketRequest` 函式
  - [ ] 保留 `podStore.test.ts` 內所有 getters 與純 mutation 測試
  - [ ] 範本參考：`frontend/tests/composables/useCanvasWebSocketAction.test.ts`

B. `connectionStore` *WithBackend 系列重寫
  - [ ] 在 `frontend/tests/stores/connectionStore.test.ts` 移除第 48-54 行對 `useCanvasWebSocketAction` 的 `vi.mock`
  - [ ] 同 A 二擇一策略
  - [ ] 整檔目標：從 2,471 行砍至 ≤ 1,200 行
  - [ ] 範本參考：同 A

**重寫範本（共用）**

| 動作 | 舊 | 新 |
|---|---|---|
| Mock 對象 | `vi.mock('@/composables/useCanvasWebSocketAction')` | `vi.mock('@/services/createWebSocketRequest')` |
| 注入 store 狀態 | 透過 mock action 回傳值 | `setActivePinia(createPinia())` + `store.$patch({...})` |
| 驗證 | 驗 mock 被呼叫 | 驗 store state 變化 + 驗 `createWebSocketRequest` 被呼叫的 payload |

**驗證**
- `bun run test` 全綠
- `bun run style` 全綠
- 確認 `useCanvasWebSocketAction` 在整個 `tests/stores/` 不再被 mock：
  - 檢查指令：`grep -rn "useCanvasWebSocketAction" frontend/tests/stores/` 應只剩在 *WithBackend 搬走後留下的 import（或無）

**風險與回滾**
- 風險：中。重寫範圍大，可能需要調整 store 對 WS 邊界的呼叫方式（理論上不需要，因為策略只動測試）
- 回滾：每個大項目（A、B）寫成獨立 PR-internal commit，最後 squash 為單一 Phase commit

---

### Phase 3（可並行）— 大檔合併與真 store 改寫

處理 review 報告中行數最大的高 mock 元件測試。

A. `CanvasPod` 4 檔合併
  - [ ] 將以下四檔合併為單一檔 `frontend/tests/components/pod/CanvasPod.test.ts`（< 500 行）：
    - `frontend/tests/components/pod/CanvasPod.test.ts`（747 行）
    - `frontend/tests/components/pod/CanvasPod.fileDrop.test.ts`（724 行）
    - `frontend/tests/components/pod/CanvasPod.uploadInteraction.test.ts`（647 行）
    - `frontend/tests/components/pod/CanvasPod.mcp.test.ts`（510 行）
  - [ ] 移除對 8 個自家子元件、9 個自家 composable、3 個自家 store 的 mock
  - [ ] 把細節下放至 composable test：**已存在於 `tests/composables/pod/`，本波是補 case 而非新建**。`usePodFileDrop` 已 25 個 it / `usePodCapabilities` 已 19 個 it，把 CanvasPod 4 檔被拆出的對應行為以新 it 案例追加進去，並避免與既有 case 重複
    - 檔案拖曳細節 → `frontend/tests/composables/pod/usePodFileDrop.test.ts`（已存在，補 case）
    - Plugin / MCP slot 切換細節 → `frontend/tests/composables/pod/usePodCapabilities.test.ts`（已存在，補 case）
  - [ ] 合併後的 `CanvasPod.test.ts` 只保留：render smoke、頂層 emit、與真 store 串接的關鍵互動
  - [ ] 範本參考：`frontend/tests/integration/canvasPodFlow.test.ts`（黃金範本）

B. `GlobalSettingsModal` 大瘦身
  - [ ] 重寫 `frontend/tests/components/settings/GlobalSettingsModal.test.ts`（1,066 → ≈ 300 行）
  - [ ] 移除以下 mock：`useToast`、`useWebSocketErrorHandler`、整個 `configStore`、`backupApi`
  - [ ] 保留 mock：`configApi` 內的兩個對外函式
  - [ ] 改用真 `configStore` + `setActivePinia` + `$patch` 注入狀態
  - [ ] 範本參考：`frontend/tests/integration/canvasPodFlow.test.ts`、`frontend/tests/composables/useToast.test.ts`

C. `ConnectionContextMenu` 改用真 store
  - [ ] 重寫 `frontend/tests/components/canvas/ConnectionContextMenu.test.ts`（904 → 300-400 行）
  - [ ] 移除 mock：3 個自家 store（`connectionStore`、`podStore`、`note`/`run`）+ `useToast`
  - [ ] 改用真 store + 注入狀態
  - [ ] 移除與 `connectionStore.test.ts` 重複的 Trigger Mode / Summary Model 變更測試（C4 重複問題），保留「context menu 觸發 store action」這一層
  - [ ] 範本參考：`frontend/tests/composables/eventHandlers/podEventHandlers.test.ts`

D. `RepositoryContextMenu` 整檔重寫 + 新建 `repositoryStore.test.ts`
  - [ ] 重寫 `frontend/tests/components/canvas/RepositoryContextMenu.test.ts`（478 行）
  - [ ] 移除第 14-24 行對整個 `repositoryStore` 的 mock
  - [ ] 改用真 `repositoryStore` + `setActivePinia`，只 mock WS 邊界（`createWebSocketRequest`）
  - [ ] 元件層只留 render + 觸發 store action 的 smoke，行為驗證下放至新 store 測試
  - [ ] **新建** `frontend/tests/stores/repositoryStore.test.ts`
    - 範本參考：`frontend/tests/stores/podStore.test.ts` 中 getter / 純 mutation 部分（保留的部分，非 *WithBackend）+ `frontend/tests/stores/integrationStore.test.ts`（已是不 mock `useCanvasWebSocketAction` 的好範本）
    - 內容覆蓋：repositoryStore 的 getters（如有）、純 mutations、action 對 `createWebSocketRequest` 邊界的呼叫
    - mock 邊界：只 mock `@/services/createWebSocketRequest`
  - [ ] 範本參考：同 C

**驗證**
- `bun run test` 全綠
- `bun run style` 全綠
- 合併後行數比對：四個 CanvasPod 檔合計 2,628 行，目標單檔 < 500 行 + composable test 補回的部分 < 600 行，總計 < 1,100 行
- 元件層 mock 數比對：`grep -c "vi.mock" frontend/tests/components/pod/CanvasPod.test.ts` 應 < 5

**風險與回滾**
- 風險：中高。CanvasPod 合併動到 4 檔，若 composable test 沒接好可能漏掉行為覆蓋
- 緩解：每個大項目（A、B、C、D）寫成獨立 PR-internal commit，最後 squash 為單一 Phase commit；A 完成後先確認新 composable test 的 case 數 ≥ 被刪掉的 case 數
- 回滾：以 squash 後的單一 Phase commit revert

---

### Phase 4 — Mock 過頭重寫 + 共用 composable 抽取

處理剩餘的 B 區（mock 過頭）與 C 區（重複模式）。

A. `PodSlots` 重寫
  - [ ] 重寫 `frontend/tests/components/pod/PodSlots.test.ts`（293 行）
  - [ ] 移除 mock：`PodSingleBindSlot`、`PodMcpSlot`、`@/stores/note`、`usePodCapabilities`
  - [ ] 改用真 stores + 真子元件
  - [ ] 刪除「emit 純透傳」這類無行為價值的 case

B. `IntegrationAppsModal` 移除 UI mock
  - [ ] 重寫 `frontend/tests/components/integration/IntegrationAppsModal.test.ts`（381 行）
  - [ ] 依照下列 SOP 處理 8 個 Shadcn UI / 圖示 mock：
    1. 先一次性移除全部 8 個 Shadcn UI / 圖示 mock，跑 `bun run test`
    2. 對每個失敗的 Shadcn UI 元件 mock 個別補回，並在 `vi.mock` 上方註解寫明衝突原因（zh-TW，例：`// 與 jsdom Teleport 衝突，保留 stub`）
    3. 不論最終留下幾個 mock，都要在 PR 描述列出留下的元件清單與原因

C. `ChatModal` 改用真 store
  - [ ] 重寫 `frontend/tests/components/chat/ChatModal.test.ts`（436 行）
  - [ ] 移除 mock：`chatStore`、`connectionStore`
  - [ ] 改用真 store + 注入狀態
  - [ ] 範本參考：`frontend/tests/integration/chatFlow.test.ts`

D. `PluginPopover` / `McpPopover` 修正 mock 邊界
  - [ ] 重寫 `frontend/tests/components/pod/PluginPopover.test.ts`、`frontend/tests/components/pod/McpPopover.test.ts`
  - [ ] 移除對 `usePodStore` 的 mock
  - [ ] **保留** mock：`listPlugins` 與 `updatePodPluginsApi`（這兩個是 service 邊界，符合「只 mock 第三方/邊界」原則）
  - [ ] 確認搜尋功能單元測試仍綠（已於近期 commit `cc4604ce` 補上）

E. 抽 `useEscapeClose` composable 並補測
  - [ ] 評估在 `frontend/src/composables/` 新增 `useEscapeClose.ts`
    - API 設計：
      - 輸入：`onClose: () => void`、可選 `enabled: Ref<boolean>`（預設 true）
      - 行為：mounted 時掛 `keydown` listener 監聽 `Escape`，unmounted 時解除；`enabled=false` 時不觸發
      - 回傳：無（純 side-effect composable）
  - [ ] 新增 `frontend/tests/composables/useEscapeClose.test.ts`
    - 案例：按 ESC 觸發 callback、enabled=false 時不觸發、unmount 後不觸發
  - [ ] 將以下檔案中的 ESC 處理邏輯改用 `useEscapeClose`：
    - `ChatModal`
    - `RunChatModal`
    - `HistoryPanel`
    - `PluginPopover`
    - `McpPopover`
  - [ ] 從上述 5 個元件的測試中移除個別 ESC 案例，改在 `useEscapeClose.test.ts` 集中驗證

F. 清理重複 getter 測試
  - [ ] 在 `podStore.test.ts`、`connectionStore.test.ts`、`note.test.ts`、`run.test.ts` 中：
    - 找出「getter 找不到時回傳 null」的重複 case（C2）
    - 用 `it.each` 合併為單一參數化測試（每檔一個）

**驗證**
- `bun run test` 全綠
- `bun run style` 全綠
- 重複 case 比對：上述 5 個元件不再各自有 ESC 測試
- composable 抽取後 5 個來源檔的 ESC 行為仍維持原樣（手動 smoke：開該 modal/popover → 按 ESC → 關閉）

**風險與回滾**
- 風險：E 需要動到產品程式碼（5 個元件）。屬於最高風險項。
- 緩解：E 拆成兩個 PR-internal commit：（1）新增 composable + 測試，（2）逐元件遷移；最後與其他大項目一起 squash 為單一 Phase commit。若 Phase 完成後發現問題，以該 Phase commit revert。
- 回滾：各大項目寫成獨立 PR-internal commit，最後 squash 為單一 Phase commit

---

## 3. 重寫指南

給後續實作的人共用的標準寫法。

### 3.1 「Mock 自家 useCanvasWebSocketAction」的標準替換模式

**反模式**

```ts
// ❌ 不要這樣
vi.mock('@/composables/useCanvasWebSocketAction', () => ({
  useCanvasWebSocketAction: () => ({ createPodWithBackend: vi.fn(), ... })
}))
```

**標準替換**

切到更底層的邊界 `createWebSocketRequest`：

```ts
// ✅ 改 mock service 邊界
vi.mock('@/services/createWebSocketRequest', () => ({
  createWebSocketRequest: vi.fn().mockResolvedValue({ ok: true, data: ... })
}))
```

或者直接用真的 composable + mock `WebSocketClient` 的 `send`：

```ts
vi.mock('@/services/WebSocketClient', () => ({
  webSocketClient: { send: vi.fn(), on: vi.fn(), off: vi.fn() }
}))
```

選擇原則：能 mock 越底層越好（更接近真實 IO 邊界），但仍要 mock 在「自家程式碼最外緣」之前。

### 3.2 Pinia 真 store 注入狀態的標準寫法

```ts
import { setActivePinia, createPinia } from 'pinia'
import { usePodStore } from '@/stores/pod'

beforeEach(() => {
  setActivePinia(createPinia())
})

it('案例描述', () => {
  const store = usePodStore()
  store.$patch({ pods: [{ id: 'p1', ... }] })

  // 直接呼叫元件 / action / getter，驗 store 狀態變化
  expect(store.someGetter).toBe(...)
})
```

**禁止**：用 `createTestingPinia({ stubActions: true })` 把 actions 全部 stub —— 這等於把 store 全 mock 掉。

**特例**：若需要避免 action 真的去打 WebSocket，請在 service 層 mock（見 3.1），不要 stub action。

### 3.3 `useEscapeClose` composable API 設計

```
// frontend/src/composables/useEscapeClose.ts
useEscapeClose(onClose: () => void, enabled?: Ref<boolean>): void
```

**契約**

| 條件 | 行為 |
|---|---|
| Component mounted | 在 `window` 掛 `keydown` listener |
| 按下 Escape 且 enabled !== false | 呼叫 `onClose()` |
| 按下 Escape 且 enabled === false | 不呼叫 |
| 其他鍵 | 不呼叫 |
| Component unmounted | 解除 listener |

**測試案例（在 `useEscapeClose.test.ts`）**

- 預設啟用：按 ESC 呼叫 callback 一次
- `enabled=ref(false)`：按 ESC 不呼叫
- `enabled` 動態切換：false → true 後按 ESC 會呼叫
- 按其他鍵（Enter、Space）不呼叫
- unmount 後按 ESC 不呼叫
- 多次 ESC 連按：每次都呼叫

---

## 4. 不在範圍內的事項

明確排除以下，避免 scope creep：

- **不動 D 區的好測試範本**：以下檔案 / 目錄維持原樣：
  - `frontend/tests/utils/**`
  - `frontend/tests/lib/**`
  - `frontend/tests/composables/copyPaste/calculatePaste.test.ts`
  - `frontend/tests/composables/copyPaste/collectCopyData.test.ts`
  - `frontend/tests/composables/useConnectionPath.test.ts`
  - `frontend/tests/composables/useMenuPosition.test.ts`
  - `frontend/tests/composables/useDragHandler.test.ts`
  - `frontend/tests/composables/useModalForm.test.ts`
  - `frontend/tests/composables/useAnchorDetection.test.ts`
  - `frontend/tests/composables/useSubmenuDragDrop.test.ts`
  - `frontend/tests/composables/useToast.test.ts`
  - `frontend/tests/composables/useCanvasWebSocketAction.test.ts`
  - `frontend/tests/composables/eventHandlers/podEventHandlers.test.ts`
  - `frontend/tests/services/createWebSocketRequest.test.ts`
  - `frontend/tests/services/WebSocketClient.test.ts`
  - `frontend/tests/integration/chatFlow.test.ts`
  - `frontend/tests/integration/canvasPodFlow.test.ts`
  - `frontend/tests/integration/copyPasteFlow.test.ts`
  - `frontend/tests/integration-providers/**`
  - `frontend/tests/components/run/**`
  - `frontend/tests/stores/chat/messageHelpers.test.ts`
  - `frontend/tests/stores/chat/subMessageHelpers.test.ts`
  - `frontend/tests/stores/run/runStoreHelpers.test.ts`
- **不重新發明測試框架**：沿用 Vitest + Vue Test Utils + Pinia testing。不引入新 lib（如 Testing Library 等同類工具）。
- **不調整測試指令**：仍使用 `bun run test`、`bun run style`，不改 CI、不改 vitest config（除非 Phase 內明確列出）。
- **不改動產品程式碼**：除 Phase 4-E 抽取 `useEscapeClose` 之外，全程只動 `frontend/tests/**`。
- **不調整覆蓋率門檻**：覆蓋率持平即可，不為了清理拉高門檻造成阻塞。
- **不處理後端測試**：本計畫只涵蓋 `frontend/tests/`。

---

## 5. 待確認事項

執行時若遇到下列情況，先停下來找維護者確認，不自行決策：

1. **Phase 4-E 抽 composable 的相容性**：5 個來源元件中，是否有元件除了 `Escape` 還處理其他鍵盤事件？若有，`useEscapeClose` 不應吞掉其他事件（已在 3.3 契約中規範），實作時請逐一核對來源元件原本的 keydown handler 行為。

---

## 6. 執行 Checklist 總表

| Phase | 內容 | 行數變化（估） | 風險 | Commit 數（建議） |
|---|---|---|---|---|
| 1 | 刪除 5 檔無價值測試 | -893 | 低 | 1 |
| 2 | 重寫 *WithBackend × 2 store | -1,500 ~ -2,000 | 中 | 1 |
| 3 | 大檔合併與真 store 改寫 | -2,000 ~ -2,500 | 中高 | 1 |
| 4 | mock 過頭重寫 + 抽 composable | -500 ~ -800 | 中（E 動產品碼） | 1 |

> **使用者決策：每一波一個 commit**。Phase 內任務若太多可拆 squash 提交，但對外只見 4 個 commit（Phase 1-4 各一）。

每個 Phase 結束都要：
- [ ] `bun run test` 全綠
- [ ] `bun run style` 全綠
- [ ] 提交 commit（zh-TW 訊息）
- [ ] 通知維護者後端是否需要重啟（本計畫不涉及後端，原則上不需要）
