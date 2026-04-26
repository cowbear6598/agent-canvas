# 前端計畫：移除 SubAgent 功能 + Notch 對齊

## 背景

完全移除 SubAgent 前端功能，並調整 Pod 上的 notch UI（左側 Plugin/MCP 與右側 Command/Repository 垂直對齊、高度統一 32px）。

## User Flow

### 情境：使用者開啟既有 Pod

- Given 使用者重啟後端後開啟畫布
- When 看到原本帶有 SubAgent 的 Pod
- Then Pod 上不再顯示 SubAgent notch，左側只剩 Plugin / MCP，與右側 Command / Repository 垂直對齊

### 情境：使用者開啟 Pod 設定面板

- Given 使用者點擊任一 Pod 的設定
- When 設定面板展開
- Then 不再出現 SubAgent 相關欄位、選項、note 區塊

### 情境：使用者懸停 Pod 邊緣

- Given 使用者懸停在 Pod 邊緣
- When 看到左右兩側 notch
- Then 左 (Plugin@44, MCP@84) 與右 (Command@44, Repository@84) 高度皆 32px、視覺對稱

## Phase 1：Store / Type / Composable 清理（可並行）

### A. Store / Type

- [ ] 刪除 `/frontend/src/types/subAgent.ts`
- [ ] 刪除 `/frontend/src/stores/note/subAgentStore.ts`
- [ ] `/frontend/src/stores/note/index.ts` 移除 `useSubAgentStore` export
- [ ] `/frontend/src/stores/providerCapabilityStore.ts` 移除 `subAgent` capability flag（若存在）

### B. Composable / Event handlers

- [ ] `/frontend/src/composables/pod/usePodNoteBinding.ts` 移除 SubAgent 綁定路徑（subagent-dropped emit 等）
- [ ] `/frontend/src/composables/eventHandlers/podEventHandlers.ts` 移除 SUBAGENT_* / POD_SUBAGENT_* 事件處理
- [ ] `/frontend/src/services/websocket/` 內 SubAgent 訊息 handler 一併清除

## Phase 2：元件 + CSS（一次到位避免 import 斷裂）

### A. PodSlots 元件

- [ ] `/frontend/src/components/pod/PodSlots.vue:7-11, 29, 49-130, 190-195` 移除 SubAgent template / props / 邏輯
- [ ] 確認 slotConfigs / createSlotConfig 不再含 subAgent

### B. CanvasPod 元件

- [ ] `/frontend/src/components/pod/CanvasPod.vue:44, 71-72` 移除 boundSubAgentNotes computed 與相關 prop

### C. Notch CSS 對齊

- [ ] 刪除 `/frontend/src/assets/styles/doodle/slots.css:246-296` SubAgent notch 整段
- [ ] 調整 notch 樣式至下表新數值（高度全部 32px）：

| Notch | 邊 | top | height |
|---|---|---|---|
| Plugin | left | 44px | 32px |
| MCP Server | left | 84px | 32px |
| Command | right | 44px | 32px |
| Repository | right | 84px | 32px |

## Phase 3：驗證

### A. 樣式 + 測試

- [ ] `bun run style` 通過
- [ ] `bun run test` 通過
- [ ] 手動：開啟既有資料庫的 Pod，確認 notch 排版對稱、設定面板無 SubAgent 區塊
