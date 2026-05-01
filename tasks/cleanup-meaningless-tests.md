# 刪除無意義測試 — 清理計畫

## 總覽

本任務為**純測試清理**，不動 production code、不補新測試。要刪除一批被判定為「同義反覆 / 無意義」的單元測試。

判準口訣：**「如果改實作會自動讓測試需要更新（而不是實作壞了測試會 fail），就是同義反覆，該砍。」**

具體判準涵蓋以下情況：

- 純資料容器（Map/Set wrapper）的 CRUD 測試 — 在測 V8 / JS Map 本身
- Getter 鏡射 — getter 就是 `return this.field`，測試 = 把實作再寫一次
- 常數驗證 — 測試寫死常數的形狀，該用 type / zod 解決
- 框架自身行為 — Vue reactivity、Pinia state 更新、Promise resolve 路徑、`clearTimeout` 不拋例外
- UI render 同義反覆 — `wrapper.find('button').text() === '送出'` 這類 template 鏡射
- 初始狀態鏡射 — 一連串檢查 store 初始值

## User Flow

N/A — 內部測試清理，無使用者操作路徑。

## 範圍

### 後端刪除清單

| 檔案 | 行號範圍 | 刪除內容 |
|---|---|---|
| `backend/tests/unit/replyContextStore.test.ts` | **全檔刪除** | 純 Map wrapper 的 CRUD 測試（6 個 case 全是同義反覆） |
| `backend/tests/unit/pendingTargetStore.test.ts` | 17-65 | 初始化 + 記錄類測試（同義反覆） |
| `backend/tests/unit/directTriggerStore.test.ts` | 14-60、87-111 | 初始化、setTimer/getTimer/clearTimer（getter/setter + 防呆過頭） |
| `backend/tests/unit/capabilities.test.ts` | 43-52、55-84 | GEMINI 常數形狀驗證（該用 zod / type 解決） |
| `backend/tests/unit/configStore.test.ts` | 16-20、48-64 | 預設值常數驗證 |
| `backend/tests/unit/fireAndForget.test.ts` | 9-15 | Promise resolve 路徑沒呼叫 logger（在測 JS Promise 本身） |

### 前端刪除清單

| 檔案 | 行號範圍 | 刪除內容 |
|---|---|---|
| `frontend/tests/stores/chat/chatStore.test.ts` | 22-113 | 初始狀態 + getter 鏡射測試 |
| `frontend/tests/stores/selectionStore.test.ts` | 16-50 | 初始狀態 + selectedPodIds getter |
| `frontend/tests/lib/utils.test.ts` | **全檔刪除** | capitalizeFirstLetter 同義反覆 |
| `frontend/tests/stores/upload/uploadStore.test.ts` | 40-73 | aggregateProgress 公式鏡射 |

### 明確排除（這次不要動）

- `frontend/tests/lib/sanitize.test.ts`、`frontend/tests/lib/validators.test.ts` — 安全層保留
- `backend/tests/unit/pathValidator.test.ts` — 安全防護保留
- `backend/tests/unit/messageStore.test.ts` 排序測試 — 不要動
- `backend/tests/unit/cursorColorManager.test.ts:38-42` — 那個測試本身寫錯，會另外開單修，**不要**混進這次刪除

---

## 執行步驟

採「先後端再前端」順序，每刪一批跑一次驗證，盡早發現是否誤刪到還在跑的測試。整個任務只開一個 PR、最後可整理成兩個 commit（後端、前端），便於日後 revert 單一面向。

### Phase 1：後端測試清理

#### A. 刪除純 Map wrapper / 同義反覆測試

- [ ] 刪除整個檔案 `backend/tests/unit/replyContextStore.test.ts`
- [ ] 編輯 `backend/tests/unit/pendingTargetStore.test.ts`，刪除第 17-65 行（`describe('基本功能測試', ...)` 整個區塊）
  - 保留 `describe('recordSourceRejection ...')` 以下的 rejection 相關測試（那些有業務語意）
- [ ] 編輯 `backend/tests/unit/directTriggerStore.test.ts`：
  - 刪除第 14-60 行（`describe('基本功能', ...)` 內的初始化 / record / getReadySummaries 測試）
  - 保留第 62-70 行的 `clearDirectPending` 測試（會清掉相關 timer + summaries，屬於行為而非鏡射）
  - 刪除第 87-111 行（`setTimer / getTimer` 與 `clearTimer` 純 setter/getter 測試）
  - 保留第 74-85 行的 `hasActiveTimer` — 它驗證了 timer 存在偵測對外 API 的契約

#### B. 刪除常數形狀驗證測試

- [ ] 編輯 `backend/tests/unit/capabilities.test.ts`：
  - 刪除第 43-52 行（`GEMINI_CAPABILITIES smoke 測試` 整個 describe）
  - 刪除第 55-84 行（`GEMINI_AVAILABLE_MODELS smoke 測試` 整個 describe）
  - 保留 CODEX / CLAUDE 對應段落（不在本次刪除範圍）
  - 保留第 86 行以後的 `GEMINI_AVAILABLE_MODEL_VALUES smoke 測試`（不在本次刪除範圍）
- [ ] 編輯 `backend/tests/unit/configStore.test.ts`：
  - 刪除第 16-20 行（`DB 無資料時 timezoneOffset 回傳預設值 8`）
  - 刪除第 48-64 行（三個「DB 無資料時 ... 回傳預設」測試）
  - 其餘 update / getBackupConfig 等行為測試保留

#### C. 刪除框架自身行為測試

- [ ] 編輯 `backend/tests/unit/fireAndForget.test.ts`：
  - 刪除第 9-15 行（`Promise resolve 時不應呼叫 logger.error`）
  - 保留第 17-24 行的 reject 測試（驗證錯誤路徑會打 logger，是真實業務邏輯）

#### D. 後端驗證

- [ ] 在 repo 根執行 `cd backend && bun run test`，確認所有後端測試通過
- [ ] 在 repo 根執行 `cd backend && bun run style`，確認 eslint + type 通過
- [ ] 若有殘留未使用的 import / 變數導致 lint 失敗，順手清掉

### Phase 2：前端測試清理

#### A. 刪除 store 初始狀態 / getter 鏡射測試

- [ ] 編輯 `frontend/tests/stores/chat/chatStore.test.ts`：
  - 刪除第 22-113 行（`describe('初始狀態', ...)` 與 `describe('getters', ...)` 內的 getMessages / isTyping / isConnected / getHistoryLoadingStatus 等鏡射測試）
  - 保留第 130 行以後的 `isHistoryLoading` 與其他真正測 actions 行為的區塊
- [ ] 編輯 `frontend/tests/stores/selectionStore.test.ts`：
  - 刪除第 16-50 行（`describe('初始狀態', ...)` 與 `selectedPodIds` 純 filter getter 測試）
  - 保留 `selectedRepositoryNoteIds` 之後與選取邏輯相關的測試

#### B. 刪除 utils 同義反覆 + 公式鏡射

- [ ] 刪除整個檔案 `frontend/tests/lib/utils.test.ts`
- [ ] 編輯 `frontend/tests/stores/upload/uploadStore.test.ts`：
  - 刪除第 40-73 行（`describe('aggregateProgress 加權平均計算', ...)` 整個區塊，含「多檔不同 size 的加權平均」與「sum(size)=0 時為 100」兩個 case）
  - 保留下方 `markFileFailed 後其他檔仍可被 markFileSuccess` 等真正驗證狀態機行為的區塊

#### C. 前端驗證

- [ ] 在 repo 根執行 `cd frontend && bun run test`，確認所有前端測試通過
- [ ] 在 repo 根執行 `cd frontend && bun run style`，確認 eslint + type 通過
- [ ] 若有殘留未使用的 import / helper 導致 lint 失敗，順手清掉（例如 `selectionStore.test.ts` 開頭的 `POD_WIDTH / POD_HEIGHT / NOTE_WIDTH / NOTE_HEIGHT` 常數若沒有其他測試使用，要一併移除）

### Phase 3：整體驗證 + commit

#### A. 全域驗證

- [ ] 後端再跑一次 `cd backend && bun run test` + `bun run style`
- [ ] 前端再跑一次 `cd frontend && bun run test` + `bun run style`
- [ ] `git diff --stat` 檢查只動到 `tests/` 底下檔案，沒有誤動 production code

#### B. Commit

- [ ] 依照現有 git log 風格撰寫 commit message（中文、`[Refactor]` 前綴、條列式）
- [ ] 建議切兩個 commit（後端一個、前端一個）方便日後單側回滾，commit message 範本見下節

---

## 驗證方式

| 階段 | 指令（在對應子專案目錄下） | 通過標準 |
|---|---|---|
| 後端測試 | `bun run test` | 全綠，沒有測試 fail |
| 後端 lint + type | `bun run style` | eslint + tsc 全通過 |
| 前端測試 | `bun run test` | 全綠，沒有測試 fail |
| 前端 lint + type | `bun run style` | eslint + tsc 全通過 |

**重點**：

- **必須使用 `bun run test`，不是 `bun test`** — 這是專案 CLAUDE.md 明定，本專案的 `bun test` 行為與預期不同
- **不要執行 `bun run dev`** — 使用者已常駐開啟，不需要由 agent 啟動
- 若任一階段失敗，停下來定位是「誤刪了還在被引用的測試 helper / import」還是「誤觸到 production code」，修正後再繼續

---

## 回滾策略

本任務只動 `tests/` 底下檔案，零 production code 風險，回滾極簡單：

1. **PR 還沒合併**：`git reset --hard <commit-before-cleanup>` 即可
2. **PR 已合併但發現問題**：
   - 整體回滾：`git revert <merge-commit>`
   - 單側回滾（只還原前端或後端）：因為已切成兩個 commit，可單獨 `git revert <frontend-commit>` 或 `git revert <backend-commit>`
3. **發現某個測試被誤刪、其實還有價值**：直接從 git history 把該段測試複製回來新增 commit，不需要整批 revert

由於完全沒動 production code，**回滾後不需要重啟後端**。

---

## PR 結構

- **單一 PR 全做完**，不要切多個 PR
- **建議切兩個 commit**：
  1. `[Refactor] 刪除後端無意義測試` — Phase 1 的內容
  2. `[Refactor] 刪除前端無意義測試` — Phase 2 的內容
- 切兩個 commit 的好處：日後若只想回滾單側很容易；單一 PR 的好處：reviewer 一次看完整批清理脈絡

### Commit message 範本（跟著現有 git log 中文 + `[xxx]` 前綴 + 條列式風格）

**後端 commit：**

```
[Refactor] 刪除後端無意義測試
1. 移除 replyContextStore.test.ts 整檔（純 Map wrapper CRUD，等同於測 V8 Map）
2. 移除 pendingTargetStore.test.ts 初始化與基本記錄區塊（行 17-65），保留有業務語意的 rejection 區塊
3. 移除 directTriggerStore.test.ts 初始化 / setter / getter 區塊（行 14-60、87-111），保留 hasActiveTimer 與 clearDirectPending 行為測試
4. 移除 capabilities.test.ts 中 GEMINI 常數形狀驗證（行 43-52、55-84），常數契約應由 type / zod 保證
5. 移除 configStore.test.ts 預設值常數驗證（行 16-20、48-64），保留 update 行為測試
6. 移除 fireAndForget.test.ts Promise resolve 路徑測試（行 9-15），該段在測 JS Promise 本身
```

**前端 commit：**

```
[Refactor] 刪除前端無意義測試
1. 移除 chatStore.test.ts 初始狀態與 getter 鏡射區塊（行 22-113），保留 actions 行為測試
2. 移除 selectionStore.test.ts 初始狀態與 selectedPodIds 純 filter getter 測試（行 16-50）
3. 移除 utils.test.ts 整檔（capitalizeFirstLetter 為單行同義反覆）
4. 移除 uploadStore.test.ts aggregateProgress 公式鏡射測試（行 40-73），保留狀態機行為測試
```

---

## 風險與注意事項

### 重啟提醒

- 本任務**完全沒動 production code**，理論上**不需要重啟後端**
- 但仍依專案規範告知使用者：「本次只動 `tests/`，後端不需要重啟」
- 如果實作時意外動到 `backend/src/` 任何檔案（不應該發生），則必須提醒使用者重啟

### 不要做的事

- **不要執行 `bun run dev`** — 使用者常駐開啟（CLAUDE.md 明定）
- **不要執行 `bun test`** — 必須用 `bun run test`（CLAUDE.md 明定）
- **不要補新測試** — 本任務是純清理，不加任何測試
- **不要動 production code** — 一行都不要動
- **不要做 user flow / A、B、C validation 規劃** — 本任務不涉及

### 語言規範

- 任何新增的註解、commit message、PR 說明都用 **zh-TW**（CLAUDE.md 規範）
- 本任務基本上不會新增註解（純刪除），但若刪除過程中要調整 describe 標題或 import 註解，仍依此規範

### 邊界注意事項

- 刪除部分區塊時要小心 **describe 區塊的大括號配對**：行號範圍涵蓋整個 describe 才能安全整段刪，若行號剛好切在 describe 內部會造成語法錯誤。執行時請以 `describe(...)` 為單位辨識邊界，行號只是定位用
- 刪除整檔時請用 `git rm` 而非單純 `rm`，確保 git 追蹤到刪除
- 刪除測試後若該檔的 import / helper 變成「import 了但沒用」，會被 eslint 抓出來，照 lint 提示清掉即可

### 不在本次範圍內的後續工作

以下為**參考資訊**，不在本次計畫執行範圍內，僅記錄供未來追蹤：

- `cursorColorManager.test.ts:38-42` 那個寫錯的測試，會另外開 issue / PR 處理
- `capabilities.test.ts` 的常數形狀驗證未來可改用 zod schema 在 production 端保證，本次只刪測試、不補 schema
