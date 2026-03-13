# Multi-Instance Workflow Run - 前端詳細實作計畫書

## 目錄
1. [UserFlow 使用情境](#userflow-使用情境)
2. [測試案例清單](#測試案例清單)
3. [實作計畫](#實作計畫)

---

## UserFlow 使用情境

### Flow 1：開啟歷程面板
1. 使用者在 canvas 中有至少一個 source pod 開啟 multi-instance
2. AppHeader 出現「歷程」按鈕
3. 點擊歷程按鈕，右側滑出 HistoryPanel sidebar
4. 再次點擊關閉 sidebar

### Flow 2：發送 Run 訊息
1. 使用者雙擊已開啟 multi-instance 的 source pod
2. ChatModal 開啟，顯示簡化版（只有輸入框，無歷史訊息）
3. 輸入訊息並送出
4. ChatModal 關閉，HistoryPanel 自動開啟
5. 新的 RunCard 出現在 HistoryPanel 最上方，狀態為 running

### Flow 3：查看 Run 進度
1. HistoryPanel 中的 RunCard 顯示收合狀態（source pod 名稱、訊息摘要、狀態圖標、時間）
2. 點擊 RunCard 展開，顯示垂直流程列表
3. 各 pod instance 即時更新狀態（pending → running → completed）
4. 整個 run 完成後，RunCard 狀態更新為 completed

### Flow 4：查看 Run 對話詳情
1. 在展開的 RunCard 中，點擊某個 pod instance
2. 開啟 RunChatModal（唯讀模式）
3. 顯示該 pod 在此 run 中的完整對話（含 tool_use / tool_result）
4. 無法發送訊息

### Flow 5：刪除 Run
1. 在 RunCard 上點擊刪除按鈕
2. 如果 run 正在執行中，提示會中斷所有串流
3. 確認後刪除，RunCard 從列表中移除

### Flow 6：下游 Pod 互動限制
1. 整條 multi-instance chain 中的下游 pod
2. 雙擊時不開啟 ChatModal，而是顯示 tooltip 提示
3. Pod 在 canvas 上永遠保持 idle 狀態

---

## 測試案例清單

### runStore 測試
- 初始狀態：runs 應為空陣列
- 初始狀態：isHistoryPanelOpen 應為 false
- 初始狀態：expandedRunIds 應為空 Set
- addRun：應新增 run 到列表
- addRun：重複 id 不應重複新增
- updateRunStatus：應更新指定 run 的狀態
- updateRunStatus：run 不存在時不應報錯
- updatePodInstanceStatus：應更新指定 run 中 pod 的狀態
- updatePodInstanceStatus：應同步更新 lastResponseSummary
- deleteRun：應從列表移除指定 run
- deleteRun：run 不存在時不應報錯
- toggleHistoryPanel：應切換 sidebar 開關
- toggleRunExpanded：應切換指定 run 的展開狀態
- toggleRunExpanded：已展開的 run 再次切換應收合
- sortedRuns：應依 createdAt 降冪排序（最新在上）
- hasMultiInstancePods：canvas 有 multi-instance pod 時應回傳 true
- hasMultiInstancePods：canvas 無 multi-instance pod 時應回傳 false
- runningRunsCount：應回傳正在執行中的 run 數量

### runEventHandlers 測試
- RUN_CREATED：應呼叫 addRun
- RUN_CREATED：canvasId 不符時應忽略
- RUN_STATUS_CHANGED：應呼叫 updateRunStatus
- RUN_POD_STATUS_CHANGED：應呼叫 updatePodInstanceStatus
- RUN_DELETED：應呼叫 deleteRun
- RUN_MESSAGE：正在查看的 RunChatModal 應接收訊息
- RUN_CHAT_COMPLETE：應更新該 pod instance 的最終內容

### multiInstanceGuard 測試（工具函式）
- isMultiInstanceChainPod：source pod 開啟 multi-instance，下游 pod 應回傳 true
- isMultiInstanceChainPod：獨立 pod 應回傳 false
- isMultiInstanceChainPod：非 multi-instance 的 workflow pod 應回傳 false
- isMultiInstanceSourcePod：有 multi-instance 的 source pod 應回傳 true
- isMultiInstanceSourcePod：下游 pod 應回傳 false

### RunCard 時間格式化測試
- formatRelativeTime：數秒前應顯示「剛剛」
- formatRelativeTime：數分鐘前應顯示「X 分鐘前」
- formatRelativeTime：數小時前應顯示「X 小時前」
- formatRelativeTime：超過一天應顯示「X 天前」

---

## 實作計畫

### 實作順序總覽

1. 型別定義（基礎設施）
2. 工具函式
3. runStore（核心狀態管理）
4. WebSocket events / requests 擴充
5. Run event handlers
6. UI 元件（由內到外）
7. 現有元件修改
8. App 層整合

---

### 第一階段：型別定義

#### 1.1 新增 `frontend/src/types/run.ts`

- [ ] 定義 `RunStatus` 型別：`'running' | 'completed' | 'error'`
- [ ] 定義 `RunPodStatus` 型別：`'pending' | 'running' | 'summarizing' | 'completed' | 'error' | 'skipped'`
- [ ] 定義 `RunPodInstance` 介面
  - `id: string` - pod instance 唯一識別（由後端產生）
  - `runId: string`
  - `podId: string` - 對應 canvas 上的 pod template ID
  - `podName: string`
  - `status: RunPodStatus`
  - `errorMessage?: string`
  - `lastResponseSummary?: string` - 截斷的最後回覆摘要
  - `triggeredAt?: string`
  - `completedAt?: string`
- [ ] 定義 `WorkflowRun` 介面
  - `id: string`
  - `canvasId: string`
  - `sourcePodId: string`
  - `sourcePodName: string`
  - `triggerMessage: string`
  - `status: RunStatus`
  - `podInstances: RunPodInstance[]`
  - `createdAt: string`
  - `completedAt?: string`
- [ ] 在 `frontend/src/types/index.ts` 匯出此模組

#### 1.2 擴充 WebSocket Events - `frontend/src/types/websocket/events.ts`

- [ ] 在 `WebSocketRequestEvents` 新增：
  - `RUN_DELETE: 'run:delete'`
  - `RUN_LOAD_HISTORY: 'run:load-history'`
  - `RUN_LOAD_POD_MESSAGES: 'run:load-pod-messages'`
- [ ] 在 `WebSocketResponseEvents` 新增：
  - `RUN_CREATED: 'run:created'`
  - `RUN_STATUS_CHANGED: 'run:status:changed'`
  - `RUN_POD_STATUS_CHANGED: 'run:pod:status:changed'`
  - `RUN_MESSAGE: 'run:message'`
  - `RUN_CHAT_COMPLETE: 'run:chat:complete'`
  - `RUN_DELETED: 'run:deleted'`
  - `RUN_HISTORY_RESULT: 'run:history:result'`
  - `RUN_POD_MESSAGES_RESULT: 'run:pod-messages:result'`

#### 1.3 擴充 WebSocket Requests - `frontend/src/types/websocket/requests.ts`

- [ ] 定義 `RunDeletePayload`
  - `requestId: string`
  - `canvasId: string`
  - `runId: string`
- [ ] 定義 `RunLoadHistoryPayload`
  - `requestId: string`
  - `canvasId: string`
- [ ] 定義 `RunLoadPodMessagesPayload`
  - `requestId: string`
  - `canvasId: string`
  - `runId: string`
  - `podId: string`

#### 1.4 擴充 WebSocket Responses - `frontend/src/types/websocket/responses.ts`

- [ ] 定義 `RunCreatedPayload`
  - `canvasId: string`
  - `run: WorkflowRun`
- [ ] 定義 `RunStatusChangedPayload`
  - `canvasId: string`
  - `runId: string`
  - `status: RunStatus`
  - `completedAt?: string`
- [ ] 定義 `RunPodStatusChangedPayload`
  - `canvasId: string`
  - `runId: string`
  - `podId: string`
  - `status: RunPodStatus`
  - `lastResponseSummary?: string`
  - `errorMessage?: string`
  - `triggeredAt?: string`
  - `completedAt?: string`
- [ ] 定義 `RunMessagePayload`（即時串流訊息）
  - `canvasId: string`
  - `runId: string`
  - `podId: string`
  - `messageId: string`
  - `content: string`
  - `isPartial: boolean`
  - `role?: 'user' | 'assistant'`
- [ ] 定義 `RunChatCompletePayload`
  - `canvasId: string`
  - `runId: string`
  - `podId: string`
  - `messageId: string`
  - `fullContent: string`
- [ ] 定義 `RunDeletedPayload`
  - `canvasId: string`
  - `runId: string`
- [ ] 定義 `RunHistoryResultPayload`
  - `requestId: string`
  - `success: boolean`
  - `runs?: WorkflowRun[]`
- [ ] 定義 `RunPodMessagesResultPayload`
  - `requestId: string`
  - `success: boolean`
  - `messages?: PersistedMessage[]`（複用現有 PersistedMessage）
- [ ] 定義 `RunToolUsePayload`（Run 中的 tool_use 事件）
  - `canvasId: string`
  - `runId: string`
  - `podId: string`
  - `messageId: string`
  - `toolUseId: string`
  - `toolName: string`
  - `input: Record<string, unknown>`
- [ ] 定義 `RunToolResultPayload`（Run 中的 tool_result 事件）
  - `canvasId: string`
  - `runId: string`
  - `podId: string`
  - `messageId: string`
  - `toolUseId: string`
  - `toolName: string`
  - `output: string`

---

### 第二階段：工具函式

#### 2.1 新增 `frontend/src/utils/multiInstanceGuard.ts`

- [ ] 實作 `isMultiInstanceSourcePod(podId: string): boolean`
  - 使用 `usePodStore` 取得 pod，確認 `pod.multiInstance === true`
  - 使用 `useConnectionStore` 確認 `isSourcePod(podId)` 為 true
  - 兩者皆為 true 才回傳 true
- [ ] 實作 `isMultiInstanceChainPod(podId: string): boolean`
  - 判斷指定 pod 是否屬於某條 multi-instance chain 的下游 pod
  - 從 connectionStore 取得所有上游連線，遞迴往上游走
  - 如果找到任何一個 `multiInstance === true` 的 source pod，回傳 true
  - 使用 BFS 避免堆疊溢位（參考 connectionStore 現有的 `runBFS` 模式）
- [ ] 實作 `getMultiInstanceSourcePodId(podId: string): string | null`
  - 取得指定 pod 所屬 multi-instance chain 的 source pod ID
  - 找不到時回傳 null

#### 2.2 新增 `frontend/src/utils/runFormatUtils.ts`

- [ ] 實作 `formatRelativeTime(isoString: string): string`
  - 計算距離現在的時間差
  - 小於 60 秒：回傳「剛剛」
  - 小於 60 分鐘：回傳「X 分鐘前」
  - 小於 24 小時：回傳「X 小時前」
  - 大於等於 24 小時：回傳「X 天前」
- [ ] 實作 `truncateMessage(message: string, maxLength: number): string`
  - 超過 maxLength 時截斷並加上 `...`
  - 未超過時原樣回傳

#### 2.3 擴充常數 - `frontend/src/lib/constants.ts`

- [ ] 新增 `RUN_TRIGGER_MESSAGE_PREVIEW_LENGTH = 40`
- [ ] 新增 `RUN_RESPONSE_SUMMARY_LENGTH = 60`
- [ ] 新增 `MAX_RUNS_PER_CANVAS = 30`

---

### 第三階段：runStore（核心狀態管理）

#### 3.1 新增 `frontend/src/stores/run/runStore.ts`

- [ ] 定義 `RunState` 介面
  - `runs: WorkflowRun[]` - 所有 run 列表
  - `isHistoryPanelOpen: boolean` - sidebar 開關狀態
  - `expandedRunIds: Set<string>` - 展開的 run ID 集合
  - `activeRunChatModal: { runId: string; podId: string } | null` - 目前開啟的 RunChatModal 資訊
  - `runChatMessages: Map<string, Message[]>` - key 為 `${runId}:${podId}`，存放 RunChatModal 的訊息
  - `isLoadingPodMessages: boolean` - 正在載入 pod 對話
- [ ] 使用 `defineStore('run', { ... })` 建立 store

**State 初始值：**
- `runs: []`
- `isHistoryPanelOpen: false`
- `expandedRunIds: new Set()`
- `activeRunChatModal: null`
- `runChatMessages: new Map()`
- `isLoadingPodMessages: false`

**Getters：**
- [ ] `sortedRuns` - 依 `createdAt` 降冪排序（最新在上），取前 `MAX_RUNS_PER_CANVAS` 筆
- [ ] `hasMultiInstancePods` - 遍歷 `usePodStore().pods`，檢查是否有任何 pod 的 `multiInstance === true` 且同時是 source pod（使用 `useConnectionStore().isSourcePod()`）
- [ ] `runningRunsCount` - 過濾 `runs` 中 `status === 'running'` 的數量
- [ ] `getRunById` - 依 id 回傳單筆 run
- [ ] `getActiveRunChatMessages` - 依 `activeRunChatModal` 的 runId + podId 組合 key 取得 messages

**Actions：**
- [ ] `loadRuns()` - 透過 WebSocket 請求載入歷史 run
  - 使用 `createWebSocketRequest` 發送 `RUN_LOAD_HISTORY` 事件
  - 回應後更新 `this.runs`
- [ ] `addRun(run: WorkflowRun)` - 新增 run 到列表頂部
  - 檢查重複 id，已存在則忽略
  - 如果超過 `MAX_RUNS_PER_CANVAS`，移除最舊的
- [ ] `updateRunStatus(runId: string, status: RunStatus, completedAt?: string)` - 更新 run 狀態
  - 找到對應 run 並更新 `status` 欄位
  - 如果有 `completedAt` 也一併更新
- [ ] `updatePodInstanceStatus(payload)` - 更新 run 中 pod instance 的狀態
  - 參數包含 `runId`, `podId`, `status`, `lastResponseSummary?`, `errorMessage?`, `triggeredAt?`, `completedAt?`
  - 找到對應 run，再找到對應的 podInstance 並更新
- [ ] `deleteRun(runId: string)` - 從列表移除 run
  - 同時從 `expandedRunIds` 移除
  - 如果 `activeRunChatModal` 指向此 run，清除它
  - 透過 WebSocket 發送 `RUN_DELETE` 事件通知後端
- [ ] `toggleHistoryPanel()` - 切換 `isHistoryPanelOpen`
- [ ] `openHistoryPanel()` - 設定 `isHistoryPanelOpen = true`
- [ ] `toggleRunExpanded(runId: string)` - 切換 `expandedRunIds` 中是否包含此 id
- [ ] `openRunChatModal(runId: string, podId: string)` - 設定 `activeRunChatModal`，並載入對話
  - 設定 `isLoadingPodMessages = true`
  - 透過 WebSocket 請求 `RUN_LOAD_POD_MESSAGES`
  - 回應後將 messages 存入 `runChatMessages` Map
  - 設定 `isLoadingPodMessages = false`
- [ ] `closeRunChatModal()` - 清除 `activeRunChatModal`
- [ ] `appendRunChatMessage(runId: string, podId: string, message)` - 即時串流時追加/更新訊息
  - 與現有 chatStore 的 chatMessageActions 處理邏輯類似
  - key 為 `${runId}:${podId}`
- [ ] `handleRunChatToolUse(payload)` - 處理 Run 串流中的 tool_use 事件
- [ ] `handleRunChatToolResult(payload)` - 處理 Run 串流中的 tool_result 事件
- [ ] `handleRunChatComplete(runId: string, podId: string, messageId: string, fullContent: string)` - 標記訊息為完整
- [ ] `resetOnCanvasSwitch()` - canvas 切換時重置所有 run 狀態
  - 清空 `runs`, `expandedRunIds`, `activeRunChatModal`, `runChatMessages`
  - 關閉 `isHistoryPanelOpen`

---

### 第四階段：Run Event Handlers

#### 4.1 新增 `frontend/src/composables/eventHandlers/runEventHandlers.ts`

- [ ] 使用 `createUnifiedHandler` 建立 `handleRunCreated`
  - payload 型別：`BasePayload & RunCreatedPayload`
  - 呼叫 `useRunStore().addRun(payload.run)`
- [ ] 使用 `createUnifiedHandler` 建立 `handleRunStatusChanged`
  - payload 型別：`BasePayload & RunStatusChangedPayload`
  - 呼叫 `useRunStore().updateRunStatus(payload.runId, payload.status, payload.completedAt)`
- [ ] 使用 `createUnifiedHandler` 建立 `handleRunPodStatusChanged`
  - payload 型別：`BasePayload & RunPodStatusChangedPayload`
  - 呼叫 `useRunStore().updatePodInstanceStatus(payload)`
- [ ] 使用 `createUnifiedHandler` 建立 `handleRunDeleted`
  - payload 型別：`BasePayload & RunDeletedPayload`
  - 呼叫 `useRunStore().deleteRun(payload.runId)`（前端 store 層直接移除，不再發 WebSocket）
  - 注意：這是接收後端推送的刪除事件，與使用者主動刪除（會發 WebSocket）不同
- [ ] 建立 `handleRunMessage` 函式（standalone，不使用 createUnifiedHandler）
  - 因為串流訊息不含 requestId，與 `POD_CHAT_USER_MESSAGE` 同理
  - payload 型別：`RunMessagePayload`
  - 檢查 `activeRunChatModal` 是否匹配此 runId + podId
  - 匹配時呼叫 `useRunStore().appendRunChatMessage(...)`
- [ ] 建立 `handleRunChatComplete` 函式（standalone）
  - payload 型別：`RunChatCompletePayload`
  - 呼叫 `useRunStore().handleRunChatComplete(...)`
- [ ] 建立 `handleRunToolUse` 函式（standalone）
  - payload 型別：`RunToolUsePayload`
  - 呼叫 `useRunStore().handleRunChatToolUse(payload)`
- [ ] 建立 `handleRunToolResult` 函式（standalone）
  - payload 型別：`RunToolResultPayload`
  - 呼叫 `useRunStore().handleRunChatToolResult(payload)`
- [ ] 匯出 `getRunEventListeners()` 函式
  - 回傳 `{ event, handler }[]` 陣列，包含 `RUN_CREATED`, `RUN_STATUS_CHANGED`, `RUN_POD_STATUS_CHANGED`, `RUN_DELETED` 四個事件
- [ ] 匯出 `getRunStandaloneListeners()` 函式
  - 回傳 `{ event, handler }[]` 陣列，包含 `RUN_MESSAGE`, `RUN_CHAT_COMPLETE`, `RUN_TOOL_USE`, `RUN_TOOL_RESULT` 四個事件
  - 這些事件不含 canvasId/requestId，無法套用 createUnifiedHandler

#### 4.2 修改 `frontend/src/composables/useUnifiedEventListeners.ts`

- [ ] import `getRunEventListeners` 和 `getRunStandaloneListeners`
- [ ] 在 `listeners` 陣列中加入 `...getRunEventListeners()`
- [ ] 在 `standaloneListeners` 陣列中加入 `...getRunStandaloneListeners()`

---

### 第五階段：UI 元件（由內到外）

#### 5.1 新增 `frontend/src/components/run/RunStatusIcon.vue`

- [ ] Props：`status: RunStatus | RunPodStatus`
- [ ] 根據 status 渲染對應圖標：
  - `completed`：CheckCircle（lucide），顏色 `text-doodle-green`
  - `running`：Loader2（lucide），加 `animate-spin`，顏色 `text-doodle-blue`
  - `pending`：Clock（lucide），顏色 `text-muted-foreground`
  - `error`：XCircle（lucide），顏色 `text-destructive`
  - `skipped`：SkipForward（lucide），顏色 `text-muted-foreground`
  - `summarizing`：FileText（lucide），加 `animate-pulse`，顏色 `text-doodle-orange`
- [ ] 統一使用 `:size="16"` 尺寸

#### 5.2 新增 `frontend/src/components/run/RunChatModal.vue`

- [ ] Props：
  - `runId: string`
  - `podId: string`
  - `podName: string`
  - `runStatus: RunStatus`
- [ ] Emits：`close`
- [ ] 組合：複用現有 `ChatMessages` 元件（唯讀模式）
- [ ] 模板結構：
  - 最外層 `fixed inset-0 z-50` 與現有 ChatModal 一致
  - 半透明 overlay `modal-overlay`
  - 主容器使用 `chat-window` class（複用現有 doodle 風格）
  - Header：顯示 pod 名稱 + RunStatusIcon + 關閉按鈕
  - Body：使用 ChatMessages 元件，傳入 `messages` 和 `isTyping`
  - 底部：不渲染 ChatInput，改顯示唯讀提示文字「此為歷程紀錄，僅供查看」
- [ ] 從 `useRunStore` 取得：
  - `getActiveRunChatMessages` 作為 messages
  - `isLoadingPodMessages` 作為 loading 狀態
- [ ] 掛載 `onMounted` 監聽 Escape 關閉
- [ ] 判斷 `isTyping`：檢查對應 podInstance 的 status 是否為 `'running'`

#### 5.3 新增 `frontend/src/components/run/RunPodInstanceItem.vue`

- [ ] Props：
  - `instance: RunPodInstance`
  - `runId: string`
- [ ] Emits：`click`
- [ ] 顯示內容（水平排列）：
  - 左側：`RunStatusIcon`，傳入 `instance.status`
  - 中間上方：pod 名稱（`font-semibold text-sm`）
  - 中間下方：最後回覆摘要（`text-xs text-muted-foreground`），使用 `truncateMessage` 截斷
  - 右側：觸發時間（`text-xs text-muted-foreground`），使用 `formatRelativeTime`
- [ ] 可點擊，hover 時背景變色（`hover:bg-accent`）
- [ ] 點擊時 emit `click` 事件

#### 5.4 新增 `frontend/src/components/run/RunCard.vue`

- [ ] Props：
  - `run: WorkflowRun`
  - `isExpanded: boolean`
- [ ] Emits：
  - `toggle-expand`
  - `delete`
  - `open-pod-chat: [runId: string, podId: string, podName: string]`

**收合狀態模板：**
- [ ] 最外層容器：`border-2 border-border rounded-lg p-3 mb-2`，可點擊切換展開
- [ ] 第一行（flex justify-between）：
  - 左側：Source pod 名稱（`text-sm font-semibold`）
  - 右上角：`RunStatusIcon`，傳入 `run.status`
- [ ] 第二行：觸發訊息摘要（`text-xs text-muted-foreground truncate`）
- [ ] 第三行（flex justify-between）：
  - 左側：相對時間（`text-xs text-muted-foreground`）
  - 右側：刪除按鈕（Trash2 icon），`@click.stop` 避免觸發展開

**展開狀態模板：**
- [ ] 收合狀態內容保持顯示
- [ ] 增加分隔線 `border-t border-border mt-2 pt-2`
- [ ] 垂直流程列表：`v-for="instance in run.podInstances"` 渲染 `RunPodInstanceItem`
  - 依 `triggeredAt` 排序（已由後端排好），扁平化展示
  - 每個 item 之間用虛線連接（CSS pseudo-element 或 border-left）
- [ ] RunPodInstanceItem 的 `@click` 觸發 emit `open-pod-chat`

#### 5.5 新增 `frontend/src/components/run/HistoryPanel.vue`

- [ ] Props：`open: boolean`
- [ ] Emits：`update:open`

**結構參考 `CanvasSidebar.vue`：**
- [ ] 使用 `<Transition name="sidebar">` 動畫（複用現有 CSS）
- [ ] 固定定位：`fixed right-0 z-40 h-[calc(100vh-64px)] w-80` 寬度 320px（比 CanvasSidebar 稍寬）
  - `style="top: 64px"` 避開 header
  - `border-l border-border bg-background`
- [ ] Header 區塊：
  - 標題「歷程」
  - 右側關閉按鈕（X icon）
  - 執行中數量 badge（如有 running runs）
- [ ] Body 區塊（`flex-1 overflow-y-auto p-3`）：
  - 空狀態：當 `sortedRuns.length === 0`，顯示提示文字「尚無執行歷程」
  - `v-for="run in sortedRuns"` 渲染 `RunCard`
  - 傳入 `isExpanded` 依據 `expandedRunIds.has(run.id)`
- [ ] 監聽點擊外部關閉（`mousedown` on document，排除自身和 header 按鈕）
- [ ] 監聽 Escape 關閉

**RunCard 事件處理：**
- [ ] `@toggle-expand` → 呼叫 `runStore.toggleRunExpanded(run.id)`
- [ ] `@delete` → 呼叫 `runStore.deleteRun(run.id)`
- [ ] `@open-pod-chat` → 呼叫 `runStore.openRunChatModal(runId, podId)`

#### 5.6 新增 `frontend/src/components/chat/ChatMultiInstanceInput.vue`

此元件用於 multi-instance source pod 的簡化版 ChatModal，只有輸入框。

- [ ] Props：`podId: string`
- [ ] Emits：`send: [message: string]`, `close`
- [ ] 模板結構：
  - 提示文字區塊：「此 Pod 已啟用 Multi-Instance，每次送出訊息將建立新的 Run」
  - 複用 ChatInput 元件（或簡化版），不顯示語音按鈕
  - 送出後 emit `send`，不在此元件顯示訊息

---

### 第六階段：修改現有元件

#### 6.1 修改 `frontend/src/components/layout/AppHeader.vue`

- [ ] import `History` icon（from lucide-vue-next）
- [ ] import `useRunStore`
- [ ] 取得 `runStore`，使用 `computed` 取 `hasMultiInstancePods`
- [ ] 在設定按鈕與整合服務按鈕之間（或 Canvas 按鈕之前）新增歷程按鈕：
  ```
  <button v-if="runStore.hasMultiInstancePods" data-history-toggle ...>
    <History class="h-4 w-4" />
  </button>
  ```
- [ ] 按鈕點擊呼叫 `runStore.toggleHistoryPanel()`
- [ ] 按鈕加上 `title="歷程"`

#### 6.2 修改 `frontend/src/components/chat/ChatModal.vue`

- [ ] import `isMultiInstanceSourcePod` from `@/utils/multiInstanceGuard`
- [ ] 新增 computed `isMultiInstanceMode`：呼叫 `isMultiInstanceSourcePod(props.pod.id)`
- [ ] 當 `isMultiInstanceMode` 為 true 時：
  - 不渲染 `ChatMessages`
  - 不渲染 `ChatWorkflowBlockedHint` 和 `ChatIntegrationBlockedHint`
  - 改為渲染 `ChatMultiInstanceInput`
  - Header 保持渲染（顯示 pod 名稱和關閉按鈕）
- [ ] `ChatMultiInstanceInput` 的 `@send` 事件處理：
  - 呼叫 `chatStore.sendMessage(props.pod.id, message)`（送出仍走原有的 chat send 邏輯，後端會判斷是 multi-instance 並建立 run）
  - 送出後呼叫 `runStore.openHistoryPanel()` 打開 sidebar
  - 關閉 ChatModal（emit `close`）

#### 6.3 修改 `frontend/src/components/pod/CanvasPod.vue`

- [ ] import `isMultiInstanceChainPod` from `@/utils/multiInstanceGuard`
- [ ] 新增 computed `isDownstreamMultiInstance`：呼叫 `isMultiInstanceChainPod(props.pod.id)`，但排除 source pod 本身（source pod 仍可雙擊開啟簡化 ChatModal）
  - 具體條件：`isMultiInstanceChainPod(props.pod.id) && !isMultiInstanceSourcePod(props.pod.id)`（即：屬於 chain 但不是 source）
- [ ] 修改 `handleDblClick`：
  - 如果 `isDownstreamMultiInstance` 為 true，不呼叫 `handleSelectPod()`
  - 改為顯示 tooltip / toast 提示：「此 Pod 屬於 Multi-Instance 流程，請從歷程查看」
  - 使用 `useToast` 顯示短暫 toast 即可

#### 6.4 修改 `frontend/src/App.vue`

- [ ] import `HistoryPanel` from `@/components/run/HistoryPanel.vue`
- [ ] import `RunChatModal` from `@/components/run/RunChatModal.vue`
- [ ] import `useRunStore`
- [ ] 取得 `runStore`
- [ ] 在 template 中 CanvasSidebar 後方新增 HistoryPanel：
  ```
  <HistoryPanel :open="runStore.isHistoryPanelOpen" @update:open="runStore.isHistoryPanelOpen = $event" />
  ```
- [ ] 在 ChatModal 後方新增 RunChatModal（條件渲染）：
  ```
  <RunChatModal
    v-if="runStore.activeRunChatModal"
    :run-id="runStore.activeRunChatModal.runId"
    :pod-id="runStore.activeRunChatModal.podId"
    :pod-name="..."
    :run-status="..."
    @close="runStore.closeRunChatModal()"
  />
  ```
  - `podName` 和 `runStatus` 從 `runStore.getRunById` 取得
- [ ] 在 `loadCanvasData` 中加入 `runStore.loadRuns()` 呼叫
- [ ] 在 `watch(canvasStore.activeCanvasId)` 切換 canvas 時呼叫 `runStore.resetOnCanvasSwitch()`
- [ ] 在 `onUnmounted` 清理時也呼叫 `runStore.resetOnCanvasSwitch()`

---

### 第七階段：補充 Run WebSocket Events 註冊到 events.ts

此階段確認第一階段新增的事件常數在 `events.ts` 中已正確定義，並確保所有 response events 也有加入對應的 `RUN_TOOL_USE` 和 `RUN_TOOL_RESULT`。

#### 7.1 補充 `WebSocketResponseEvents`

- [ ] `RUN_TOOL_USE: 'run:tool_use'`
- [ ] `RUN_TOOL_RESULT: 'run:tool_result'`

---

### 第八階段：測試撰寫

#### 8.1 新增 `frontend/tests/stores/run/runStore.test.ts`

使用現有測試模式（`setupStoreTest`, `webSocketMockFactory`, `createMockPod`, `createMockConnection`）。

- [ ] Mock WebSocket（`vi.mock('@/services/websocket', () => webSocketMockFactory())`）
- [ ] Mock useToast
- [ ] Mock useCanvasWebSocketAction

**初始狀態測試：**
- [ ] runs 應為空陣列
- [ ] isHistoryPanelOpen 應為 false
- [ ] expandedRunIds 應為空 Set

**addRun 測試：**
- [ ] 應新增 run 到列表
- [ ] 重複 id 不應重複新增

**updateRunStatus 測試：**
- [ ] 應更新指定 run 的狀態
- [ ] run 不存在時不應報錯

**updatePodInstanceStatus 測試：**
- [ ] 應更新指定 run 中 pod instance 的狀態
- [ ] 應一併更新 lastResponseSummary

**deleteRun 測試：**
- [ ] 應從列表移除指定 run
- [ ] 應同時清除 expandedRunIds 中的記錄
- [ ] run 不存在時不應報錯

**toggleHistoryPanel 測試：**
- [ ] 應切換 sidebar 開關

**toggleRunExpanded 測試：**
- [ ] 應切換指定 run 的展開狀態
- [ ] 已展開的 run 再次切換應收合

**sortedRuns getter 測試：**
- [ ] 應依 createdAt 降冪排序

**hasMultiInstancePods getter 測試：**
- [ ] canvas 有 multi-instance source pod 時應回傳 true
- [ ] canvas 無 multi-instance pod 時應回傳 false

**runningRunsCount getter 測試：**
- [ ] 應回傳正在執行中的 run 數量

#### 8.2 新增 `frontend/tests/utils/multiInstanceGuard.test.ts`

- [ ] Mock podStore 和 connectionStore
- [ ] `isMultiInstanceSourcePod`：source pod 有 multiInstance 應回傳 true
- [ ] `isMultiInstanceSourcePod`：下游 pod 應回傳 false
- [ ] `isMultiInstanceSourcePod`：multiInstance 為 false 應回傳 false
- [ ] `isMultiInstanceChainPod`：下游 pod 屬於 multi-instance chain 應回傳 true
- [ ] `isMultiInstanceChainPod`：獨立 pod 應回傳 false
- [ ] `isMultiInstanceChainPod`：非 multi-instance workflow 的 pod 應回傳 false
- [ ] `getMultiInstanceSourcePodId`：應回傳對應的 source pod ID
- [ ] `getMultiInstanceSourcePodId`：找不到時應回傳 null

#### 8.3 新增 `frontend/tests/utils/runFormatUtils.test.ts`

- [ ] `formatRelativeTime`：數秒前應顯示「剛剛」
- [ ] `formatRelativeTime`：3 分鐘前應顯示「3 分鐘前」
- [ ] `formatRelativeTime`：2 小時前應顯示「2 小時前」
- [ ] `formatRelativeTime`：超過一天應顯示「X 天前」
- [ ] `truncateMessage`：超過長度應截斷並加 `...`
- [ ] `truncateMessage`：未超過長度應原樣回傳
- [ ] `truncateMessage`：空字串應回傳空字串

#### 8.4 新增 `frontend/tests/composables/eventHandlers/runEventHandlers.test.ts`

- [ ] Mock runStore
- [ ] `RUN_CREATED` 事件應呼叫 `addRun`
- [ ] `RUN_CREATED` canvasId 不符時應忽略
- [ ] `RUN_STATUS_CHANGED` 應呼叫 `updateRunStatus`
- [ ] `RUN_POD_STATUS_CHANGED` 應呼叫 `updatePodInstanceStatus`
- [ ] `RUN_DELETED` 應從 store 移除 run

#### 8.5 新增 `frontend/tests/helpers/factories.ts` 擴充

- [ ] 新增 `createMockWorkflowRun(overrides?: Partial<WorkflowRun>): WorkflowRun`
  - 預設值：id 遞增、canvasId、sourcePodId、sourcePodName、triggerMessage、status='running'、podInstances=[]、createdAt=ISO 字串
- [ ] 新增 `createMockRunPodInstance(overrides?: Partial<RunPodInstance>): RunPodInstance`
  - 預設值：id 遞增、runId、podId、podName、status='pending'

---

### 新增/修改檔案清單

| 操作 | 檔案路徑 |
|------|----------|
| 新增 | `frontend/src/types/run.ts` |
| 修改 | `frontend/src/types/index.ts` |
| 修改 | `frontend/src/types/websocket/events.ts` |
| 修改 | `frontend/src/types/websocket/requests.ts` |
| 修改 | `frontend/src/types/websocket/responses.ts` |
| 新增 | `frontend/src/utils/multiInstanceGuard.ts` |
| 新增 | `frontend/src/utils/runFormatUtils.ts` |
| 修改 | `frontend/src/lib/constants.ts` |
| 新增 | `frontend/src/stores/run/runStore.ts` |
| 新增 | `frontend/src/composables/eventHandlers/runEventHandlers.ts` |
| 修改 | `frontend/src/composables/useUnifiedEventListeners.ts` |
| 新增 | `frontend/src/components/run/RunStatusIcon.vue` |
| 新增 | `frontend/src/components/run/RunChatModal.vue` |
| 新增 | `frontend/src/components/run/RunPodInstanceItem.vue` |
| 新增 | `frontend/src/components/run/RunCard.vue` |
| 新增 | `frontend/src/components/run/HistoryPanel.vue` |
| 新增 | `frontend/src/components/chat/ChatMultiInstanceInput.vue` |
| 修改 | `frontend/src/components/layout/AppHeader.vue` |
| 修改 | `frontend/src/components/chat/ChatModal.vue` |
| 修改 | `frontend/src/components/pod/CanvasPod.vue` |
| 修改 | `frontend/src/App.vue` |
| 新增 | `frontend/tests/stores/run/runStore.test.ts` |
| 新增 | `frontend/tests/utils/multiInstanceGuard.test.ts` |
| 新增 | `frontend/tests/utils/runFormatUtils.test.ts` |
| 新增 | `frontend/tests/composables/eventHandlers/runEventHandlers.test.ts` |
| 修改 | `frontend/tests/helpers/factories.ts` |
