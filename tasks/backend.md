# Multi-Instance Workflow Run - 後端實作計畫書

## 測試案例清單

### `runStore.test.ts` - Run 三張表 CRUD
- 建立 workflow run 並正確回傳
- 根據 canvas_id 查詢 run 列表（依 created_at 降序）
- 更新 run 狀態為 completed 並設定 completed_at
- 更新 run 狀態為 error
- 刪除 run 同時刪除 run_pod_instances 與 run_messages（CASCADE）
- 建立 run_pod_instance 並正確回傳
- 更新 run_pod_instance 狀態（pending → running → completed）
- 查詢某個 run 的全部 pod instances
- 建立 run_message 並正確回傳
- 查詢某個 run + pod 的訊息列表（依 timestamp 排序）
- upsert run_message（串流中重複更新同一筆）

### `runExecutionService.test.ts` - Run 執行生命週期
- source pod 為 multi-instance 時，建立 run 並用 RunContext 執行
- source pod 非 multi-instance 時，走原本流程不受影響
- 同一 source pod 可同時存在多個 running 的 run
- run 中的 pod instance 完成後觸發下游 workflow（帶 RunContext）
- run 中的 pod instance 發生錯誤時不觸發下游，標記 error
- run 所有 pod instance 完成後，run 狀態變為 completed
- run 超過 30 筆時，自動刪除最舊的已完成 run
- 刪除 run 時中斷該 run 所有進行中的 Claude 串流

### `runContextPropagation.test.ts` - RunContext 傳遞
- RunContext 從 chatHandlers 傳入 workflowExecutionService
- RunContext 傳遞到 workflowPipeline
- RunContext 傳遞到各 trigger service（auto/ai-decide/direct）
- RunContext 傳遞到 streamingChatExecutor
- RunContext 傳遞到 workflowMultiInputService
- 有 RunContext 時 message 寫入 run_messages 而非 messages
- 有 RunContext 時不更新 pod 全域狀態
- 有 RunContext 時不使用 workflowQueueService（真正並行）
- 無 RunContext 時完全向後相容

### `runHandlers.test.ts` - WebSocket Handler
- RUN_DELETE 刪除 run 並中斷進行中的串流
- RUN_DELETE 回傳 RUN_DELETED 事件
- RUN_LOAD_HISTORY 回傳 canvas 的 run 歷史
- RUN_LOAD_POD_MESSAGES 回傳指定 run + pod 的訊息

---

## 實作計畫

### 階段一：資料層（DB Schema + Store）

- [ ] 1. 在 `schema.ts` 新增三張表
  - `workflow_runs` 表：`id TEXT PK`, `canvas_id TEXT NOT NULL`, `source_pod_id TEXT NOT NULL`, `trigger_message TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'running'`（running/completed/error）, `created_at TEXT NOT NULL`, `completed_at TEXT`
  - 建立索引 `idx_workflow_runs_canvas_id` on `workflow_runs(canvas_id)`
  - 建立索引 `idx_workflow_runs_status` on `workflow_runs(canvas_id, status)`
  - `run_pod_instances` 表：`id TEXT PK`, `run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE`, `pod_id TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'pending'`（pending/running/summarizing/completed/error/skipped）, `claude_session_id TEXT`, `error_message TEXT`, `triggered_at TEXT`, `completed_at TEXT`
  - 建立索引 `idx_run_pod_instances_run_id` on `run_pod_instances(run_id)`
  - 建立複合索引 `idx_run_pod_instances_run_pod` on `run_pod_instances(run_id, pod_id)`
  - `run_messages` 表：`id TEXT PK`, `run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE`, `pod_id TEXT NOT NULL`, `role TEXT NOT NULL`, `content TEXT NOT NULL`, `timestamp TEXT NOT NULL`, `sub_messages_json TEXT`
  - 建立索引 `idx_run_messages_run_pod` on `run_messages(run_id, pod_id)`

- [ ] 2. 在 `statements.ts` 新增三張表的 prepared statements
  - `workflowRun` 群組：
    - `insert`：INSERT INTO workflow_runs
    - `selectByCanvasId`：SELECT * FROM workflow_runs WHERE canvas_id = ? ORDER BY created_at DESC
    - `selectById`：SELECT * FROM workflow_runs WHERE id = ?
    - `updateStatus`：UPDATE workflow_runs SET status = $status, completed_at = $completedAt WHERE id = $id
    - `deleteById`：DELETE FROM workflow_runs WHERE id = ?
    - `countByCanvasId`：SELECT COUNT(*) as count FROM workflow_runs WHERE canvas_id = ?
    - `selectOldestCompleted`：SELECT id FROM workflow_runs WHERE canvas_id = ? AND status = 'completed' ORDER BY created_at ASC LIMIT ?
  - `runPodInstance` 群組：
    - `insert`：INSERT INTO run_pod_instances
    - `selectByRunId`：SELECT * FROM run_pod_instances WHERE run_id = ?
    - `selectByRunIdAndPodId`：SELECT * FROM run_pod_instances WHERE run_id = $runId AND pod_id = $podId
    - `updateStatus`：UPDATE run_pod_instances SET status = $status, error_message = $errorMessage, completed_at = $completedAt WHERE id = $id
    - `updateClaudeSessionId`：UPDATE run_pod_instances SET claude_session_id = $claudeSessionId WHERE id = $id
    - `selectRunningByRunId`：SELECT * FROM run_pod_instances WHERE run_id = ? AND status IN ('pending', 'running', 'summarizing')
    - `deleteByRunId`：DELETE FROM run_pod_instances WHERE run_id = ?
  - `runMessage` 群組：
    - `insert`：INSERT INTO run_messages
    - `selectByRunIdAndPodId`：SELECT * FROM run_messages WHERE run_id = $runId AND pod_id = $podId ORDER BY timestamp ASC
    - `upsert`：INSERT OR REPLACE INTO run_messages
    - `deleteByRunId`：DELETE FROM run_messages WHERE run_id = ?

- [ ] 3. 更新 `database/index.ts` 的 `resetDb()` 函式
  - 在子表刪除區塊加入：`DELETE FROM run_messages`、`DELETE FROM run_pod_instances`、`DELETE FROM workflow_runs`（順序：run_messages → run_pod_instances → workflow_runs）

- [ ] 4. 建立 `services/runStore.ts` - Run 三張表的 CRUD 服務
  - 定義 `WorkflowRun` 介面：`id`, `canvasId`, `sourcePodId`, `triggerMessage`, `status`('running'|'completed'|'error'), `createdAt`, `completedAt`
  - 定義 `RunPodInstance` 介面：`id`, `runId`, `podId`, `status`('pending'|'running'|'summarizing'|'completed'|'error'|'skipped'), `claudeSessionId`, `errorMessage`, `triggeredAt`, `completedAt`
  - 定義 `RunMessage` 介面：`id`, `runId`, `podId`, `role`, `content`, `timestamp`, `subMessages?`
  - 定義 `RunStatus` 和 `RunPodInstanceStatus` 類型別名
  - 實作 `RunStore` class，包含以下方法：
    - `createRun(canvasId, sourcePodId, triggerMessage)` → 產生 uuid 寫入 workflow_runs，回傳 WorkflowRun
    - `getRun(runId)` → 查詢單筆 run
    - `getRunsByCanvasId(canvasId)` → 查詢 canvas 下所有 run（降序）
    - `updateRunStatus(runId, status)` → 更新狀態，若 completed/error 則設定 completed_at
    - `deleteRun(runId)` → 刪除 run（CASCADE 自動刪除子表）
    - `countRunsByCanvasId(canvasId)` → 回傳 canvas 下 run 總數
    - `getOldestCompletedRunIds(canvasId, limit)` → 回傳最舊已完成 run 的 id 列表
    - `createPodInstance(runId, podId)` → 產生 uuid 寫入 run_pod_instances，預設 status=pending
    - `getPodInstance(runId, podId)` → 查詢指定 run + pod 的 instance
    - `getPodInstancesByRunId(runId)` → 查詢 run 下所有 instance
    - `updatePodInstanceStatus(instanceId, status, errorMessage?)` → 更新 instance 狀態
    - `updatePodInstanceClaudeSessionId(instanceId, sessionId)` → 更新 claude_session_id
    - `getRunningPodInstances(runId)` → 取得還在執行中的 instance（status 為 pending/running/summarizing）
    - `addRunMessage(runId, podId, role, content, subMessages?)` → 寫入 run_messages
    - `upsertRunMessage(runId, podId, message: PersistedMessage)` → 串流中 upsert
    - `getRunMessages(runId, podId)` → 查詢指定 run + pod 的訊息
  - 匯出 singleton `runStore`

### 階段二：RunContext 型別定義

- [ ] 5. 建立 `types/run.ts` - Run 相關型別
  - 定義 `RunContext` 介面：`runId: string`, `canvasId: string`, `sourcePodId: string`
  - 定義 `RunStatus = 'running' | 'completed' | 'error'`
  - 定義 `RunPodInstanceStatus = 'pending' | 'running' | 'summarizing' | 'completed' | 'error' | 'skipped'`
  - 定義 WebSocket payload 型別：
    - `RunCreatedPayload`：`runId`, `canvasId`, `sourcePodId`, `triggerMessage`, `status`, `createdAt`
    - `RunStatusChangedPayload`：`runId`, `canvasId`, `status`, `completedAt?`
    - `RunPodStatusChangedPayload`：`runId`, `canvasId`, `podId`, `status`, `errorMessage?`
    - `RunMessagePayload`：`runId`, `canvasId`, `podId`, `messageId`, `content`, `isPartial`, `role`
    - `RunChatCompletePayload`：`runId`, `canvasId`, `podId`, `messageId`, `fullContent`
    - `RunDeletedPayload`：`runId`, `canvasId`
    - `RunsLoadedPayload`：`canvasId`, `runs: WorkflowRun[]`
    - `RunPodMessagesLoadedPayload`：`runId`, `podId`, `messages: PersistedMessage[]`
  - 在 `types/index.ts` 加入 export

- [ ] 6. 在 `schemas/events.ts` 新增 WebSocket 事件
  - `WebSocketRequestEvents` 新增：
    - `RUN_DELETE = 'run:delete'`
    - `RUN_LOAD_HISTORY = 'run:load-history'`
    - `RUN_LOAD_POD_MESSAGES = 'run:load-pod-messages'`
  - `WebSocketResponseEvents` 新增：
    - `RUN_CREATED = 'run:created'`
    - `RUN_STATUS_CHANGED = 'run:status-changed'`
    - `RUN_POD_STATUS_CHANGED = 'run:pod-status-changed'`
    - `RUN_MESSAGE = 'run:message'`
    - `RUN_CHAT_COMPLETE = 'run:chat-complete'`
    - `RUN_CHAT_TOOL_USE = 'run:chat:tool-use'`
    - `RUN_CHAT_TOOL_RESULT = 'run:chat:tool-result'`
    - `RUN_DELETED = 'run:deleted'`
    - `RUN_HISTORY_LOADED = 'run:history-loaded'`
    - `RUN_POD_MESSAGES_LOADED = 'run:pod-messages-loaded'`

- [ ] 7. 建立 `schemas/runSchemas.ts` - Run 相關的 Zod schema
  - `runDeleteSchema`：`requestId`, `canvasId`, `runId`
  - `runLoadHistorySchema`：`requestId`, `canvasId`
  - `runLoadPodMessagesSchema`：`requestId`, `canvasId`, `runId`, `podId`
  - 對應的 payload type export
  - 在 `schemas/index.ts` 加入 `export * from './runSchemas.js'`

### 階段三：Run 執行引擎

- [ ] 8. 建立 `services/workflow/runExecutionService.ts` - Run 生命週期管理
  - 定義 `MAX_RUNS_PER_CANVAS = 30` 常數
  - 定義 `activeRunStreams: Map<string, Set<string>>`，key 為 runId，value 為正在執行的 podId 集合（用於中斷串流）
  - 實作 `createRun(canvasId, sourcePodId, triggerMessage)` 方法：
    - 呼叫 `runStore.createRun()`
    - 掃描 workflow chain 中所有會經過的 pod（從 source 開始沿 connection 遞迴走訪），為每個 pod 建立 `run_pod_instance`（status=pending）
    - 發送 `RUN_CREATED` WebSocket 事件
    - 呼叫 `enforceRunLimit(canvasId)` 清理超出上限的舊 run
    - 回傳 `RunContext { runId, canvasId, sourcePodId }`
  - 實作 `enforceRunLimit(canvasId)` 方法：
    - 查詢 canvas 下 run 總數
    - 若超過 `MAX_RUNS_PER_CANVAS`，取得超出數量的最舊已完成 run id
    - 逐一呼叫 `deleteRun()`
  - 實作 `startPodInstance(runContext, podId)` 方法：
    - 更新 instance status 為 running，設定 triggered_at
    - 發送 `RUN_POD_STATUS_CHANGED` 事件
  - 實作 `completePodInstance(runContext, podId)` 方法：
    - 更新 instance status 為 completed，設定 completed_at
    - 發送 `RUN_POD_STATUS_CHANGED` 事件
    - 呼叫 `evaluateRunStatus(runContext.runId)` 判斷整體狀態
  - 實作 `errorPodInstance(runContext, podId, errorMessage)` 方法：
    - 更新 instance status 為 error，記錄 error_message
    - 發送 `RUN_POD_STATUS_CHANGED` 事件
    - 呼叫 `evaluateRunStatus(runContext.runId)` 判斷整體狀態
  - 實作 `summarizingPodInstance(runContext, podId)` 方法：
    - 更新 instance status 為 summarizing
    - 發送 `RUN_POD_STATUS_CHANGED` 事件
  - 實作 `skipPodInstance(runContext, podId)` 方法：
    - 更新 instance status 為 skipped
    - 發送 `RUN_POD_STATUS_CHANGED` 事件
    - 呼叫 `evaluateRunStatus(runContext.runId)` 判斷整體狀態
  - 實作 `evaluateRunStatus(runId)` 方法：
    - 查詢所有 instance
    - 全部 completed/skipped → run status = completed
    - 有 error 且無 running/pending/summarizing → run status = error
    - 其他 → 維持 running
    - 若狀態變更，呼叫 `runStore.updateRunStatus()` 並發送 `RUN_STATUS_CHANGED` 事件
  - 實作 `registerActiveStream(runId, podId)` 方法：
    - 在 `activeRunStreams` 中記錄
  - 實作 `unregisterActiveStream(runId, podId)` 方法：
    - 從 `activeRunStreams` 中移除
  - 實作 `deleteRun(runId)` 方法：
    - 取得 `activeRunStreams` 中該 run 的所有 podId
    - 對每個 podId 呼叫 `claudeService.abortQuery()` 中斷串流
    - 呼叫 `runStore.deleteRun(runId)` 刪除 DB 資料
    - 發送 `RUN_DELETED` 事件
  - 匯出 singleton `runExecutionService`

### 階段四：修改現有 Workflow 邏輯 - 傳遞 RunContext

> 核心策略：所有 workflow 相關方法新增 optional `runContext?: RunContext` 參數。有 RunContext 時走 run-specific 路徑，無則完全向後相容。

- [ ] 9. 修改 `services/workflow/types.ts` - 擴展型別定義
  - 引入 `RunContext` type
  - `PipelineContext` 新增 `runContext?: RunContext`
  - `TriggerWorkflowWithSummaryParams` 新增 `runContext?: RunContext`
  - `TriggerLifecycleContext` 新增 `runContext?: RunContext`
  - `CompletionContext` 新增 `runContext?: RunContext`
  - `QueuedContext` 新增 `runContext?: RunContext`
  - `QueueProcessedContext` 新增 `runContext?: RunContext`
  - `CollectSourcesContext` 新增 `runContext?: RunContext`
  - `HandleMultiInputForConnectionParams` 新增 `runContext?: RunContext`
  - `ExecutionServiceMethods` 的 `generateSummaryWithFallback` 新增 optional `runContext` 參數
  - `ExecutionServiceMethods` 的 `triggerWorkflowWithSummary` 已透過 params 變更覆蓋
  - `QueueServiceMethods.enqueue` item 新增 `runContext?: RunContext`
  - `AutoTriggerMethods.processAutoTriggerConnection` 新增 optional `runContext` 參數
  - `AutoTriggerMethods.getLastAssistantMessage` 新增 optional `runContext` 參數（有 RunContext 時從 run_messages 取得）
  - `AiDecideMethods.processAiDecideConnections` 新增 optional `runContext` 參數

- [ ] 10. 修改 `handlers/chatHandlers.ts` - 入口：檢測 multi-instance 並建立 Run
  - 修改 `handleChatSend` 函式：
    - 在 `validatePodChatReady` 之後，檢查 `pod.multiInstance` 是否為 true
    - 若 `pod.multiInstance === true`：
      - 呼叫 `runExecutionService.createRun(canvasId, podId, message)` 建立 Run，取得 RunContext
      - 呼叫 `runExecutionService.startPodInstance(runContext, podId)` 標記 source pod instance 為 running
      - 使用 `injectRunUserMessage(runContext, podId, message)` 取代 `injectUserMessage()`（寫入 run_messages）
      - 呼叫 `executeStreamingChat()` 時傳入 `runContext`
      - onComplete callback 傳入 `runContext` 版本的 `onRunChatComplete`
    - 若 `pod.multiInstance === false`：保持原有邏輯不變
  - **multi-instance pod 不檢查 isPodBusy**：因為 Run 之間真正並行，pod 全域狀態不受影響

- [ ] 11. 修改 `utils/chatCallbacks.ts` - 新增 Run 版本的 callback
  - 新增 `onRunChatComplete(runContext: RunContext, podId: string)` 函式：
    - 呼叫 `runExecutionService.completePodInstance(runContext, podId)`
    - 呼叫 `workflowExecutionService.checkAndTriggerWorkflows(runContext.canvasId, podId, runContext)` 觸發下游

- [ ] 12. 建立 `utils/runChatHelpers.ts` - Run 專用的訊息注入
  - 實作 `injectRunUserMessage(runContext, podId, content)` 函式：
    - 呼叫 `runStore.addRunMessage(runContext.runId, podId, 'user', displayContent)`
    - 發送 `RUN_MESSAGE` WebSocket 事件（role=user, isPartial=false）
    - **不呼叫 podStore.setStatus**（pod 全域狀態不變）

- [ ] 13. 修改 `services/claude/streamingChatExecutor.ts` - 支援 run-specific storage
  - `StreamingChatExecutorOptions` 新增 `runContext?: RunContext`
  - `StreamContext` 新增 `runContext?: RunContext`
  - 修改 `persistStreamingMessage` 邏輯：
    - 有 RunContext → 呼叫 `runStore.upsertRunMessage(runContext.runId, podId, message)`
    - 無 RunContext → 呼叫 `messageStore.upsertMessage(canvasId, podId, message)`（原本邏輯）
  - 修改 WebSocket 事件發送邏輯：
    - 有 RunContext → 發送 `RUN_MESSAGE`、`RUN_CHAT_TOOL_USE`、`RUN_CHAT_TOOL_RESULT`、`RUN_CHAT_COMPLETE`（payload 額外帶 `runId`）
    - 無 RunContext → 發送原本的 `POD_CLAUDE_CHAT_MESSAGE` 等事件
  - 修改 `podStore.setStatus` 呼叫：
    - 有 RunContext → 不呼叫 `podStore.setStatus`，改呼叫 `runExecutionService` 更新 pod instance 狀態
    - 無 RunContext → 保持原本邏輯
  - 修改 `claudeService.sendMessage` 呼叫：
    - 有 RunContext → 使用 run_pod_instances 的 `claude_session_id`，而非 pod 全域的 session id
    - 需要在 `claudeService.sendMessage` 之前，用 `runStore.getPodInstance()` 取得 instance 的 session id
    - 串流完成後，將新的 session id 寫回 `runStore.updatePodInstanceClaudeSessionId()`
  - 修改 `activeQueries` 的 key：
    - 有 RunContext → key 改為 `${runId}:${podId}`（避免與全域查詢衝突，允許同一 pod 多個 run 同時串流）
    - 無 RunContext → key 維持 `podId`
  - 修改 abort 邏輯：
    - 有 RunContext → 呼叫 `runExecutionService.unregisterActiveStream()`
    - 無 RunContext → 原本邏輯
  - 串流開始時：
    - 有 RunContext → 呼叫 `runExecutionService.registerActiveStream(runId, podId)`

- [ ] 14. 修改 `services/workflow/workflowExecutionService.ts` - 傳遞 RunContext
  - `checkAndTriggerWorkflows` 新增 optional `runContext?: RunContext` 參數，傳遞給三種 trigger
  - `triggerAutoConnections`、`triggerAiDecideConnections`、`triggerDirectConnections` 透傳 `runContext`
  - `triggerWorkflowWithSummary` 從 params 中取得 `runContext`，若有：
    - 不呼叫 `podStore.setStatus(canvasId, targetPodId, 'chatting')`
    - 改呼叫 `runExecutionService.startPodInstance(runContext, targetPodId)`
  - `generateSummaryWithFallback` 新增 optional `runContext`，若有：
    - 不呼叫 `podStore.setStatus(canvasId, sourcePodId, 'summarizing')`
    - 改呼叫 `runExecutionService.summarizingPodInstance(runContext, sourcePodId)`
    - 完成後不呼叫 `podStore.setStatus(canvasId, sourcePodId, 'idle')`
    - 改呼叫 `runExecutionService.completePodInstance()`（摘要完成 = source pod 在此 run 已完成）
    - `getLastAssistantMessage` 需要從 `runStore.getRunMessages()` 取得
  - `executeClaudeQuery` 中的 `injectUserMessage` 替換：
    - 有 RunContext → 使用 `injectRunUserMessage()`
    - 無 RunContext → 使用 `injectUserMessage()`
  - `executeClaudeQuery` 中的 `executeStreamingChat` 呼叫傳入 `runContext`
  - `onWorkflowChatComplete` 中的 `checkAndTriggerWorkflows` 透傳 `runContext`
  - `onWorkflowChatComplete` 中的 `scheduleNextInQueue`：
    - 有 RunContext → **不呼叫**（multi-instance 不使用 queue）
  - `onWorkflowChatError` 中：
    - 有 RunContext → 呼叫 `runExecutionService.errorPodInstance()` 取代 `podStore.setStatus(idle)`
    - 有 RunContext → **不呼叫 scheduleNextInQueue**
  - `setConnectionsToActive`：
    - 有 RunContext → **不更新 connection 全域狀態**（connection 是模板，不應改變）

- [ ] 15. 修改 `services/workflow/workflowPipeline.ts` - 傳遞 RunContext
  - `execute` 方法從 `PipelineContext` 取得 `runContext`，透傳到各步驟
  - `generateSummaryWithFallback` 呼叫時透傳 `runContext`
  - 忙碌檢查邏輯：
    - 有 RunContext → **跳過 targetPod.status 檢查**，直接執行（不 enqueue），因為 multi-instance 真正並行
    - 無 RunContext → 維持原本的忙碌檢查與 enqueue 邏輯

- [ ] 16. 修改 `services/workflow/workflowAutoTriggerService.ts` - 傳遞 RunContext
  - `processAutoTriggerConnection` 新增 optional `runContext` 參數
  - 建立 `PipelineContext` 時帶入 `runContext`
  - `getLastAssistantMessage` 新增 optional `runContext`：
    - 有 RunContext → 從 `runStore.getRunMessages(runContext.runId, sourcePodId)` 取得最後 assistant 訊息
    - 無 RunContext → 原本邏輯

- [ ] 17. 修改 `services/workflow/workflowAiDecideTriggerService.ts` - 傳遞 RunContext
  - `processAiDecideConnections` 新增 optional `runContext` 參數
  - `triggerApprovedPipeline` 建立 PipelineContext 時帶入 `runContext`
  - connection 狀態更新（updateDecideStatus, updateConnectionStatus）：
    - 有 RunContext → **不更新**（connection 是模板）
    - 無 RunContext → 原本邏輯

- [ ] 18. 修改 `services/workflow/workflowDirectTriggerService.ts` - 傳遞 RunContext
  - `collectSources` 取得 `runContext` 後透傳
  - pendingResolvers / directTriggerStore 的 key：
    - 有 RunContext → 使用 `${runId}:${targetPodId}` 作為 key（per-run 隔離）
    - 無 RunContext → 原本使用 `targetPodId`
  - connection 狀態更新：
    - 有 RunContext → **不更新**
    - 無 RunContext → 原本邏輯

- [ ] 19. 修改 `services/workflow/workflowMultiInputService.ts` - 傳遞 RunContext
  - `handleMultiInputForConnection` 從 params 取得 `runContext`
  - pendingTargetStore 的 key：
    - 有 RunContext → 使用 `${runId}:${targetPodId}` 作為 key（per-run 隔離）
    - 無 RunContext → 原本使用 `targetPodId`
  - 忙碌檢查 / enqueue 邏輯：
    - 有 RunContext → 跳過忙碌檢查，直接觸發（真正並行）
    - 無 RunContext → 原本邏輯

- [ ] 20. 修改 `services/workflow/workflowQueueService.ts` - RunContext 模式跳過 queue
  - `enqueue` 與 `processNextInQueue`：
    - 在 multi-instance 模式下不會被呼叫到（由上層邏輯決定），但做防禦性檢查
    - 若收到帶 RunContext 的呼叫，直接 log warning 並忽略

### 階段五：WebSocket Handler

- [ ] 21. 建立 `handlers/runHandlers.ts` - Run 相關 WebSocket 事件處理
  - `handleRunDelete`：
    - 驗證 runId 存在
    - 呼叫 `runExecutionService.deleteRun(runId)`
  - `handleRunLoadHistory`：
    - 從 `runStore.getRunsByCanvasId(canvasId)` 取得歷史
    - 對每個 run 附帶 `runStore.getPodInstancesByRunId(runId)` 的 instance 列表
    - 發送 `RUN_HISTORY_LOADED` 事件
  - `handleRunLoadPodMessages`：
    - 從 `runStore.getRunMessages(runId, podId)` 取得訊息
    - 發送 `RUN_POD_MESSAGES_LOADED` 事件

- [ ] 22. 建立 `handlers/groups/runHandlerGroup.ts` - 註冊 handler group
  - 使用 `createHandlerGroup` 建立 `runHandlerGroup`
  - 包含 `RUN_DELETE`、`RUN_LOAD_HISTORY`、`RUN_LOAD_POD_MESSAGES` 三個事件

- [ ] 23. 在 `handlers/index.ts` 註冊 `runHandlerGroup`
  - import `runHandlerGroup`
  - 呼叫 `registry.registerGroup(runHandlerGroup)`

### 階段六：Workflow 服務初始化

- [ ] 24. 修改 `services/workflow/index.ts` - 匯出新服務
  - 匯出 `runExecutionService`
  - 不需要特別的 init，因為 `runExecutionService` 不依賴 lazy init pattern（它直接使用 `runStore` 和其他已初始化的服務）

### 階段七：ClaudeService 適配

- [ ] 25. 修改 `services/claude/claudeService.ts` - 支援 run-specific session
  - `sendMessage` 方法簽名新增 optional `options?: { sessionId?: string, runKey?: string }`：
    - `sessionId`：外部傳入的 session id（來自 run_pod_instances），覆蓋 pod 全域的 session id
    - `runKey`：作為 activeQueries 的 key，預設為 podId
  - `sendMessageInternal` 中：
    - 若 `options.sessionId` 存在，使用它取代 `pod.claudeSessionId`
    - 若 `options.runKey` 存在，使用它作為 `activeQueries` 的 key
  - `finalizeSession` 中：
    - 若 `options.runKey` 存在，不寫入 `podStore.setClaudeSessionId`（由呼叫方自行寫入 run_pod_instances）
    - 回傳 session id 供呼叫方使用
  - `abortQuery` 方法支援 `key` 參數（預設為 podId）

### 階段八：測試

- [ ] 26. 建立 `tests/unit/runStore.test.ts`
  - 使用 `initTestDb()` 建立記憶體 DB
  - 測試全部 CRUD 操作（如測試案例清單所述）

- [ ] 27. 建立 `tests/unit/runExecutionService.test.ts`
  - mock 所有外部依賴（runStore, claudeService, socketService）
  - 測試 run 建立、pod instance 狀態轉換、run 狀態判定
  - 測試 enforceRunLimit 清理邏輯
  - 測試 deleteRun 中斷串流邏輯

- [ ] 28. 建立 `tests/unit/runContextPropagation.test.ts`
  - 使用 spy 驗證 RunContext 在整條鏈路中正確傳遞
  - 驗證有 RunContext 時不修改 pod 全域狀態
  - 驗證有 RunContext 時 message 寫入 run_messages

- [ ] 29. 建立 `tests/unit/runHandlers.test.ts`
  - mock WebSocket 事件
  - 測試三個 handler 的正確回應

- [ ] 30. 更新 `tests/mocks/workflowSpySetup.ts`
  - 新增 `setupRunStoreSpy()` 函式
  - 新增 `setupRunExecutionServiceSpy()` 函式
  - 在 `setupAllSpies` 中加入上述兩個 spy

- [ ] 31. 更新 `tests/mocks/workflowTestFactories.ts`
  - 新增 `createMockRunContext()` factory
  - 新增 `createMockWorkflowRun()` factory
  - 新增 `createMockRunPodInstance()` factory

---

## 執行順序

```
階段一（1-4）→ 階段二（5-7）→ 階段三（8）→ 階段七（25）→ 階段四（9-20）→ 階段五（21-23）→ 階段六（24）→ 階段八（26-31）
```

先建好資料層和型別，再建 run 引擎和 claude 適配，最後修改現有邏輯串接 RunContext，handler 和測試收尾。

---

## Edge Case 注意事項

1. **同一 Pod 多個 Run 並行串流**：`claudeService.activeQueries` 的 key 必須區分 runId，否則第二個 run 會覆蓋第一個的 entry，導致 abort 失效
2. **Run 中 Pod 沒有 Claude Session**：每個 run_pod_instance 有獨立的 `claude_session_id`，首次執行時為 null，SDK 會建立新 session。template pod 的全域 session 不可使用（避免 session 衝突）
3. **Direct Trigger 的 10 秒合併窗口**：在 Run 模式下，pendingResolvers 和 directTriggerStore 的 key 需要加上 runId 前綴，否則不同 Run 的 direct trigger 會互相干擾
4. **Multi-Input 合併**：pendingTargetStore 的 key 同樣需要 runId 前綴隔離
5. **Run 刪除時機**：若 run 正在執行中被刪除，需要先 abort 所有串流再刪 DB，順序不可顛倒
6. **Connection 狀態不可修改**：Run 模式下 connection 是模板，所有 `connectionStore.updateConnectionStatus()` 和 `connectionStore.updateDecideStatus()` 都要跳過
7. **Pod 全域狀態不可修改**：Run 模式下所有 `podStore.setStatus()` 都要跳過，改用 `runExecutionService` 的 pod instance 狀態方法
8. **Summary 的 messageStore 來源**：`summaryService.generateSummaryForTarget` 內部使用 `messageStore.getMessages(sourcePodId)` 取得歷史訊息。在 Run 模式下，source pod 的訊息在 run_messages 中，需要讓 summary 服務讀取 run_messages。做法：在 `workflowExecutionService.generateSummaryWithFallback` 中，若有 RunContext，直接從 `runStore.getRunMessages()` 組裝對話歷史，不經過 `summaryService`（或將 messages 作為參數傳入 summaryService）
9. **Schedule 觸發**：排程觸發的 pod 若開啟 multi-instance，也應走 Run 路徑。但這超出本次範圍，可後續處理
10. **Integration Binding**：帶有 integration binding 的 pod 在 multi-instance 模式下的行為需要考慮。目前 `validatePodChatReady` 會拒絕有 binding 的 pod 手動發送訊息，此邏輯對 multi-instance 同樣適用
