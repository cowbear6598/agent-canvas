# 前端維護性審計

## Store 與資料流熱點

### `frontend/src/stores/connectionStore.ts`

#### 責任清單

- 維護 connection 狀態、目前選取連線與拖拉中的連線。
- 提供依 Pod 查詢連線、判斷 Pod 是否有上下游、判斷 Pod 在 workflow 中的角色。
- 判斷 workflow 是否正在執行，並維護 workflow 事件造成的 connection status。
- 建立、刪除、更新 connection，包含 trigger mode、summary model/provider、branch label/description/model/provider。
- 驗證新連線、branch label、branch description 與同 source branch sibling 同步規則。
- 從 WebSocket API 載入 connection，並處理 connection created/updated/deleted 事件同步。
- 根據 Pod provider 與 provider capability 補齊 summary/branch 預設模型。
- 在 action 失敗或驗證失敗時映射 toast/error 訊息。

#### 依賴清單

- Store：`podStore`、`selectionStore`、`providerCapabilityStore`。
- WebSocket：`createWebSocketRequest`、`websocketClient`、`WebSocketRequestEvents`、`WebSocketResponseEvents`、`useCanvasWebSocketAction`。
- UI/error：`useToast`、`DEFAULT_TOAST_DURATION_MS`、`t`。
- Domain/type：`Connection`、`ConnectionStatus`、`DecideStatus`、`TriggerMode`、`WorkflowRole`、`PodProvider`、`DEFAULT_SUMMARY_MODEL`、branch 常數。
- Helper：`createWorkflowEventHandlers`、`castHandler`、`normalizeConnection`、`shouldUpdateConnection`、`runBFS`、`removeById`、`normalizePodProvider`、`getActiveCanvasIdOrWarn`、`logger`。

#### 外部事件入口

- 主動請求：`CONNECTION_LIST`、`CONNECTION_CREATE`、`CONNECTION_DELETE`、`CONNECTION_UPDATE`。
- WebSocket listener registration：`setupWorkflowListeners()` / `cleanupWorkflowListeners()` 對 workflow 事件註冊與解除。
- Workflow 事件：`WORKFLOW_AUTO_TRIGGERED`、`WORKFLOW_COMPLETE`、`WORKFLOW_BRANCH_TRIGGERED`、`WORKFLOW_DIRECT_TRIGGERED`、`WORKFLOW_QUEUED`、`WORKFLOW_QUEUE_PROCESSED`。
- Connection 同步入口：`addConnectionFromEvent()`、`updateConnectionFromEvent()`、`removeConnectionFromEvent()`。
- Canvas/Pod 生命週期入口：`resetForCanvasSwitch()`、`deleteConnectionsByPodId()`、`reconcileSummaryModelsForPod()`。

#### 可拆分模組

- `connectionGraphSelectors.ts`：集中依 Pod 查詢、上下游判斷、workflow role 與 workflow running BFS 查詢。
- `connectionPayloadFactory.ts`：集中 create/update payload 組裝與 provider/model 預設值解析。
- `connectionNormalizer.ts`：集中後端 connection payload normalize 與 event payload merge。
- `connectionBranchRules.ts`：集中 branch label/description 驗證、branch 預設值、branch sibling 同步決策。
- `connectionWorkflowListeners.ts`：集中 workflow event map、listener registration 與 workflow event handler wiring。
- `connectionErrorMapper.ts`：集中 connection action 的 toast/error category、action 與 i18n key 對應。

#### 責任標記與目標模組

| 責任 | 目前熱點 | 目標模組名稱 |
| --- | --- | --- |
| graph 查詢 | `getConnectionsByPodId`、`getOutgoingConnections`、`getConnectionsByTargetPodId`、`isSourcePod`、`hasUpstreamConnections`、`getBranchConnectionsBySourcePodId`、`isPartOfRunningWorkflow`、`isWorkflowRunning` 與 adjacency map 建立分散在 store 內。 | `connectionGraphSelectors.ts` |
| workflow role 判斷 | `getPodWorkflowRole` 直接掃描 `connections` 判斷 head/middle/tail/independent，與 graph 查詢重複依賴同一批拓樸規則。 | `connectionWorkflowRole.ts` |
| payload normalize | `loadConnectionsFromBackend()`、`createConnection()`、`executeConnectionUpdate()`、`addConnectionFromEvent()`、`resolveSummaryProviderFromEvent()`、`updateConnectionFromEvent()` 同時處理後端 payload、預設值、provider normalize 與 state merge。 | `connectionNormalizer.ts` |
| WebSocket listener registration | `workflowEventMap`、`getWorkflowEventMap()`、`setupWorkflowListeners()`、`cleanupWorkflowListeners()` 留在 store 內，使 listener lifecycle 與 state action 混在一起。 | `connectionWorkflowListeners.ts` |
| toast/error mapping | `validateNewConnection()`、`deleteConnection()`、branch validation、`updateConnectionBranchSettings()` 與 `executeConnectionUpdate()` 各自組裝 toast category、i18n key、destructive variant 與 suppress 規則。 | `connectionErrorMapper.ts` |

### `frontend/src/stores/note/createNoteStore.ts`

#### 責任清單

- 以 factory 建立不同 note 類資源的 Pinia store。
- 維護 available items、notes、groups、拖拉狀態、動畫狀態、loading/error。
- 提供 note/item/group 查詢 getter，包含 item id index、pod 綁定查詢、group 排序與刪除條件。
- 透過 WebSocket 載入 item/note、建立 note、刪除 note、刪除 item。
- 組合 note position、note binding、event sync、group action 與資源專屬 custom actions。
- 將後端 event 轉為 state mutation，包含 add/update/remove note、item、group。
- 依 config 組裝動態 payload、event name 與 toast category。

#### 依賴清單

- WebSocket：`createWebSocketRequest`、`useSendCanvasAction`、`useWebSocketErrorHandler`。
- UI/error：`useDeleteItem`、`useToast`、`ToastCategory`、`t`。
- Canvas guard：`requireActiveCanvas`、`getActiveCanvasIdOrWarn`。
- Note helper：`createNoteBindingActions`、`createNotePositionActions`。
- Resource config/type：`BaseNote`、`Group`、`BasePayload`、`BaseResponse`、`UnbindBehavior`。
- Utility：`removeById`。

#### 外部事件入口

- Factory config 入口：`NoteStoreConfig.events`、`bindEvents`、`unbindEvents`、`deleteItemEvents`、`groupEvents`、`customActions`。
- 主動請求：`fetchWithActiveCanvasId()`、`loadItems()`、`loadNotesFromBackend()`、`createNote()`、`deleteNote()`、`deleteItem()`。
- Note/item event sync：`addNoteFromEvent()`、`updateNoteFromEvent()`、`removeNoteFromEvent()`、`addItemFromEvent()`、`updateItemFromEvent()`、`removeItemFromEvent()`。
- Group event sync：`addGroupFromEvent()`、`removeGroupFromEvent()`、`updateItemGroupId()`、`toggleGroupExpand()`。
- Canvas 生命週期入口：`resetForCanvasSwitch()`。

#### 可拆分模組

- `noteStoreState.ts`：集中 state shape、初始值與可保留的簡單 mutation。
- `noteStoreSelectors.ts`：集中 getters 與 Map/index 建立。
- `notePayloadFactory.ts`：集中動態 key payload、create note payload 與 active canvas payload 組裝。
- `noteEventReducers.ts`：集中 note/item/group event 到 state mutation 的轉換規則。
- `noteFlowActions.ts`：集中 load/create/delete 的流程決策與錯誤處理。

#### Pinia 保留與 domain helper 拆分

| 類型 | 範圍 | 目標模組名稱 |
| --- | --- | --- |
| 可保留在 Pinia 的 state mutation | `setDraggedNote()`、`setNoteAnimating()`、`setIsDraggingNote()`、`setIsOverTrash()`、`resetForCanvasSwitch()` 只修改本 store 狀態，保留在 Pinia action 內即可。 | `createNoteStore.ts` |
| 可保留在 Pinia 的 state mutation | `addNoteFromEvent()`、`updateNoteFromEvent()`、`removeNoteFromEvent()`、`addItemFromEvent()`、`updateItemFromEvent()`、`removeItemFromEvent()`、`addGroupFromEvent()`、`removeGroupFromEvent()`、`updateItemGroupId()`、`toggleGroupExpand()` 若維持單純 array/set/map mutation，可留在 store 或收斂成 reducer 後由 store 呼叫。 | `noteEventReducers.ts` |
| 應移到 domain helper 的資料轉換 | `buildNoteStoreGetters()` 內的 `itemById`、`notesByPodId`、`getSortedItemsWithGroups` 以及 `buildDeletePayload()` 的動態 key payload 組裝，屬於可測試的資料轉換。 | `noteStoreSelectors.ts`、`notePayloadFactory.ts` |
| 應移到 domain helper 的流程決策 | `fetchWithActiveCanvasId()`、`loadItems()`、`loadNotesFromBackend()`、`createNote()`、`deleteItem()` 混合 active canvas guard、WebSocket event config、error state、toast 與 state 更新，應拆成流程 helper 並讓 Pinia 只負責提交結果。 | `noteFlowActions.ts` |

### `frontend/src/stores/run/runStore.ts`

#### 責任清單

- 維護 workflow run history、history panel、expanded run、active run chat modal。
- 維護 run chat messages、分頁資訊、loading 狀態、request token 與串流快取。
- 載入 run history、刪除 run、開關 history panel、展開/收合 run。
- 載入 run pod messages、載入更舊訊息、合併歷史訊息與 live 訊息。
- 處理 run chat 串流文字、tool use、tool result、complete。
- 將後端 persisted message 轉為前端 `Message`，並維護 sub message/tool use 完成狀態。
- 在 canvas 切換與 run 移除時清理 transcript、cache 與 active modal。

#### 依賴清單

- WebSocket：`createWebSocketRequest`、`WebSocketRequestEvents`、`WebSocketResponseEvents`。
- Canvas guard：`getActiveCanvasIdOrWarn`。
- UI/error：`useToast`、`t`、`logger`。
- Domain/type：`WorkflowRun`、`RunStatus`、`RunPodStatus`、`PathwayState`、`RunMessagesPageInfo`、`Message`、`MessageRole`、`SystemMessageMetadata`、`ToolUseInfo`。
- Chat helper：`mergeToolResultIntoMessage`、`mergeToolUseIntoMessage`、`upsertMessage`、`finalizeSubMessages`、`finalizeToolUse`、`updateMainMessageState`。
- Run helper：`createAssistantMessageWithTool`、`toMessage`。
- Constant：`MAX_RUNS_PER_CANVAS`。

#### 外部事件入口

- 主動請求：`RUN_LOAD_HISTORY`、`RUN_DELETE`、`RUN_LOAD_POD_MESSAGES`。
- Run lifecycle 入口：`addRun()`、`updateRunStatus()`、`updatePodInstanceStatus()`、`removeRun()`、`resetOnCanvasSwitch()`。
- Run chat 入口：`openRunChatModal()`、`closeRunChatModal()`、`loadOlderActiveRunChatMessages()`。
- Live stream 入口：`appendRunChatMessage()`、`handleRunChatToolUse()`、`handleRunChatToolResult()`、`handleRunChatComplete()`。

#### 可拆分模組

- `runStoreState.ts`：集中 state shape、初始值與簡單 modal/panel mutation。
- `runHistoryActions.ts`：集中 history load/delete 與 run lifecycle action。
- `runChatRepository.ts`：集中 run chat message 巢狀 Map 存取、transcript cleanup 與 cache rebuild。
- `runMessageMerge.ts`：集中 loaded/live message merge、persisted message 轉換與 older message prepend。
- `runStreamReducers.ts`：集中 streaming text/tool use/tool result/complete 的狀態轉換。
- `runFlowGuards.ts`：集中 active target、request token、pagination guard 等流程決策。

#### Pinia 保留與 domain helper 拆分

| 類型 | 範圍 | 目標模組名稱 |
| --- | --- | --- |
| 可保留在 Pinia 的 state mutation | `toggleHistoryPanel()`、`openHistoryPanel()`、`toggleRunExpanded()`、`updateRunStatus()`、`updatePodInstanceStatus()`、`resetOnCanvasSwitch()` 是明確的 store state mutation，可保留在 Pinia。 | `runStore.ts` |
| 可保留在 Pinia 的 state mutation | `setActiveRunChatMessages()`、`clearMessageCaches()`、`cleanupRunTranscript()`、`resetRunChatState()`、`rebuildActiveMessageCaches()` 若維持純 Map/Set/cache 寫入，可留在 Pinia 或改由 repository helper 回傳 next state 後套用。 | `runChatRepository.ts` |
| 應移到 domain helper 的資料轉換 | `mergeLoadedMessages()`、`toMessage()`、`createAssistantMessageWithTool()`、tool use/result merge、sub message finalize 與 older/live message 合併屬於 domain 轉換，應集中在可單元測試 helper。 | `runMessageMerge.ts`、`runStreamReducers.ts` |
| 應移到 domain helper 的流程決策 | `openRunChatModal()`、`loadOlderActiveRunChatMessages()`、`appendRunChatMessage()`、`handleRunChatToolUse()`、`handleRunChatToolResult()`、`handleRunChatComplete()` 混合 request token、active target guard、pagination guard、stream ordering 與 cache 更新，應由 helper 封裝決策，Pinia 只負責呼叫與落 state。 | `runFlowGuards.ts`、`runStreamReducers.ts` |

## 大型元件邊界熱點

### `frontend/src/components/pod/CanvasPod.vue`

#### 責任清單

- 渲染 Pod 外框、provider 樣式、slot notch、header、action、anchor、upload overlay、schedule modal 與多個 popover。
- 維護元件內部 UI state，包含 rename、delete dialog、popover anchor rect、拖拉狀態、上傳狀態與 schedule modal 狀態。
- 組合 pod、viewport、selection、repository、connection、canvas、run、upload、provider capability 等多個 store。
- 判斷 Pod 可互動狀態，包含未知 provider、chain 下游 pod、source pod、上游連線、上傳中、批次拖拉與 slot 命中。
- 處理滑鼠按下、ctrl/cmd 選取、批次拖拉、單 Pod 拖拉、雙擊開啟對話、右鍵選單、檔案 drop、anchor drag、slot 綁定與刪除。
- 透過 WebSocket 更新 pod model 與 thinking level，並在成功後同步 store state。
- 產生手繪 divider path、provider class、schedule tooltip、goal count 等 template 顯示資料。

#### 邊界盤點

| 邊界 | 目前熱點 | 拆分方向 |
| --- | --- | --- |
| template state | `isEditing`、`showDeleteDialog`、popover state、upload computed、provider fallback、chain/source 判斷與 schedule state 分散在同一個 `<script setup>`，template 需要理解多個 domain 才能判斷顯示。 | 建立 `useCanvasPodViewState.ts`，只輸出 template 需要的 `isActive`、`isSelected`、`podProviderClasses`、`showScheduleButton`、`isFileDropDisabled`、`isPodUploading`、`podUploadStatus`、`slotCounts`。 |
| 使用者操作 | `handleMouseDown()`、`handleDblClick()`、`handleDrop()`、`handleContextMenu()` 同時處理 DOM guard、selection、drag、toast、run panel 與 store mutation。 | 建立 `useCanvasPodInteractions.ts`，集中 mouse/drop/contextmenu 的流程決策；元件只傳入 `podId`、event 與 emit。 |
| 資料正規化 | `dividerPath` 的 seeded random、provider class、slot active count、model/thinking response 解讀與 schedule prop fallback 都在元件內。 | 將純轉換移到 `podViewModel.ts` 或 `podDisplayRules.ts`，用單元測試覆蓋 provider class、slot count、divider path 穩定性與 response model extraction。 |
| 副作用 | `sendCanvasAction()`、`podStore.updatePodProviderConfigModel()`、`podStore.updatePodThinkingLevel()`、`runStore.openHistoryPanel()`、toast 與 popover close watch 留在元件內。 | 建立 `usePodProviderActions.ts` 管理 model/thinking WebSocket 流程；保留 popover close watch 在 UI composable，避免 domain action 依賴 DOM state。 |

#### 優化順序

1. 先抽 `podDisplayRules.ts`，因為 `dividerPath`、provider class、slot count 是純函式且低風險。
2. 再抽 `usePodProviderActions.ts`，把 WebSocket 成功後的 store 更新與錯誤 fallback 從元件移出。
3. 最後抽 `useCanvasPodInteractions.ts`，因為它牽涉 selection、drag、drop、toast 與 run panel，需搭配互動測試避免行為回歸。

### `frontend/src/components/settings/OpencodeSettingsPanel.vue`

#### 責任清單

- 顯示 OpenCode provider 清單、connected provider、alias 對應表、搜尋、空狀態、錯誤狀態與刪除確認 dialog。
- 維護 provider list、connected ids、loading/error、搜尋字串、展開狀態、draft row、editing alias、刪除確認、saving/refreshing/restarting 狀態。
- 從 `opencodeApi` 載入 provider 與 connected 資訊，並重啟 OpenCode server。
- 透過 `opencodeAliasStore` 新增、編輯、刪除、刷新 preset、拖曳重排 alias。
- 將 store aliases 同步為 VueDraggable 可寫本地陣列，並依 provider/model 過濾可選模型。
- 驗證 alias 唯一性並映射 toast 錯誤訊息。

#### 邊界盤點

| 邊界 | 目前熱點 | 拆分方向 |
| --- | --- | --- |
| template state | `providers`、`connected`、`loadState`、`expandedProviders`、`draftRows`、`aliasListsByProvider`、`savingDraftProviderIds`、`refreshingAliasIds` 與 `restarting` 都由同一元件管理，template 同時處理 provider list 與 alias CRUD 狀態。 | 建立 `useOpencodeProviderPanelState.ts` 管理 provider 載入、搜尋、排序與 restart；建立 `useOpencodeAliasPanelState.ts` 管理 alias draft/edit/delete/reorder 狀態。 |
| 使用者操作 | add/cancel/save/edit/delete/refresh/reorder/restart handler 都在元件內，且每個 handler 同時碰 UI state、store action、API 與 toast。 | 將 alias CRUD handler 收斂到 `useOpencodeAliasActions.ts`，將 restart/load 收斂到 `useOpencodeProviderActions.ts`。 |
| 資料正規化 | `connectedProviders`、`filteredProviders`、`sortedFilteredProviders`、`draftSelectableModelsByProvider`、`editableSelectableModelsByAliasId`、`firstDraftSelectableModelIDByProvider` 都是可測試的清單轉換。 | 建立 `opencodeProviderSelectors.ts` 與 `opencodeAliasSelectors.ts`，輸入 providers、connected、aliases 後回傳 UI view model。 |
| 副作用 | `listOpencodeProviders()`、`restartOpencodeServer()`、alias store CRUD、toast、`watch(opencodeAliasStore.aliases)` 同步 draggable local list 都集中在同一檔。 | 把 API/store 呼叫留在 action composable；draggable local list 同步獨立成 `useAliasDraggableList.ts`，並明確定義失敗時由 store watch 還原。 |

#### 優化順序

1. 先抽 selectors，讓 provider/alias 過濾、排序、可選模型與 alias count 有純函式測試。
2. 再抽 alias action composable，將唯一性驗證、toast 與 pending state 集中。
3. 最後拆 provider loading/restart，讓 `OpencodeSettingsPanel.vue` 降為組合兩個區塊的容器元件。

### `frontend/src/components/canvas/ScheduleModal.vue`

#### 責任清單

- 顯示排程建立/編輯 modal，包含 frequency radio、秒/分鐘/小時/日期選擇、星期選擇、錯誤訊息與 footer action。
- 維護 schedule form state，包含 frequency、second、intervalMinute、intervalHour、hour、minute、weekdays 與 weekdaysError。
- 依 `existingSchedule` 初始化表單，依 modal open 狀態 reset 或 hydrate state。
- 驗證每週排程至少選擇一天。
- 將表單轉為 `Schedule` payload 並保留 `lastTriggeredAt`。
- 對外 emit confirm、delete 與 `update:open`，並在 confirm/disable/close 後 reset state。

#### 邊界盤點

| 邊界 | 目前熱點 | 拆分方向 |
| --- | --- | --- |
| template state | form 欄位、option range、weekday label、edit mode 與 error state 全留在 modal 元件，template 條件分支多且重複 day/week time selector。 | 建立 `useScheduleForm.ts`，輸出欄位 refs、option lists、`isEditMode`、`weekdayOptions`、`weekdaysError` 與 hydrate/reset 方法。 |
| 使用者操作 | `handleClose()`、`handleConfirm()`、`handleDisable()` 同時負責 validation、payload 建立、emit 與 reset。 | 建立 `scheduleModalActions.ts` 或在 `useScheduleForm.ts` 回傳 `submit()` / `disable()` 結果，元件只負責 emit。 |
| 資料正規化 | `createRange()`、`formatMinute()`、existing schedule hydrate、form to `Schedule` payload 都是純資料規則。 | 建立 `scheduleFormMapper.ts`，集中 `createDefaultScheduleForm()`、`hydrateScheduleForm()`、`toSchedulePayload()`、`formatMinute()`。 |
| 副作用 | `watch(props.open)`、emit close/confirm/delete 與 reset tightly coupled，未來新增頻率或 validation 容易改到 modal template。 | 將 watch 包進 composable，外部只傳 `open` 與 `existingSchedule`；副作用出口限定為回傳 payload 或 action type。 |

#### 優化順序

1. 先抽 `scheduleFormMapper.ts`，覆蓋 default、hydrate、weekly validation 與 payload 保留 `lastTriggeredAt`。
2. 再抽 `useScheduleForm.ts`，讓 modal template 只綁定欄位與 action。
3. 最後拆重複 time selector 成小型 presentational component，避免新增 frequency 時複製整段 Select。

## Composable 命名與路徑邊界

### 目前分佈

| 路徑 | 目前角色 | 命名重疊 |
| --- | --- | --- |
| `frontend/src/composables` | 混放全域 UI helper、canvas 幾何 helper、WebSocket action wrapper、event listener aggregator 與通用 drag/delete helper。 | `useConnectionPath`、`useAnchorDetection` 實際是 canvas geometry；`useSendCanvasAction`、`useCanvasWebSocketAction`、`useWebSocketErrorHandler`、`useUnifiedEventListeners` 實際是 WebSocket/event infrastructure。 |
| `frontend/src/composables/canvas` | 混放 canvas 互動、canvas context、context menu、copy/paste、progress tracker、note drag event helper 與 resource delete modal state。 | `useNoteEventHandlers` 容易與 `eventHandlers/noteEventHandlers.ts` 混淆；`useContextMenu` 是 UI primitive，但目前被 canvas 專用目錄持有；progress 類 composable 同時處理 WebSocket listener、toast、chat store side effect。 |
| `frontend/src/composables/eventHandlers` | 將 WebSocket response event 映射為 store mutation 或 standalone listener。 | `runEventHandlers.ts` 同時包含 canvas-filtered listener 與 run chat standalone listener；`opencodeEventHandlers.ts`、`backupEventHandlers.ts` 是 standalone 全域事件，但仍與 canvas-scoped handler 放在同層。 |
| `frontend/src/composables/websocket` | 目前沒有實體目錄；測試路徑已有 `frontend/tests/business-logic/composables/websocket/*`，但原始碼仍散在根目錄。 | 測試分類與原始碼分類不一致，導致新增 WebSocket composable 時不知道該放根目錄或建立新目錄。 |

### 保留路徑

| 類型 | 保留路徑 | 判斷規則 |
| --- | --- | --- |
| 全域 UI composable | `frontend/src/composables` | 不依賴 canvas/pod/store domain，只處理 UI primitive 或瀏覽器互動，例如 `useToast`、`useEscapeClose`、`useMenuPosition`、`useModalForm`、`useDragHandler`。 |
| Canvas domain composable | `frontend/src/composables/canvas` | 需要 canvas 座標、viewport、selection、copy/paste、progress note 或 canvas context 的邏輯。 |
| Pod domain composable | `frontend/src/composables/pod` | 只服務 Pod slot、Pod drag、Pod schedule、Pod popover、Pod file drop、goal editor 等 Pod UI/domain 流程。 |
| Chat domain composable | `frontend/src/composables/chat` | 只服務 ChatInput/ChatModal 的訊息輸入、附件、語音與 selection 操作。 |
| WebSocket request/action composable | `frontend/src/composables/websocket` | 包裝 `createWebSocketRequest`、active canvas guard、錯誤 toast、request/response matching 或 listener lifecycle。 |
| WebSocket event reducer/handler | `frontend/src/composables/eventHandlers` | 只放 WebSocket response event 到 store mutation 的 adapter，不放元件互動 handler，也不放 request wrapper。 |

### 搬移規則

| 現況 | 目標 | 搬移規則 |
| --- | --- | --- |
| `useConnectionPath.ts`、`useAnchorDetection.ts` 在根目錄。 | `frontend/src/composables/canvas/useConnectionPath.ts`、`frontend/src/composables/canvas/useAnchorDetection.ts`。 | 兩者只處理 Pod anchor 與 bezier path 幾何，應歸 canvas；先由 `canvas/index.ts` re-export，再逐步更新 import，避免一次性大改。 |
| `useSendCanvasAction.ts`、`useCanvasWebSocketAction.ts`、`useWebSocketErrorHandler.ts`、`useUnifiedEventListeners.ts` 在根目錄。 | `frontend/src/composables/websocket/*`。 | 建立 `websocket/index.ts`，短期保留根目錄 shim 或 barrel re-export；新程式碼只能從 `@/composables/websocket` 或具名檔案匯入。 |
| `useUnifiedEventListeners.ts` 聚合 `eventHandlers` 並註冊 listener。 | `frontend/src/composables/websocket/useUnifiedEventListeners.ts`。 | listener lifecycle 屬 WebSocket infrastructure；`eventHandlers` 只保留 `getXEventListeners()` 與 standalone handler factory。 |
| `eventHandlers/runEventHandlers.ts` 同時有 canvas-filtered 與 standalone run chat handler。 | 保留檔案但拆出 `getRunEventListeners()` 與 `getRunStandaloneListeners()` 的責任說明，必要時新增 `runStandaloneEventHandlers.ts`。 | 以是否需要 `canvasId` 過濾作為拆分線；需要 `createUnifiedHandler` 的留在 `runEventHandlers.ts`，不需要 requestId/toast 機制的移到 standalone 檔。 |
| `useNoteEventHandlers.ts` 在 `canvas` 目錄且命名接近 `eventHandlers/noteEventHandlers.ts`。 | 改名為 `useCanvasNoteDragHandlers.ts` 或 `useNoteDragLifecycle.ts`。 | 元件互動 handler 必須帶上互動語意，避免與 WebSocket note event adapter 混淆。 |
| `useContextMenu.ts` 在 `canvas` 目錄。 | 若保持 canvas-only 使用則改名 `useCanvasContextMenuState.ts`；若要共用則搬到根目錄 `useContextMenu.ts`。 | 以使用者範圍決定：只被 canvas context menu 使用就保留 canvas；跨 settings/pod 使用才移到根目錄。 |
| progress 類 composable 同時在 `canvas` 內註冊 WebSocket listener。 | 保留 `canvas/useXProgress.ts`，共用 listener/timeout helper 仍放 `canvas/useProgressTracker.ts`。 | progress task 是 canvas UI state，暫不搬到 websocket；但 WebSocket event names 與 toast mapping 應由 options 注入並保持可測試。 |

### 新增檔案命名規則

- `useXxx` 只用於回傳 Vue reactive state、lifecycle 或 handler 的 composable；純資料轉換用 `xxxMapper.ts`、`xxxSelectors.ts`、`xxxRules.ts`。
- `eventHandlers/*EventHandlers.ts` 只描述 WebSocket response event adapter；元件 DOM 事件不得命名為 `eventHandlers`。
- `canvas/useXxx` 必須能回答「是否依賴 canvas 坐標、viewport、selection、connection path、copy/paste、progress note 或 canvas context」；不能回答就不放 canvas。
- `websocket/useXxx` 必須能回答「是否包裝 request/response、listener registration、requestId、active canvas guard 或 WebSocket error」；不能回答就不放 websocket。
- 新增 barrel export 時只在 domain index 暴露穩定 API；內部 helper 不從 `index.ts` export，避免跨 domain 依賴擴散。

### 搬移優先序

1. 先建立 `frontend/src/composables/websocket` 並搬移 WebSocket request/action/listener lifecycle，因為測試目錄已以 websocket 分類，且 F2 的 WebSocket 事件處理修改會先受益。
2. 再搬移 `useConnectionPath` 與 `useAnchorDetection` 到 canvas，讓 canvas 互動與幾何規則集中，降低修改連線顯示時的搜尋成本。
3. 接著處理 `useNoteEventHandlers` 命名，避免開發者把 note drag lifecycle 與後端 note event adapter 混用。
4. 最後評估 `useContextMenu` 是否跨 domain 共用；目前不急著搬，避免為了抽象增加全域 API。
