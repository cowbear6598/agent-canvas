## P1.A 大型元件與入口協調 review

### P1.A.t1 `frontend/src/App.vue` 入口協調職責

#### Finding A1: `App.vue` 同時承擔啟動流程、WebSocket lifecycle、security bootstrap、canvas 資料載入與 UI orchestration

- 嚴重度：High
- 位置：`frontend/src/App.vue:67`、`frontend/src/App.vue:129`、`frontend/src/App.vue:190`、`frontend/src/App.vue:277`、`frontend/src/App.vue:393`
- 問題原因：同一個 SFC 同時初始化多個 store/composable、載入 config/canvas/provider capability/opencode alias/run/canvas scoped data、註冊 unified listeners、處理 silent reconnect 後補送 `CANVAS_SWITCH`、處理 security bootstrap 與 workspace/canvas lock 判斷，最後還直接 orchestrate header/sidebar/history/chat/goal/run/security modal 的顯示。
- 維護風險：任何啟動順序、斷線重連、workspace lock、canvas 切換或 modal 新增需求都會回到同一檔案修改，容易讓 watcher 條件互相影響；例如 connection watcher 同時做首次 bootstrap、重連 resync、斷線 cleanup，讀者需要跨越多段狀態才能判斷初始化與 listener 是否一致。
- 建議處理方式：拆成 `useAppBootstrap()` 管理資料載入、abort controller 與初始化旗標；`useAppSocketLifecycle()` 管理 connection watcher、listener register/unregister 與 reconnect resync；`useCanvasSessionLifecycle()` 管理 canvas switch reset/load；`App.vue` 保留 layout 與 modal mounting。

#### Finding A2: canvas scoped reset 與資料載入邊界散在入口層

- 嚴重度：Medium
- 位置：`frontend/src/App.vue:129`、`frontend/src/App.vue:181`、`frontend/src/App.vue:355`
- 問題原因：入口層直接知道 pods、repositories、notes、connections、integrations、workflow listeners、runs 的載入順序，也直接知道 cursor/run/pod/connection/repository/chat 的 reset 清單。
- 維護風險：新增 canvas-scoped store 時必須記得同步修改入口檔，否則切換 canvas 可能留下舊 cursor、workflow listener、chat 或 run modal 狀態；這個風險不會由型別系統暴露。
- 建議處理方式：建立 canvas session store/composable，例如 `useCanvasSessionLoader()`，讓各 domain store 提供 `loadForCanvas()` / `resetForCanvasSwitch()` 或由集中 registry 收斂。入口層只呼叫 `canvasSession.loadActiveCanvas()` 與 `canvasSession.resetActiveCanvasState()`。

#### Finding A3: security bootstrap 與 modal/render gate 可以從入口模板抽離

- 嚴重度：Medium
- 位置：`frontend/src/App.vue:113`、`frontend/src/App.vue:289`、`frontend/src/App.vue:393`
- 問題原因：入口模板直接判斷 workspace unlock、bootstrapping、locked canvas view、canvas unlock dialog 與主要 canvas layout，script 也直接呼叫 `securityStore.bootstrapAccess()` 與初始化 canvas selection。
- 維護風險：security 流程改動會同時碰到 watcher、初始化流程與 template gate；若未來新增其他鎖定狀態或權限提示，`App.vue` 會繼續膨脹。
- 建議處理方式：將 workspace/canvas lock render gate 包成 `AppSecurityGate.vue` 或 `useAppSecurityGate()`，提供 bootstrapping、unlock view、locked canvas view 與 bootstrap/select 初始 canvas 的 API，入口只負責根據 gate slot 顯示主要 app。

### P1.A.t2 settings、selector、schedule 元件職責候選

#### Finding B1: `OpencodeSettingsPanel.vue` 混合 provider 載入、alias 映射、CRUD、排序、toast 與 UI

- 嚴重度：High
- 位置：`frontend/src/components/settings/OpencodeSettingsPanel.vue:45`、`frontend/src/components/settings/OpencodeSettingsPanel.vue:109`、`frontend/src/components/settings/OpencodeSettingsPanel.vue:217`、`frontend/src/components/settings/OpencodeSettingsPanel.vue:431`
- 問題原因：同一元件保存 provider/connected/loadState/search/expanded/draft/editing/delete/saving/refreshing 等狀態，並直接呼叫 provider API、server restart API 與 alias store 的 add/edit/remove/reorder/refreshPresets。
- 維護風險：API shape、alias 唯一性規則、拖曳排序失敗策略、toast 文案與 provider list UI 綁在一起；任何 alias 行為調整都需要讀完大型 SFC 才能確認是否影響本地 draggable mirror。
- 建議處理方式：抽 `useOpencodeProviderPanel()` 管理 provider list/search/restart/loadState；抽 `useOpencodeAliasEditor()` 管理 draft/edit/delete/refresh/reorder 與 toast；或把 alias action 的錯誤轉換移到 `opencodeAliasStore`，讓元件只接收 action result。

#### Finding B2: `GlobalSettingsModal.vue` 混合 config API、backup API、security API、locale side effect 與表單驗證

- 嚴重度：High
- 位置：`frontend/src/components/settings/GlobalSettingsModal.vue:54`、`frontend/src/components/settings/GlobalSettingsModal.vue:104`、`frontend/src/components/settings/GlobalSettingsModal.vue:139`、`frontend/src/components/settings/GlobalSettingsModal.vue:201`
- 問題原因：單一 modal 同時管理 timezone/language/backup/workspace password 四個領域，直接呼叫 config、backup、security API，並同步寫 config store、security store 與 i18n。
- 維護風險：新增設定欄位或 backup/security 狀態時，容易把表單 reset、API payload 組裝、store sync、inline error、toast 與 modal close 條件交錯在一起；`handleSave()` 已同時做 URL 驗證、payload mapping、API 呼叫、store update 與關閉 modal。
- 建議處理方式：拆 `useGlobalSettingsForm()` 管理 config load/save 與 payload mapping；`useBackupSettingsForm()` 管理 backup enable/url/time/trigger/error；`useWorkspacePasswordForm()` 管理 password action 與 transport risk；locale watch 可改由 locale store/action 處理。

#### Finding B3: `PodModelSelector.vue` 將 provider capability 查詢、互動狀態機、timer lifecycle 與大量 CSS 動畫集中在同一元件

- 嚴重度：Medium
- 位置：`frontend/src/components/pod/PodModelSelector.vue:23`、`frontend/src/components/pod/PodModelSelector.vue:47`、`frontend/src/components/pod/PodModelSelector.vue:97`、`frontend/src/components/pod/PodModelSelector.vue:250`
- 問題原因：元件同時從 capability store 取得模型、處理 opencode empty fallback、排序 active model、管理 hover/collapse/select async timer、處理 unmount 清理與樣式動畫。
- 維護風險：模型選項規則與動畫狀態機互相耦合，調整 provider capability 或 disabled 規則時可能破壞 hover/collapse timing；CSS 與 script 共同依賴互動狀態，但沒有可重用的狀態機邊界。
- 建議處理方式：抽 `usePodModelOptions()` 封裝 provider capability、fallback、排序與 disabled tooltip；抽 `useCollapsibleModelStack()` 封裝 timer、hover/collapse/select 狀態，元件只負責 render 與 emit。

#### Finding B4: `ScheduleModal.vue` 的 schedule form mapping 與 UI 重複條件可抽成 composable 或子元件

- 嚴重度：Medium
- 位置：`frontend/src/components/canvas/ScheduleModal.vue:41`、`frontend/src/components/canvas/ScheduleModal.vue:90`、`frontend/src/components/canvas/ScheduleModal.vue:115`、`frontend/src/components/canvas/ScheduleModal.vue:185`
- 問題原因：modal 內部直接保存各 frequency 的欄位、把 `existingSchedule` 映射到 form、驗證 weekly weekdays、組回 `Schedule` payload，template 再用多段 frequency 條件重複 render select 區塊。
- 維護風險：新增 schedule frequency 或調整 `Schedule` schema 時，需要同步修改 hydrate、reset、validate、confirm mapping 與 template 多段條件；漏改會造成 UI 顯示與送出的 schedule 不一致。
- 建議處理方式：抽 `useScheduleForm(existingSchedule)` 回傳 `state`、`hydrate()`、`reset()`、`validate()`、`toSchedule()`；重複的 hour/minute select 可拆成 `ScheduleTimeFields.vue`，weekly weekdays 可拆成 `ScheduleWeekdayPicker.vue`。

## P1.B Store 與狀態流 review

### Store action 多責任候選

#### `frontend/src/stores/connectionStore.ts`

- `createConnection` 同時負責新連線規則檢查、從 source pod 推導 summary provider/model、組裝 WebSocket payload、處理後端缺欄位 fallback，最後再做 domain normalization。這段橫跨 UI 操作、provider capability、contract payload 與 domain mapping，後續新增 provider 或調整 summary fallback 時容易在 store action 內擴散。建議拆出 `buildConnectionCreatePayload` 或 `resolveConnectionSummaryDefaults` domain helper，讓 action 只保留「呼叫後端並更新狀態」流程。
- `executeConnectionUpdate`、`syncConnectionUpdateResponse`、`normalizeUpdatedConnection`、`updateConnectionFromEvent` 形成一條混合 command response 與 broadcast event 的同步路徑。`CONNECTION_UPDATE` 回應可以帶 `connection` 或 `connections`，store 內同時處理多筆 sibling update、event upsert 與回傳目標 connection，這是狀態同步責任與 response mapper 責任混在一起。建議拆成 `connectionResponseMapper` 與 `applyConnectionPatchSet`，明確區分「後端 contract 轉 domain」與「寫入 store」。
- `validateBranchLabel`、`validateBranchDescription`、`validateBranchSettingsPayload` 同時依賴 store 內連線清單與 i18n error key，`updateConnectionBranchLabel`、`updateConnectionBranchDescription`、`updateConnectionBranchSettings` 又在 action 內處理 toast。這些規則可拆成 branch domain validator，action 只接收 validator result 並決定是否發 request，避免 branch label 規則散在 store 與 UI 文案之間。
- `resolveBranchDefaultsFromSourcePod` 與 `createConnection` 的 summary default 推導邏輯相似，但一個服務 branch defaults、一個服務 summary defaults；兩者都讀 `providerCapabilityStore`、`podStore` 與 `DEFAULT_SUMMARY_MODEL`。建議收斂成 provider/model resolver helper，降低 OpenCode model fallback 或 provider normalization 規則分岔。
- `setupWorkflowListeners`/`cleanupWorkflowListeners`、`workflowEventMap` 與 `workflowHandlers` 已部分拆到 `workflowEventHandlers`，但 listener lifecycle 仍在 connection store。若後續 workflow event 增加，建議把 event map 建立與註冊封裝成 workflow event adapter，store 只注入 `updateAutoGroupStatus`、`setConnectionStatus` 這類最小狀態 mutation。

#### `frontend/src/stores/run/runStore.ts`

- `openRunChatModal` 與 `loadOlderActiveRunChatMessages` 都負責 request token、防止 stale response、讀取歷史訊息、將 persisted payload 轉 timeline item、合併 live timeline、更新分頁狀態與 loading/error toast。這些責任可拆成 `runHistoryService` 或 `runChatHistoryActions`，並把 `mergeLoadedTimelineItems`、request token guard、pageInfo update 包成可測 helper。
- `appendRunChatMessage` 同時處理巢狀 Map 初始化、message index cache 驗證、delta 推導、partial length cache、upsert message 與 cache 寫回。這是典型 streaming reducer，建議拆為純函式 `reduceRunChatTextDelta(state, payload)`，輸入 timeline/cache、輸出 next timeline/cache，讓 store action 只負責取出 podMap 與 set 回去。
- `handleRunChatToolUse`、`handleRunChatToolResult`、`handleRunChatComplete` 都重複處理「podMap 不存在就建立」、「message 不存在時補 assistant message」、「更新 toolUse/subMessages」、「維護 messageIndexCache」。建議建立 run chat event reducer 或 event handler map，避免新的 streaming event 繼續複製這些流程。
- `removeRun`、`cleanupRunTranscript`、`resetRunChatState`、`resetOnCanvasSwitch` 都會清理 run chat timeline、loading flag、cache 與 modal token，但清理粒度不同。建議拆出 `createEmptyRunChatState` 與 `clearRunChatTarget` helper，降低 stale cache 或 active modal 狀態漏清的機率。

#### `frontend/src/stores/pod/podStore.ts`

- `updatePod` 同時做 pod validation、MCP availability cache invalidation、provider/goal 差異判斷與陣列更新。建議拆出 `shouldInvalidatePodMcpAvailability` 與 `replaceValidPod`，讓 action 的副作用更可測。
- `createPodWithBackend`、`deletePodWithBackend`、`renamePodWithBackend`、`setScheduleWithBackend`、`setGoalWithBackend` 都在 store action 中組 request、呼叫 `executeAction`、判斷 `success` 與必要欄位、更新本地狀態或 toast。可抽成 pod command service 或共用 response guard，避免每個 action 各自解讀 `ResultPayload`。
- `syncPodsFromBackend` 同時做全域 MCP availability cache invalidation、pod enrichment、座標 fallback 與 validation filter。建議拆出 `mapBackendPodToCanvasPod` mapper，明確記錄後端 pod 缺 `x/y` 時前端補位的 contract 行為。
- `updatePodProvider` 是跨 store 副作用熱點：它修改 pod provider/config、清 MCP cache，並呼叫 `connectionStore.reconcileSummaryModelsForPod` 修下游 connection summary model。建議把「provider 變更後的 downstream connection reconciliation」移到 domain command 或 event handler，避免 pod store 直接知道 connection store 的修復細節。
- `removePod` 同時刪 pod、清 selection/active state、清 MCP cache，並呼叫 `connectionStore.deleteConnectionsByPodId`。這可拆成 pod deletion side-effect handler，讓刪除 pod 的本地狀態變更與跨 domain cascade 更容易測。

### WebSocket / API / Store contract 風險

- Connection create/update/list 的 request/response 型別與 store mapper 分散在 `frontend/src/types/websocket/requests.ts`、`frontend/src/types/websocket/responses.ts`、`frontend/src/stores/connectionPayloadMappers.ts` 與 `connectionStore.ts`。其中 `ConnectionPayloadItem.summaryProvider` 用 `undefined` 表示升級前或未帶欄位，用 `null` 表示後端明確清除；`resolveSummaryProviderFromUpdatePayload` 又依此決定保留既有值或 fallback source provider。這個三態語意沒有獨立 contract guard，若後端改成永遠回 `null` 或省略欄位，前端會出現 summary provider 被重置或保留錯誤。
- `ConnectionUpdatedPayload` 同時支援 `connection?: ConnectionPayloadItem` 與 `connections?: ConnectionPayloadItem[]`，`syncConnectionUpdateResponse` 以 `connections?.length` 優先，否則 fallback 單筆。這讓 branch sibling update 的 bulk response 與單筆 update 共用同一事件名稱，但 store 的 caller 仍要從結果中找回目標 connection。建議建立明確的 `ConnectionUpdateResult` discriminated mapper，避免 response shape 新增欄位時破壞目標回傳。
- `ConnectionCreatePayload` 允許 `summaryProvider?: PodProvider | null`，但 `createConnection` 的本地 `basePayload` 型別只允許 `summaryProvider?: PodProvider`，而且只有 resolved provider 存在時才送 `summaryModel`。同一個 contract 在 request type 與 action payload builder 中語意不同，未來若 UI 支援「建立時明確清除 summary provider」會需要改 action 內的臨時型別。
- `normalizeConnection`、`normalizeCreatedConnectionEvent` 與 `mapConnectionUpdatedEventPayload` 都會做 summary model/provider fallback，但規則不完全一致：list 會依 source provider fallback，created event 預設 claude，updated event 會在 `summaryProvider === undefined` 時保留 existing。這是重複資料轉換熱點，建議集中成 connection domain mapper 並用 table-driven tests 固定 create/list/update 三種來源的差異。
- Run history API 回傳 `RunPodMessagesResultPayload.timelineItems: RunChatTimelineItemPayload[]` 為必填，但 store 在 `openRunChatModal` 使用 `response.success && response.timelineItems`，在 `loadOlderActiveRunChatMessages` 則只檢查 `success` 與 active target，直接 map `response.timelineItems`。兩處對同一 response contract 的 optional/required 假設不一致；若後端在失敗或空頁回傳缺欄位，兩條路徑行為會不同。建議用 `normalizeRunPodMessagesResult` 統一將缺欄位轉為空陣列並驗證 pageInfo。
- `createWebSocketRequest` 只把 `success === false` 視為 rejection，其他缺 `success` 或 payload 缺必要欄位的情況會 resolve 給 caller。Store action 目前各自用 `if (response.success && ...)` 或 `if (!result.success || !result.data.success || !result.data.pod)` 判斷，跨層成功語意不一致。建議在 API service 層建立 typed guard，例如 `expectResultPayload(response, "pod")`，讓缺必要欄位的錯誤集中處理。
- `useCanvasWebSocketAction.executeAction` 會把 `canvasId` 注入 payload，部分 store action 仍直接呼叫 `createWebSocketRequest` 並自行取 canvasId。這造成 API service 與 Pinia store 對 canvas-scoped request 的命名與流程不一致；建議統一 canvas-scoped WebSocket command helper，避免新增 action 時漏帶 canvasId 或重複寫 guard。

## P2.B 易脆 user flow 與 mock 測試 review

### P2.B.t1 `useNoteEventHandlers.test.ts` mock store 呼叫序列風險

#### Finding T1: 多數測例只驗證 mock store method 被呼叫，未驗證 note 狀態結果

- 嚴重度：Medium
- 位置：`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:37`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:135`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:201`
- 問題原因：測試以 `mockStore.updateNotePositionLocal`、`deleteNote`、`updateNotePosition`、`setIsOverTrash` 的呼叫參數作為主要斷言，store 本身只是 `vi.fn()` 集合，沒有反映 note 位置、垃圾桶狀態、刪除結果或 animation flag 的狀態容器。
- 維護風險：若 `useNoteEventHandlers` 未來改成呼叫更高階 command、合併 reset 流程、或把同步位置交給 reducer，使用者可觀察行為仍正確但測試會因 method 名稱或呼叫拆分改變而失敗；反過來，呼叫參數正確也不保證 note 實際被刪除或回到正確位置。
- 建議處理方式：保留少量 contract 測例確認 handler 會呼叫必要 store command，其餘拖曳流程改成使用 stateful fake note store。fake store 實作 `updateNotePositionLocal`、`updateNotePosition`、`deleteNote`、`setIsOverTrash`、`setNoteAnimating` 並更新 in-memory notes，測例斷言 note 最終座標、是否存在、trash 狀態與 animation 狀態。

#### Finding T2: 多次拖曳與完整流程測例依賴呼叫次數與呼叫順序，容易被內部節流或 reducer 重構打破

- 嚴重度：Medium
- 位置：`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:47`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:107`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:253`
- 問題原因：`應處理多次拖曳移動` 使用 `toHaveBeenNthCalledWith` 固定每次 local update 的序列；`應持續追蹤滑鼠位置變化` 每次 move 後立即驗證 `setIsOverTrash` 被呼叫；完整流程則混合 handler 呼叫與 mock function 呼叫斷言。
- 維護風險：若後續為效能加入 requestAnimationFrame batching、相同 trash 狀態去重、或把 drag move 合併成最後狀態寫入，使用者看到的最終拖曳位置與垃圾桶 highlight 仍可能正確，但測試會因中間呼叫序列變動而變成低訊號 failure。
- 建議處理方式：將「多次拖曳」改為斷言最後 note 座標與最後 trash 狀態；若要保留中間序列，改放在 reducer/helper 的 table-driven 測試。完整流程測例應命名為「拖到垃圾桶後 note 不再存在」、「已綁定 note 放開後回到起點且動畫結束」、「未經垃圾桶放開後後端同步到目前座標」，並用 stateful fake 的結果驗證。

#### Finding T3: timer 與 animation 測例只看 `setNoteAnimating` 呼叫，未固定動畫結束後的使用者可見狀態

- 嚴重度：Low
- 位置：`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:174`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:276`
- 問題原因：彈回動畫測例驗證 300ms 後 `setNoteAnimating('note-1', false)` 被呼叫，但沒有讓 fake store 保存 `isAnimating`，也沒有驗證 note 維持在 startX/startY 或 trash 狀態被清除。
- 維護風險：若 animation flag 的狀態 key、setter 名稱或更新位置重構，測試容易失敗；若 setter 被呼叫但狀態沒有真正落地，測試仍會通過。
- 建議處理方式：fake store 保存 `animationByNoteId` 與 note 座標，測例在 `vi.advanceTimersByTime(300)` 後斷言 `animationByNoteId['note-1'] === false`、note 座標為起點、trash 狀態為 false。這會比驗證 setter 呼叫更貼近使用者看到的彈回結果。

### P2.B.t2 userflow 測試 selector 與 stub render 風險

#### Finding T4: CanvasPod userflow 依賴 class selector 與 stub slot，未用角色或使用者可見文字定位互動目標

- 嚴重度：High
- 位置：`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:83`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:108`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:143`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:173`
- 問題原因：測試把 `PodSlots` stub 成三個帶 `.plugin-slot`、`.mcp-slot`、`.thinking-slot` class 的 button，再用 `.absolute.select-none` 與 `.pod-doodle` 觸發 drop/dblclick。這些 selector 來自實作 CSS 與測試 stub，而不是使用者可存取的 role、文字、aria label 或實際 DOM contract。
- 維護風險：Tailwind class 調整、DOM wrapper 改名、slot 子元件改版都可能讓測試失敗，但使用者功能未必壞；反過來，stub slot 顯示的 `plugins`、`mcp`、`thinking` 不一定等同真實 UI，測試可能錯過圖示按鈕的 aria label、disabled 狀態或 popover anchor 行為。
- 建議處理方式：讓真實 `PodSlots` 或較薄的 test double 暴露可存取按鈕名稱，改用 Testing Library 的 `getByRole('button', { name: ... })` 或 Vue Test Utils 的文字/aria selector。drop target 應補穩定的 `data-testid` 或 role contract，例如 pod container 的 `data-testid="canvas-pod"`，避免用 Tailwind utility class 當行為定位。

#### Finding T5: CanvasPod drop 測例用 composable stub 記錄陣列，仍偏向內部 wiring 而非檔案拖放結果

- 嚴重度：Medium
- 位置：`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:35`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:173`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:185`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:206`
- 問題原因：`usePodFileDrop` 被 mock 成 `acceptedDropPodIds` 與 `disabledDropAttempts` 陣列，測例只驗證 composable callback 收到 disabled 判斷與 pod id。這可以驗證 CanvasPod wiring，但沒有驗證使用者拖放檔案後看到 upload overlay、toast、上傳 command 或 pod 狀態變化。
- 維護風險：如果真實 drop composable 的事件條件、DataTransfer 檔案處理或 disabled UI 回饋壞掉，這組 userflow 仍可能通過；若內部 composable API 重構但行為一致，測試會失敗。
- 建議處理方式：把這組歸類為 component contract test，明確保留「CanvasPod 會把 pod id 與 disabled predicate 傳給 drop handler」；另補一組真正 userflow 使用 `DataTransfer`/file factory 觸發 drop，斷言使用者可見的 disabled toast、upload overlay 或 store/API command 結果。

#### Finding T6: OpenCode settings userflow 依賴 Tailwind card class 找 provider item，容易因樣式重排失效

- 嚴重度：High
- 位置：`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:82`、`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:99`、`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:107`
- 問題原因：測試用 `.flex.items-center.justify-between.rounded-md.border.border-border` 找 provider card，再用陣列第 0 筆確認 connected provider 排序。這個 selector 是 Tailwind utility 組合，並非 provider list 的語意 contract。
- 維護風險：只要 provider card 樣式改成 grid、抽成子元件或 border class 調整，測試就會失敗；如果排序錯但 class selector 抓到其他設定卡片，也可能產生誤判。
- 建議處理方式：在 provider list 或 provider item 加上語意化可測 contract，例如 role `list`/`listitem`、provider 名稱文字與狀態文字，測試改成以 `Provider X` 所在 listitem 斷言包含 `已登入`，再用 provider list 的第一個 listitem 文字驗證排序。重啟按鈕已用文字定位，這部分可保留。

#### Finding T7: OpenCode settings flow mock API 已覆蓋重啟後資料重載，但缺少錯誤與 loading 行為的使用者斷言

- 嚴重度：Medium
- 位置：`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:9`、`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:63`
- 問題原因：測試 mock `listOpencodeProviders` 與 `restartOpencodeServer`，驗證重啟後 connected provider 出現在上方，這是有效的狀態結果斷言；但目前只覆蓋成功路徑，toast composable 也被靜態 mock，沒有驗證重啟失敗、載入中 disable、或重新載入失敗時的使用者回饋。
- 維護風險：重啟流程最容易壞在 loading guard、錯誤訊息或 reload fallback；只測成功重排會讓這些可見失敗路徑缺乏保護。
- 建議處理方式：保留成功路徑，但補錯誤路徑 userflow：`restartOpencodeServer` reject 時按鈕回復可點並顯示錯誤 toast；重啟中按鈕 disabled 或顯示 loading；重啟成功但 provider reload 失敗時顯示重載失敗提示。斷言應以按鈕文字、disabled state、toast 訊息或 provider 狀態文字為主，不使用 Tailwind class。

## P2.A 低價值測試候選分類

### P2.A.t1 `renderMarkdown.test.ts` 測例分類

#### 刪除候選：純 Markdown library render 行為

- 位置：`frontend/tests/business-logic/utils/renderMarkdown.test.ts:5`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:11`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:17`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:25`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:55`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:60`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:130`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:136`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:141`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:146`
- 分類理由：這些測例主要驗證 `marked` 將標題、程式碼區塊、列表、段落、粗體、行內程式碼、有序列表、表格、區塊引用與水平線轉成預期 HTML tag。若產品沒有自訂 renderer 或額外 post-process，這些是第三方 Markdown parser 的契約，不是本專案的核心行為。
- 建議處理方式：刪除大部分純 tag presence 測例，最多保留 1 個 smoke test 確認 `renderMarkdown()` 有接上 `marked.parse()` 並回傳 HTML。若未來加入自訂 renderer，再為自訂規則補專案層測試。

#### 保留候選：sanitizer 與安全契約測例

- 位置：`frontend/tests/business-logic/utils/renderMarkdown.test.ts:30`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:36`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:71`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:76`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:89`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:96`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:101`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:107`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:112`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:151`
- 分類理由：這些測例對應 `renderMarkdown.ts` 中的 `DOMPURIFY_CONFIG`、`ALLOWED_TAGS`、`ALLOWED_ATTR` 與 `ALLOWED_URI_REGEXP`，覆蓋 script、img、event attribute、style、data/javascript URI、SVG 與 tracking pixel 等安全邊界。這些不是單純測 DOMPurify，而是在固定本專案允許的 HTML/URI policy。
- 建議處理方式：保留，並可改成 table-driven cases，讓危險輸入與禁止輸出集中維護。若 sanitizer policy 變更，這組測試應作為回歸防線。

#### 保留候選：link attribute 與允許 scheme 契約

- 位置：`frontend/tests/business-logic/utils/renderMarkdown.test.ts:65`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:120`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:125`
- 分類理由：`target="_blank"` 與 `rel="noopener noreferrer"` 由本專案在 `DOMPurify.addHook("afterSanitizeAttributes")` 加上；`mailto:`、`tel:` 則來自本專案的 `ALLOWED_URI_REGEXP`。這些是產品安全/可用性契約，不能視為 Markdown library 行為。
- 建議處理方式：保留，並把外部連結、mailto、tel、javascript/data blocked 合併成「連結 policy」測試組，降低重複 setup。

#### 改寫候選：空輸入與允許標籤覆蓋

- 位置：`frontend/tests/business-logic/utils/renderMarkdown.test.ts:43`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:47`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:51`、`frontend/tests/business-logic/utils/renderMarkdown.test.ts:81`
- 分類理由：空字串、`undefined` 與純空白是本專案 `if (!raw || raw.trim().length === 0) return ""` 的防禦行為，值得保留但目前三個測例重複度高；允許 `<strong>`、`<em>`、`<del>` 則混合 Markdown render 與 allowlist contract，單純 `toContain("<strong>")` 容易退化成測 library。
- 建議處理方式：空輸入改成 `it.each`，明確驗證「不呼叫 parser 前即回空字串」的邊界；允許標籤測例改成直接對應 DOMPurify allowlist 的代表性輸入，避免覆蓋到純 Markdown tag 渲染。

### P2.A.t2 `arrayHelpers.test.ts` 與 `podStore.test.ts` 低價值候選

#### 刪除候選：`removeById` 對 `Array.filter` 的薄包裝測試

- 位置：`frontend/tests/business-logic/lib/arrayHelpers.test.ts:6`、`frontend/tests/business-logic/lib/arrayHelpers.test.ts:13`、`frontend/tests/business-logic/lib/arrayHelpers.test.ts:27`、`frontend/tests/business-logic/lib/arrayHelpers.test.ts:33`
- 分類理由：`removeById()` 的實作是 `items.filter(item => item.id !== id)`，這些測例主要確認 filter 移除、找不到時長度不變、空陣列與唯一元素結果。除非這個 helper 是跨 domain 的穩定 public contract，否則測試價值接近測 JS 標準庫。
- 建議處理方式：刪除多數 shape 測例，最多保留 `應回傳新陣列而非修改原陣列` 作為 immutability contract；更好的選項是把 `removeById` 併回呼叫端，改測呼叫端刪除項目後的使用者可觀察狀態。

#### 改寫候選：Pod getter 鏡射測例

- 位置：`frontend/tests/business-logic/stores/podStore.test.ts:59`、`frontend/tests/business-logic/stores/podStore.test.ts:91`、`frontend/tests/business-logic/stores/podStore.test.ts:107`、`frontend/tests/business-logic/stores/podStore.test.ts:173`
- 分類理由：`selectedPod`、`podCount`、`getPodById`、`isScheduleFiredAnimating` 多數測例直接設定 store state 後確認 computed getter 鏡射 `podMap`、`pods.length` 或 `Set.has()`。這些對回歸價值有限，且與使用者流程距離遠。
- 保留條件：若 getter 代表跨元件使用的穩定 selector，保留最少量測例驗證「找不到時回傳 null/undefined」與 `podMap` 更新後的行為即可；若只是 UI 顯示用鏡射，應移到 user flow 或 store action 測試中透過狀態結果間接覆蓋。
- 建議處理方式：刪除 `podCount` 的兩個純 length 測例；`selectedPod` 與 `getPodById` 合併成 selector table；`isScheduleFiredAnimating` 由 `triggerScheduleFiredAnimation` / `clearScheduleFiredAnimation` 的狀態結果覆蓋。

#### 保留或改寫候選：初始狀態與預設值鏡射測例

- 位置：`frontend/tests/business-logic/stores/podStore.test.ts:130`、`frontend/tests/business-logic/stores/podStore.test.ts:265`、`frontend/tests/business-logic/stores/podStore.test.ts:288`、`frontend/tests/business-logic/stores/podStore.test.ts:298`
- 分類理由：`getNextPodName` 測例目前直接驗證命名 helper 對 `pods` 初始/缺號狀態的鏡射，價值取決於使用者建立 Pod 時是否依賴此命名規則；`enrichPod` 的預設座標、placeholder model、schedule null 與 rotation 範圍則對後端缺欄位或舊資料相容有實際 contract 價值。
- 保留條件：`getNextPodName` 只有在 UI 新增 Pod 預設命名必須穩定時保留，且應改成從建立 Pod 流程驗證使用者看到的預設名稱；`enrichPod` 應保留，因為它固定舊資料/後端缺欄位進入 canvas 前的相容 contract。
- 建議處理方式：將 `getNextPodName` 從低階 getter 測試改寫到 create pod flow 或 command helper 測試；`enrichPod` 改成 table-driven 測試，列清楚缺欄位、既有欄位保留、rotation 範圍三類 contract。

## P2.B 易脆 user flow 與 mock 測試 review

### P2.B.t1 `useNoteEventHandlers.test.ts` mock store 呼叫序列風險

#### 改寫候選：拖曳流程主要驗證 mock store 呼叫細節

- 位置：`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:24`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:44`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:55`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:138`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:163`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:204`
- 分類理由：測試以手寫 mock store、mock trash zone 與 `toHaveBeenCalledWith` 驗證 composable 內部呼叫序列，能抓到 function call 變更，但很少驗證使用者真的看到的 note 位置、垃圾桶 hover 狀態、刪除結果或彈回結果。若 composable 內部改用 store action wrapper、event reducer 或不同呼叫順序，測試會大量破裂，即使使用者行為沒有變。
- 保留條件：`trashZoneRef` 為 null、note 不存在、已綁定 note 不可刪除這類防禦分支可以保留少量單元測試，因為它們是 composable 的明確邊界條件。
- 建議處理方式：將主要拖曳流程改成以真實 note store 或最小 fake state reducer 驗證結果，例如「拖到垃圾桶後 note 不在清單中」、「已綁定 note 放開後位置回到 startX/startY 且動畫旗標最後關閉」、「未進垃圾桶時最終位置被同步」。mock call 測試只保留外部副作用邊界，例如後端同步 action 被呼叫一次。

#### 刪除候選：重複驗證同一狀態 reset 的測例

- 位置：`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:150`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:191`、`frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts:228`
- 分類理由：三個測例分別在刪除、彈回、一般同步流程中只驗證 `setIsOverTrash(false)`，而完整流程測例也已覆蓋相同結果。這類單一 mock call 測試增加維護成本，但沒有提供新的 user flow 保障。
- 建議處理方式：合併到完整流程測例，並改以可觀察狀態命名，例如「完成任何拖曳結束後垃圾桶 hover 狀態應清除」；若 store reducer 化，可用 table-driven 測三種完成路徑。

### P2.B.t2 userflow 測試 selector 與 stub render 風險

#### 改寫候選：`canvasPodInteractionsFlow.test.ts` 依賴 stub slot class 與內部 layout class

- 位置：`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:88`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:112`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:148`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:176`、`frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts:190`
- 分類理由：測試名稱是 user interactions，但大量互動透過 stub 元件內的 `.plugin-slot`、`.mcp-slot`、`.thinking-slot`、`.absolute.select-none`、`.pod-doodle` class 操作。這些 class 不是使用者可感知契約，Tailwind 或 template 結構調整會破壞測試；同時 popover 內容也以 stub `data-testid` 驗證，覆蓋不到真實 popover 的可用文字或互動。
- 保留條件：未知 provider 阻擋雙擊與下游 chain pod 阻擋拖放是有效 user flow，因為它們驗證使用者不能開啟對話或拖放檔案，且有 toast/狀態結果。
- 建議處理方式：替互動元素提供穩定 accessible name 或 data-state，例如 plugin/MCP/thinking 按鈕用角色與名稱查找；drop 區改由 component contract 暴露 `data-testid="pod-drop-zone"` 或用使用者可見 pod 容器；toast 驗證保留。popover 測試應盡量 mount 真實輕量子元件，或驗證 store/view state 而不是 stub DOM。

#### 改寫候選：`opencodeSettingsFlow.test.ts` 以 Tailwind class selector 找 provider row

- 位置：`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:82`、`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:100`、`frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts:107`
- 分類理由：重啟流程本身有價值，但 provider row 查找依賴 `.flex.items-center.justify-between.rounded-md.border.border-border`，這是樣式實作而非產品契約。按鈕雖以文字查找較穩定，但 provider row 排序與登入狀態應用可見名稱、badge 文字或語意區塊驗證。
- 建議處理方式：在 provider row 加入 `aria-label` 或 `data-testid` 搭配 provider id，測試改成「按下重新啟動 OpenCode 後，Provider X 顯示已登入且排在清單第一筆」。若要避免測 class，可用 Testing Library 的 role/text query 或 Vue wrapper 的元件 props/state 斷言。

## P2.C 前端測試設定 review

### P2.C.t1 `frontend/tests/setup.ts` console mock 設定

#### Finding C1: 全域靜音 `console.warn` / `console.error` 會隱藏 Vue、i18n、未處理錯誤與 component warning

- 嚴重度：High
- 位置：`frontend/tests/setup.ts:21`、`frontend/tests/setup.ts:22`、`frontend/tests/setup.ts:23`、`frontend/tests/setup.ts:63`
- 問題原因：setup 階段直接把 `console.warn` 與 `console.error` 替換成 `vi.fn()`，每個測試前又 `vi.clearAllMocks()`，因此 Vue runtime warning、Vue Test Utils mount warning、i18n linked message warning、未 mock API 造成的 error log 都不會讓測試失敗，也不會在 CI 輸出中浮出。
- 維護風險：測試可能在有 Vue warning 或 error boundary 噪音時仍通過，導致 userflow 測試只驗證 DOM 片段卻漏掉 runtime regression。尤其本檔已為 i18n `@` 字元特別覆寫 locale，代表 warning 曾經影響測試；全域靜音會讓下一個類似問題變成背景噪音。
- 應浮出的訊號：`console.error` 預設應使測試失敗；`console.warn` 中包含 Vue warning、Unhandled error、failed prop validation、missing required prop、i18n message compile/linked message、hydration/mount warning、accessibility 或 deprecation warning 時應失敗。
- 允許靜音條件：個別測試明確驗證錯誤路徑時，可以用 helper 暫時允許特定訊息 pattern，並在測試結束確認該 pattern 被觸發；不應全域吞掉所有 warn/error。
- 建議處理方式：在 setup 建立 `installConsoleFailFast()`，預設 spy `console.warn/error` 後 throw 或累積到 `afterEach` fail；提供 `allowConsoleMessage(/expected warning/)` 之類測試 helper 處理已知例外。`vi.clearAllMocks()` 不應清掉 console guard 的預期清單，避免測試中途產生的 warning 被 reset 掉。

## P3.A 前端結論與優先序

### P3.A.t1 前端 findings 優先序

1. High：拆分 `frontend/src/App.vue` 入口協調。優先抽 `useAppBootstrap()`、`useAppSocketLifecycle()`、`useCanvasSessionLifecycle()` 與 security gate，因為入口目前同時處理初始化、WebSocket、canvas reset/load、security bootstrap 與 modal orchestration，任何啟動順序或 canvas 切換需求都會回到同一檔案。
2. High：整理 settings 與 OpenCode alias UI 的資料/副作用邊界。`OpencodeSettingsPanel.vue` 與 `GlobalSettingsModal.vue` 混合 API 呼叫、form mapping、toast、store sync、drag reorder 與 security/backup side effect，應先抽 composable 或 store action，避免 UI 調整順便改壞資料同步。
3. High：收斂跨層 WebSocket/API/store contract。connection、run history、canvas-scoped request 的 response mapper 與成功語意分散在 types、API service 與 Pinia store；建議建立 typed guard 與 domain mapper，固定 `undefined` / `null` / missing field 的語意。
4. Medium：拆分 Pinia store action 的 reducer/helper。`connectionStore`、`runStore`、`podStore` 中多個 action 同時做 validation、payload mapping、API call、side effect 與 local state mutation，應將 streaming reducer、provider/model resolver、pod mapper、branch validator 抽為可測純函式。
5. Medium：調整測試套件訊號品質。刪除純 library/Array/filter/getter mirror 測試，將 userflow 測試從 Tailwind class/stub DOM 改成 role、文字、狀態或事件結果；console warning/error 改成 fail-fast guard，避免 runtime warning 被靜音。

### P3.A.t2 前端測試刪除、改寫、保留清單

#### 刪除候選

- `frontend/tests/business-logic/utils/renderMarkdown.test.ts` 中只驗證 Markdown library 產生標題、列表、表格、blockquote、水平線、粗體、inline code 的測例：符合「測第三方 library 行為」判準。
- `frontend/tests/business-logic/lib/arrayHelpers.test.ts` 中 `removeById` 移除存在/不存在/空陣列/唯一元素等 `Array.filter` 薄包裝測例：符合「測標準庫薄 wrapper」判準；最多保留 immutability contract。
- `frontend/tests/business-logic/stores/podStore.test.ts` 中純 `podCount`、`selectedPod`、`getPodById`、`isScheduleFiredAnimating` getter mirror 測例可縮減：符合「鏡射 state 而非使用者行為」判準。

#### 改寫候選

- `frontend/tests/business-logic/utils/renderMarkdown.test.ts` 的空輸入與允許標籤測例：改成 table-driven，明確區分空輸入防禦行為與 DOMPurify allowlist contract。
- `frontend/tests/business-logic/stores/podStore.test.ts` 的 `getNextPodName`：改到 create pod flow 或 command helper，驗證使用者新增 Pod 時看到的預設名稱。
- `frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts`：以 stateful fake note store 或 reducer result 取代大量 mock call sequence，驗證 note 最終座標、刪除、彈回、trash hover 與 animation 狀態。
- `frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts`：將 `.plugin-slot`、`.mcp-slot`、`.thinking-slot`、`.absolute.select-none`、`.pod-doodle` 改成 accessible role/name、穩定 data-testid 或真實子元件輸出；drop 測試補使用者可見的 disabled toast/upload overlay/store command 結果。
- `frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts`：將 Tailwind provider card selector 改成 provider list/listitem、provider name/status badge 或 data-testid；補重啟失敗、loading disabled 與 reload 失敗的使用者回饋測試。
- `frontend/tests/setup.ts`：全域 `console.warn/error` mock 改成 fail-fast guard 與 allowlist helper，符合「runtime warning/error 應浮出」判準。

#### 保留候選

- `frontend/tests/business-logic/utils/renderMarkdown.test.ts` 的 sanitizer、安全 URI、script/img/event/style/svg/tracking pixel 與 link `target/rel` 測例：符合「本專案安全 policy」判準。
- `frontend/tests/business-logic/stores/podStore.test.ts` 的 `enrichPod` 缺欄位相容、providerConfig 保留、schedule null、rotation 範圍測例：符合「後端缺欄位與舊資料相容 contract」判準。
- `frontend/tests/business-logic/composables/canvas/useNoteEventHandlers.test.ts` 的 trash zone null、note 不存在、已綁定 note 不可刪除等邊界分支：符合「composable 防禦邊界」判準，但應降低 mock call 細節。
- `frontend/tests/userflows/canvas/canvasPodInteractionsFlow.test.ts` 的未知 provider 阻擋對話/拖放與下游 chain pod 阻擋拖放：符合「使用者可觀察行為」判準，只需改善 selector 與狀態斷言。
- `frontend/tests/userflows/settings/opencodeSettingsFlow.test.ts` 的重啟成功後 provider 重新載入排序：符合「設定頁使用者流程」判準，只需改用語意 selector 並補錯誤路徑。
