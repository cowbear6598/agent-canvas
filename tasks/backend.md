# 後端計畫：移除 SubAgent 功能

## 背景

完全移除 SubAgent 功能（連根拔，不保留向後相容）。Vue3 + Bun 專案。

## Phase 1：DB Migration（必須最先）

### A. 新增 drop migration

- [ ] 於 backend migration 目錄新增一支 `dropPodSubAgentIds`
- [ ] 採既有 `runMigration` / `isIgnorableMigrationError` pattern
- [ ] SQL：`DROP TABLE IF EXISTS pod_sub_agent_ids;`
- [ ] 在 migration 啟動清單註冊本支
- [ ] `IF EXISTS` 即可達成 idempotent，不需額外 try-catch

## Phase 2：Schema / Types 清理（可並行）

### A. Events schema

- [ ] 刪除 `/backend/src/schemas/events.ts` 中 19 個 SUBAGENT_* / POD_SUBAGENT_* 常數（行 29-37, 68, 148-157, 192）
- [ ] 確認 events union / enum 不再參照 SubAgent 相關常數

### B. Zod schema

- [ ] 刪除整檔 `/backend/src/schemas/subAgentSchemas.ts`

### C. Type 檔

- [ ] 刪除 `/backend/src/types/subAgent.ts`
- [ ] 刪除 `/backend/src/types/subAgentNote.ts`
- [ ] 刪除 `/backend/src/types/responses/subAgent.ts`
- [ ] `/backend/src/types/pod.ts:24` 移除 `subAgentIds` 欄位

## Phase 3：Service / Store / DB 清理

### A. podStore 清理

- [ ] `/backend/src/services/podStore.ts:236, 251, 460, 540, 680, 828-900` 移除 `subAgentIds` Map / load / save / query 邏輯
- [ ] 確認 `buildUpdatedPod` / `loadRelation` 不再含 subAgent 分支
- [ ] 確認 ensureModelField 等 helper 不受影響

### B. SubAgent service

- [ ] 刪除整檔 `/backend/src/services/subAgentService.ts`

### C. DB statements / schema

- [ ] 移除 `/backend/src/database/statements.ts:307, 316` 的 prepared statements
- [ ] 移除 `/backend/src/database/schema.ts:67-72` 的 `pod_sub_agent_ids` junction table 定義

## Phase 4：Handlers 清理

### A. 刪除 handler 檔

- [ ] 刪除整檔 `/backend/src/handlers/subAgentHandlers.ts`
- [ ] 刪除整檔 `/backend/src/handlers/groups/subAgentHandlerGroup.ts`

### B. 移除 handler 註冊

- [ ] `/backend/src/handlers/index.ts:9` 移除 import
- [ ] `/backend/src/handlers/index.ts:31` 移除註冊

## Phase 5：測試清理與驗證

### A. 測試清理

- [ ] 移除所有 `subAgent*.test.ts`（service / handler / store / schema 測試）
- [ ] 修正 `podStore.test`、`eventsSchema.test`、`podModelMigration.test` 中含 subAgent 的斷言
- [ ] 新增 drop migration 的冪等性測試（執行兩次不噴錯）

### B. 驗證

- [ ] `bun run style` 通過（無 SubAgent 殘留 import / type）
- [ ] `bun run test` 通過

---

## 提醒

本次改動涉及後端，使用者需重啟後端。
