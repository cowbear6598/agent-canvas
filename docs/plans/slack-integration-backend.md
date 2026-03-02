# Slack 整合後端計畫書

## 一、測試案例定義

### 單元測試

#### `backend/tests/unit/slackAppStore.test.ts`
- 建立 Slack App（正常 Token）
- 建立 Slack App（重複 Bot Token 應失敗）
- 取得 Slack App by ID
- 取得所有 Slack App 清單
- 更新 Slack App 名稱
- 刪除 Slack App
- 持久化後重新載入資料正確

#### `backend/tests/unit/slackMessageQueue.test.ts`
- 空佇列取出回傳 undefined
- 推入單一訊息後取出成功
- 先進先出順序正確
- 超過佇列上限時最舊訊息被丟棄
- 清空佇列後取出回傳 undefined
- 取得佇列長度正確

#### `backend/tests/unit/slackConnectionManager.test.ts`
- 建立 Bolt App 實例成功
- 相同 Bot Token 共用連線（不重複建立）
- 啟動 Socket Mode 連線
- 斷開連線後狀態更新
- 自動重連 backoff 間隔遞增
- 重連成功後 backoff 重置
- 連線健康檢查偵測到斷線
- 銷毀連線並清理資源

### 整合測試

#### `backend/tests/integration/slack.test.ts`
- 透過 WS 事件 `slack:app:create` 建立 Slack App
- 建立 Slack App 時 Token 格式驗證失敗
- 建立 Slack App 時名稱為空應失敗
- 透過 WS 事件 `slack:app:list` 取得 Slack App 清單
- 透過 WS 事件 `slack:app:get` 取得單一 Slack App 詳情
- 透過 WS 事件 `slack:app:delete` 刪除 Slack App
- 刪除不存在的 Slack App 回傳錯誤
- 透過 WS 事件 `slack:app:channels` 取得 Slack App 的頻道清單
- 透過 WS 事件 `slack:app:channels:refresh` 重新取得頻道清單
- Pod 綁定 Slack 連線（WS 事件 `pod:bind-slack`）
- Pod 解綁 Slack 連線（WS 事件 `pod:unbind-slack`）
- Pod 綁定時指定不存在的 Slack App 應失敗
- Pod 綁定時指定不存在的頻道 ID 應失敗
- Pod 刪除時自動清理 Slack 連線
- Slack App 刪除時自動解綁所有 Pod

---

## 二、新增依賴套件

在 `backend/package.json` 的 `dependencies` 新增：

```
"@slack/bolt": "^4.x"
```

> `@slack/bolt` 內建 Socket Mode 支援，不需要額外安裝 `@slack/socket-mode`。Bolt 提供 `App` 類別，設定 `socketMode: true` + `appToken` 即可啟用 Socket Mode。

---

## 三、新增檔案結構

```
backend/src/
├── types/
│   └── slack.ts                          # Slack 相關型別定義
├── schemas/
│   └── slackSchemas.ts                   # Zod Schema + WebSocket 事件 payload 型別
├── services/
│   └── slack/
│       ├── slackAppStore.ts              # Slack App 資料儲存（CRUD + 持久化）
│       ├── slackConnectionManager.ts     # Bolt App 實例管理、Socket Mode 連線池
│       ├── slackEventService.ts          # app_mention 事件處理、訊息路由
│       ├── slackMessageQueue.ts          # Pod 忙碌時的訊息佇列
│       └── slackMcpToolProvider.ts       # 動態提供 slack_reply MCP Tool
├── handlers/
│   ├── slackHandlers.ts                  # WebSocket 事件處理器實作
│   └── groups/
│       └── slackHandlerGroup.ts          # Handler Group 註冊
├── api/
│   └── slackApi.ts                       # REST API 處理器
└── tests/
    ├── unit/
    │   ├── slackAppStore.test.ts
    │   ├── slackMessageQueue.test.ts
    │   └── slackConnectionManager.test.ts
    └── integration/
        └── slack.test.ts
```

---

## 四、資料模型設計

### 4.1 SlackApp 型別（`backend/src/types/slack.ts`）

- [x] 建立 `backend/src/types/slack.ts`
  - `SlackAppStatus` 型別：`'connected' | 'disconnected' | 'connecting' | 'error'`
  - `SlackChannel` 介面：
    - `id`: string（Slack channel ID，如 `C01234ABCDE`）
    - `name`: string（頻道名稱）
  - `SlackApp` 介面：
    - `id`: string（UUID）
    - `name`: string（使用者自訂的顯示名稱）
    - `botToken`: string（`xoxb-` 開頭）
    - `appToken`: string（`xapp-` 開頭）
    - `status`: SlackAppStatus
    - `channels`: SlackChannel[]（Bot 已加入的頻道，透過 API 取得後快取）
    - `botUserId`: string（Bot 自身的 User ID，用於判斷 mention 事件）
  - `PodSlackBinding` 介面：
    - `slackAppId`: string
    - `slackChannelId`: string（單一頻道 ID）
  - `SlackQueueMessage` 介面：
    - `id`: string（UUID）
    - `slackAppId`: string
    - `channelId`: string
    - `userId`: string（發送者的 Slack User ID）
    - `userName`: string（發送者的顯示名稱）
    - `text`: string（訊息內容，已移除 mention 標籤）
    - `threadTs`: string（Slack thread timestamp，用於回覆時指定 thread）
    - `eventTs`: string（事件時間戳）
  - `PersistedSlackApp` 介面（持久化用，不含 `status`）：
    - 與 SlackApp 相同，但不包含 `status` 和 `channels`
- [x] 在 `backend/src/types/index.ts` 新增 export：
  - `export type { SlackApp, SlackAppStatus, SlackChannel, PodSlackBinding, SlackQueueMessage, PersistedSlackApp } from './slack.js';`

### 4.2 Pod 新增 Slack 綁定欄位

- [x] 在 `backend/src/types/pod.ts` 的 `Pod` 介面新增：
  - `slackBinding?: PodSlackBinding`（可選欄位，未綁定時不存在）
  - import `PodSlackBinding` from `./slack.js`

### 4.3 持久化格式

- Slack App 資料存放在 `~/Documents/ClaudeCanvas/slack-apps.json`，格式為 `PersistedSlackApp[]`
- Pod 的 `slackBinding` 欄位隨 Pod JSON 一起持久化（已有機制，只需加欄位）
- 訊息佇列不需持久化（記憶體 only，重啟後丟棄）

---

## 五、Zod Schema 設計

- [x] 建立 `backend/src/schemas/slackSchemas.ts`
  - `slackAppCreateSchema`：
    - `name`: z.string().min(1).max(100)
    - `botToken`: z.string().startsWith('xoxb-')
    - `appToken`: z.string().startsWith('xapp-')
  - `slackAppDeleteSchema`：
    - `slackAppId`: z.string().uuid()
  - `slackAppGetSchema`：
    - `slackAppId`: z.string().uuid()
  - `slackAppChannelsSchema`：
    - `slackAppId`: z.string().uuid()
  - `slackAppChannelsRefreshSchema`：
    - `slackAppId`: z.string().uuid()
  - `podBindSlackSchema`：
    - `canvasId`: z.string()
    - `podId`: z.string()
    - `slackAppId`: z.string().uuid()
    - `slackChannelId`: z.string().min(1)（Slack channel ID 格式）
  - `podUnbindSlackSchema`：
    - `canvasId`: z.string()
    - `podId`: z.string()
  - 匯出對應 payload 型別（`SlackAppCreatePayload`, `SlackAppDeletePayload`, `SlackAppGetPayload`, `SlackAppChannelsPayload`, `SlackAppChannelsRefreshPayload`, `PodBindSlackPayload`, `PodUnbindSlackPayload`）
- [x] 在 `backend/src/schemas/index.ts` 新增 `export * from './slackSchemas.js';`
- [x] 在 `backend/src/schemas/events.ts` 的 `WebSocketRequestEvents` 新增：
  - `SLACK_APP_CREATE = 'slack:app:create'`
  - `SLACK_APP_DELETE = 'slack:app:delete'`
  - `SLACK_APP_LIST = 'slack:app:list'`
  - `SLACK_APP_GET = 'slack:app:get'`
  - `SLACK_APP_CHANNELS = 'slack:app:channels'`
  - `SLACK_APP_CHANNELS_REFRESH = 'slack:app:channels:refresh'`
  - `POD_BIND_SLACK = 'pod:bind-slack'`
  - `POD_UNBIND_SLACK = 'pod:unbind-slack'`
- [x] 在 `backend/src/schemas/events.ts` 的 `WebSocketResponseEvents` 新增：
  - `SLACK_APP_CREATED = 'slack:app:created'`
  - `SLACK_APP_DELETED = 'slack:app:deleted'`
  - `SLACK_APP_LIST_RESULT = 'slack:app:list:result'`
  - `SLACK_APP_GET_RESULT = 'slack:app:get:result'`
  - `SLACK_APP_CHANNELS_RESULT = 'slack:app:channels:result'`
  - `SLACK_APP_CHANNELS_REFRESHED = 'slack:app:channels:refreshed'`
  - `POD_SLACK_BOUND = 'pod:slack:bound'`
  - `POD_SLACK_UNBOUND = 'pod:slack:unbound'`
  - `SLACK_CONNECTION_STATUS_CHANGED = 'slack:connection:status:changed'`
  - `SLACK_MESSAGE_RECEIVED = 'slack:message:received'`（通知前端有 Slack 訊息進來）
  - `SLACK_MESSAGE_QUEUED = 'slack:message:queued'`（通知前端訊息已排隊）

---

## 六、核心服務設計

### 6.1 SlackAppStore（`backend/src/services/slack/slackAppStore.ts`）

- [x] 建立 `SlackAppStore` 類別
  - 內部資料結構：`Map<string, SlackApp>`（key = slackApp.id）
  - `create(name, botToken, appToken)` 方法：
    - 產生 UUID
    - 驗證 botToken 不重複（遍歷現有 App，相同 botToken 視為重複，回傳錯誤）
    - 建立 SlackApp 物件，初始 status 為 `'disconnected'`，channels 為空陣列
    - 寫入 Map 並觸發持久化
    - 回傳建立的 SlackApp
  - `list()` 方法：回傳所有 SlackApp 陣列
  - `getById(id)` 方法：回傳單一 SlackApp 或 undefined
  - `getByBotToken(botToken)` 方法：以 botToken 查找
  - `updateStatus(id, status)` 方法：更新連線狀態
  - `updateChannels(id, channels)` 方法：更新頻道快取
  - `updateBotUserId(id, botUserId)` 方法：更新 Bot User ID
  - `delete(id)` 方法：從 Map 移除並觸發持久化
  - `loadFromDisk(dataDir)` 方法：從 `slack-apps.json` 載入
  - `saveToDiskAsync()` 方法：使用 `WriteQueue` 非同步寫入 `slack-apps.json`
  - 匯出 singleton `slackAppStore`

### 6.2 SlackConnectionManager（`backend/src/services/slack/slackConnectionManager.ts`）

- [x] 建立 `SlackConnectionManager` 類別
  - 內部資料結構：
    - `boltApps`: `Map<string, App>`（key = slackApp.id，Bolt App 實例）
    - `healthCheckInterval`: NodeJS.Timeout | null
    - `reconnectTimeouts`: `Map<string, NodeJS.Timeout>`（key = slackApp.id）
    - `reconnectAttempts`: `Map<string, number>`（重連嘗試次數，用於 backoff）
  - `connect(slackApp: SlackApp)` 方法：
    - 如果已有相同 id 的 Bolt App 實例，直接回傳
    - 建立 `new App({ token: slackApp.botToken, socketMode: true, appToken: slackApp.appToken })`
    - 呼叫 `app.start()`
    - 更新 slackAppStore status 為 `'connected'`
    - 呼叫 Slack API `auth.test` 取得 botUserId，更新到 slackAppStore
    - 呼叫 `fetchChannels()` 取得頻道清單
    - 註冊 `app.event('app_mention', ...)` 事件監聽（委派給 slackEventService）
    - 廣播 `SLACK_CONNECTION_STATUS_CHANGED` 到所有前端連線
    - 將 Bolt App 存入 Map
  - `disconnect(slackAppId: string)` 方法：
    - 取出 Bolt App 實例
    - 呼叫 `app.stop()`
    - 從 Map 移除
    - 更新 slackAppStore status 為 `'disconnected'`
    - 清除該 App 的重連 timeout
    - 廣播 `SLACK_CONNECTION_STATUS_CHANGED`
  - `fetchChannels(slackApp: SlackApp)` 方法：
    - 使用 Bolt App 的 `client.conversations.list` API
    - 篩選 `is_member: true` 的頻道
    - 將結果更新到 slackAppStore.updateChannels
  - `sendMessage(slackAppId: string, channelId: string, text: string, threadTs?: string)` 方法：
    - 取出 Bolt App 實例
    - 呼叫 `app.client.chat.postMessage({ channel, text, thread_ts })`
  - `startHealthCheck()` 方法：
    - 每 30 秒遍歷所有 Bolt App，呼叫 `auth.test` 確認連線存活
    - 若失敗，觸發重連
  - `stopHealthCheck()` 方法：
    - 清除 interval
  - `handleReconnect(slackAppId: string)` 方法：
    - 指數退避策略：`Math.min(1000 * 2^attempts, 30000)` 毫秒
    - 設定 setTimeout 呼叫 `connect()`
    - 更新 slackAppStore status 為 `'connecting'`
    - 成功後重置 attempts 為 0
    - 失敗後 attempts + 1，繼續 backoff
  - `destroyAll()` 方法：
    - 停止所有 Bolt App、清除所有 timeout
    - 用於伺服器關閉時
  - 匯出 singleton `slackConnectionManager`

### 6.3 SlackEventService（`backend/src/services/slack/slackEventService.ts`）

- [ ] 建立 `SlackEventService` 類別
  - `handleAppMention(slackAppId: string, event: AppMentionEvent)` 方法：
    - 從 event 取得 `channel`, `user`, `text`, `thread_ts`, `event_ts`
    - 清理 text 中的 `<@BOT_USER_ID>` mention 標籤
    - 查找所有綁定此 slackAppId + 此 channelId 的 Pod（遍歷所有 canvas 的所有 pod）
    - 對每個匹配的 Pod 呼叫 `routeMessageToPod()`
  - `routeMessageToPod(canvasId, podId, message: SlackQueueMessage)` 方法：
    - 取得 Pod 狀態
    - 若 Pod status 為 `'idle'`：
      - 直接注入 Chat 訊息（呼叫 `injectSlackMessage()`）
    - 若 Pod status 為 `'chatting'` 或 `'summarizing'`：
      - 將訊息推入 `slackMessageQueue`
      - 廣播 `SLACK_MESSAGE_QUEUED` 事件到前端
    - 若 Pod status 為 `'error'`：
      - 將 Pod 狀態重設為 idle，然後注入訊息
  - `injectSlackMessage(canvasId, podId, message: SlackQueueMessage)` 方法：
    - 組合使用者訊息格式：`[Slack: @{userName}] {text}`
    - 設定 Pod 狀態為 `'chatting'`
    - 使用 `messageStore.addMessage()` 記錄使用者訊息
    - 廣播 `POD_CHAT_USER_MESSAGE` 到前端（讓前端顯示 Slack 訊息來源）
    - 呼叫 `executeStreamingChat()` 觸發 Claude 對話
    - 在 `onComplete` callback 中呼叫 `processNextQueueMessage()`
  - `processNextQueueMessage(canvasId, podId)` 方法：
    - 從佇列取出下一則訊息
    - 若有訊息，呼叫 `injectSlackMessage()`
    - 若無訊息，不做任何事
  - `findBoundPods(slackAppId, channelId)` 方法：
    - 遍歷所有 canvas、所有 pod
    - 篩選 `pod.slackBinding?.slackAppId === slackAppId && pod.slackBinding?.slackChannelId === channelId`
    - 回傳 `Array<{ canvasId: string, pod: Pod }>`
  - 匯出 singleton `slackEventService`

### 6.4 SlackMessageQueue（`backend/src/services/slack/slackMessageQueue.ts`）

- [x] 建立 `SlackMessageQueue` 類別
  - 內部資料結構：`Map<string, SlackQueueMessage[]>`（key = podId）
  - 常數 `MAX_QUEUE_SIZE = 10`
  - `enqueue(podId, message)` 方法：
    - 取得該 Pod 的佇列（不存在則建立）
    - 若佇列已滿，移除最舊的訊息（shift）
    - 推入新訊息
  - `dequeue(podId)` 方法：
    - 取得佇列的第一則訊息（shift）
    - 若佇列空了則從 Map 移除 key
    - 回傳訊息或 undefined
  - `clear(podId)` 方法：
    - 從 Map 移除該 Pod 的所有訊息
  - `size(podId)` 方法：
    - 回傳該 Pod 佇列中的訊息數量
  - 匯出 singleton `slackMessageQueue`

### 6.5 SlackMcpToolProvider（`backend/src/services/slack/slackMcpToolProvider.ts`）

- [x] 建立 `SlackMcpToolProvider` 類別
  - `SLACK_REPLY_MCP_SERVER_ID` 常數：`'__slack_reply__'`（固定 ID，用於辨識）
  - `createSlackReplyMcpConfig(slackAppId, channelId)` 方法：
    - 回傳一個 MCP Server 設定（stdio 類型），配置為一個簡單的 Bun script
    - 該 script 提供 `slack_reply` tool，接收 `text` 和可選的 `thread_ts` 參數
    - 實際上透過 HTTP 回呼到後端 `/api/internal/slack/reply` 端點來發送訊息
    - MCP Config 結構：
      ```
      {
        command: "bun",
        args: ["run", "{scriptPath}"],
        env: {
          SLACK_APP_ID: slackAppId,
          SLACK_CHANNEL_ID: channelId,
          CALLBACK_URL: "http://localhost:3001/api/internal/slack/reply"
        }
      }
      ```
  - `getScriptPath()` 方法：
    - 回傳 `slack_reply` MCP script 的絕對路徑
  - 匯出 singleton `slackMcpToolProvider`
- [x] 建立 `backend/src/services/slack/slack-reply-mcp-server.ts`（MCP Server script）
  - 這是一個獨立執行的 Bun script，作為 MCP Server 使用
  - 使用 stdin/stdout 溝通（MCP stdio 協議）
  - 提供單一 tool：`slack_reply`
    - 參數：`text`（string，必填）、`thread_ts`（string，可選）
    - 執行邏輯：POST 到 `CALLBACK_URL` 帶 `{ slackAppId, channelId, text, threadTs }`
  - 使用 `@modelcontextprotocol/sdk` 實作（需新增此依賴，或使用最簡化的 JSON-RPC 直接實作以避免額外依賴）
  - **決定**：使用 raw JSON-RPC over stdio 實作，避免新增依賴。只需處理 `initialize`, `tools/list`, `tools/call` 三個方法

---

## 七、REST API 設計

> Slack App CRUD 操作全部走 WebSocket 事件（見第八節），REST API 只保留供 MCP Tool 使用的內部回呼端點。

### 7.1 新增 REST API 端點

- [ ] 建立 `backend/src/api/slackApi.ts`（僅含內部回呼 handler）
- [ ] 在 `backend/src/api/apiRouter.ts` 新增以下路由：

| 方法 | 路徑 | 說明 | Handler 函式 |
|------|------|------|-------------|
| POST | `/api/internal/slack/reply` | 內部端點：MCP Tool 回呼發送 Slack 訊息 | `handleSlackReplyCallback` |

### 7.2 Request / Response 格式

#### POST `/api/internal/slack/reply`（內部端點）

Request Body:
- `slackAppId`: string
- `channelId`: string
- `text`: string
- `threadTs`?: string

Response 200:
- `success`: true

Response 400/500:
- `error`: string

---

## 八、WebSocket 事件設計

### 8.1 新增 WebSocket 事件

- [ ] 建立 `backend/src/handlers/slackHandlers.ts`
- [ ] 建立 `backend/src/handlers/groups/slackHandlerGroup.ts`
- [ ] 在 `backend/src/handlers/index.ts` 註冊 `slackHandlerGroup`

#### 事件：`slack:app:create`

用途：建立 Slack App 並啟動連線

Payload:
- `name`: string（1-100 字元）
- `botToken`: string（`xoxb-` 開頭）
- `appToken`: string（`xapp-` 開頭）

處理邏輯：
1. 驗證 Payload（slackAppCreateSchema）
2. 驗證 botToken 不重複
3. 建立 SlackApp（slackAppStore.create）
4. 呼叫 slackConnectionManager.connect 啟動連線
5. 廣播 `slack:app:created` 到所有前端連線

回應事件：`slack:app:created`
- `slackApp`: `{ id, name, status, channels, botUserId }`（不回傳 token）

錯誤回應：
- `error`: string（驗證失敗原因）
- `error`: "此 Bot Token 已被註冊"（重複 token）

#### 事件：`slack:app:delete`

用途：刪除 Slack App 並斷開連線

Payload:
- `slackAppId`: string（UUID）

處理邏輯：
1. 驗證 Slack App 存在
2. 呼叫 slackConnectionManager.disconnect 斷開連線
3. 遍歷所有 canvas 的所有 Pod，清除綁定此 App 的 slackBinding
4. 清空對應 Pod 的 Slack 訊息佇列
5. 廣播 `pod:slack:unbound` 到各 canvas（有綁定的 Pod）
6. 從 slackAppStore 刪除
7. 廣播 `slack:app:deleted` 到所有前端連線

回應事件：`slack:app:deleted`
- `slackAppId`: string

錯誤回應：
- `error`: "找不到 Slack App"

#### 事件：`slack:app:list`

用途：取得所有 Slack App 清單（用於 UI）

Payload：空（或 `{}`）

回應事件：`slack:app:list:result`
- `slackApps`: `Array<{ id, name, status, channels, botUserId }>`（不回傳 token）

#### 事件：`slack:app:get`

用途：取得單一 Slack App 詳情

Payload:
- `slackAppId`: string（UUID）

回應事件：`slack:app:get:result`
- `slackApp`: `{ id, name, status, channels, botUserId }`

錯誤回應：
- `error`: "找不到 Slack App"

#### 事件：`slack:app:channels`

用途：取得 Slack App 的頻道清單（從快取讀取）

Payload:
- `slackAppId`: string（UUID）

回應事件：`slack:app:channels:result`
- `slackAppId`: string
- `channels`: `Array<{ id, name }>`

錯誤回應：
- `error`: "找不到 Slack App"

#### 事件：`slack:app:channels:refresh`

用途：重新從 Slack API 取得頻道清單並更新快取

Payload:
- `slackAppId`: string（UUID）

處理邏輯：
1. 驗證 Slack App 存在
2. 呼叫 slackConnectionManager.fetchChannels 重新取得
3. 回應更新後的頻道清單

回應事件：`slack:app:channels:refreshed`
- `slackAppId`: string
- `channels`: `Array<{ id, name }>`（重新從 Slack API 取得）

錯誤回應：
- `error`: "找不到 Slack App"

#### 事件：`pod:bind-slack`

用途：Pod 綁定 Slack App + 頻道

Payload:
- `canvasId`: string
- `podId`: string
- `slackAppId`: string
- `slackChannelId`: string

處理邏輯：
1. 驗證 Pod 存在
2. 驗證 Slack App 存在且 status 為 connected
3. 驗證 channelId 存在於 App 的 channels 中
4. 更新 Pod 的 `slackBinding` 欄位
5. 動態建立 slack_reply MCP Server 配置，並將其以特殊 ID 加入 Pod 的 mcpServerIds（或用獨立機制注入）
6. 廣播 `pod:slack:bound` 到畫布

回應事件：`pod:slack:bound`
- `canvasId`, `podId`, `slackAppId`, `slackChannelId`, `success: true`

#### 事件：`pod:unbind-slack`

用途：Pod 解綁 Slack 連線

Payload:
- `canvasId`: string
- `podId`: string

處理邏輯：
1. 驗證 Pod 存在且有 slackBinding
2. 清除 Pod 的 `slackBinding` 欄位
3. 移除 slack_reply MCP Server 配置
4. 清空該 Pod 的 Slack 訊息佇列
5. 廣播 `pod:slack:unbound` 到畫布

回應事件：`pod:slack:unbound`
- `canvasId`, `podId`, `success: true`

### 8.2 伺服器主動推送事件

#### `slack:connection:status:changed`

用途：Slack App 連線狀態變化時通知前端

Payload:
- `slackAppId`: string
- `status`: SlackAppStatus
- `error`?: string（錯誤時的訊息）

推送範圍：所有前端連線（`socketService.emitToAll`）

#### `slack:message:received`

用途：收到 Slack 訊息並注入 Pod 時通知前端

Payload:
- `canvasId`: string
- `podId`: string
- `slackAppId`: string
- `channelId`: string
- `userName`: string
- `text`: string

推送範圍：對應 canvas 的前端連線

#### `slack:message:queued`

用途：Slack 訊息因 Pod 忙碌而排隊時通知前端

Payload:
- `canvasId`: string
- `podId`: string
- `queueSize`: number
- `userName`: string
- `text`: string（截斷前 100 字）

推送範圍：對應 canvas 的前端連線

---

## 九、整合點

### 9.1 Claude Service 動態注入 slack_reply Tool

- [ ] 修改 `backend/src/services/claude/claudeService.ts` 的 `buildQueryOptions` 方法
  - 在現有 MCP Server 注入邏輯後方新增判斷：
  - 若 `pod.slackBinding` 存在，呼叫 `slackMcpToolProvider.createSlackReplyMcpConfig()`
  - 將回傳的 MCP 配置合併到 `queryOptions.mcpServers` 中（key 為 `slack_reply`）
  - 這樣 Claude 在對話時就能使用 `slack_reply` Tool

### 9.2 Slack 訊息注入 Pod Chat

- [ ] 在 `slackEventService.injectSlackMessage()` 中：
  - 使用與 `chatHandlers.ts` 的 `handleChatSend` 相同的流程
  - 呼叫 `messageStore.addMessage()` 儲存使用者訊息
  - 呼叫 `socketService.emitToCanvas()` 廣播 `POD_CHAT_USER_MESSAGE`
  - 設定 `podStore.setStatus(canvasId, podId, 'chatting')`
  - 呼叫 `executeStreamingChat()` 觸發 Claude
  - 在 `onComplete` callback 中處理佇列中的下一則訊息

### 9.3 Pod 刪除時的清理邏輯

- [ ] 修改 `backend/src/services/podService.ts` 的 `deletePodWithCleanup` 方法
  - 在現有清理邏輯後方新增：
  - 若 `pod.slackBinding` 存在，呼叫 `slackMessageQueue.clear(podId)` 清空佇列
  - 不需要斷開 Slack App 連線（連線是 App 層級的，不是 Pod 層級的）

### 9.4 Slack App 刪除時解綁所有 Pod

- [ ] 在 `slackHandlers.ts` 的 `handleSlackAppDelete` 中：
  - 呼叫 `slackConnectionManager.disconnect(slackAppId)` 斷開連線
  - 遍歷所有 canvas 的所有 Pod，找到 `slackBinding.slackAppId === slackAppId` 的 Pod
  - 對每個 Pod 清除 `slackBinding`、清空佇列
  - 廣播 `POD_SLACK_UNBOUND` 到各 canvas
  - 從 slackAppStore 刪除

### 9.5 PodStore 載入/儲存 slackBinding

- [x] 修改 `backend/src/services/podStore.ts`
  - `deserializePod()` 方法：從 persistedPod 讀取 `slackBinding`，若存在則設定到 Pod 上
  - `create()` 方法：新 Pod 不需要 slackBinding（預設沒有）
  - 持久化時 `slackBinding` 會自動跟著 Pod 物件一起序列化（現有 `persistPodAsync` 已會序列化整個 Pod 物件）
- [x] 新增 `setSlackBinding(canvasId, podId, binding: PodSlackBinding | null)` 方法到 PodStore
  - 使用現有 `modifyPod` 機制更新

### 9.6 伺服器啟動 / 關閉

- [ ] 修改 `backend/src/services/startupService.ts`
  - 在 `initialize()` 中：
    - 呼叫 `slackAppStore.loadFromDisk(config.appDataRoot)` 載入 Slack App 資料
    - 對所有已儲存的 SlackApp 呼叫 `slackConnectionManager.connect()` 恢復連線
- [ ] 修改 `backend/src/index.ts` 的 `shutdown()` 函式：
  - 呼叫 `slackConnectionManager.destroyAll()` 斷開所有 Slack 連線
  - 呼叫 `slackConnectionManager.stopHealthCheck()`

### 9.7 更新 Skill 文件

- [ ] 更新 `skill/claude-code-canvas/SKILL.md`
  - 在 REST API 端點快速索引新增內部端點 `/api/internal/slack/reply`
- [ ] 建立 `skill/claude-code-canvas/references/slack-ws.md`
  - 完整記錄所有 Slack WebSocket 事件格式與範例

---

## 十、錯誤處理與邊界情況

### 10.1 Token 驗證
- Bot Token 必須以 `xoxb-` 開頭，App-Level Token 必須以 `xapp-` 開頭
- 連線失敗時（Token 無效），設定 status 為 `'error'`，回傳具體錯誤訊息
- 不在持久化檔案中儲存 Token 的明文（目前先以明文儲存，未來可改為加密）

### 10.2 Socket Mode 連線異常
- Bolt App `start()` 失敗時，捕獲錯誤並透過 WS 回應事件回傳錯誤訊息
- 連線中斷時透過健康檢查偵測，自動觸發重連
- 重連採用指數退避：1s, 2s, 4s, 8s, 16s, 30s（上限 30 秒）
- 連續失敗超過 10 次，設定 status 為 `'error'` 並停止重連，需使用者手動重新連線

### 10.3 訊息路由邊界
- 同一個 Slack 頻道可以被多個 Pod 綁定（fan-out）
- 一個 Pod 只能綁定一個 Slack App + 一個頻道（1:1）
- Pod 綁定新的 Slack 連線時，自動解除舊的綁定
- 收到 app_mention 但沒有任何 Pod 綁定時，靜默忽略

### 10.4 佇列溢出
- 每個 Pod 佇列上限 10 則訊息
- 超過時丟棄最舊的訊息
- 前端透過 `SLACK_MESSAGE_QUEUED` 事件顯示佇列狀態

### 10.5 MCP Tool 回呼安全
- `/api/internal/slack/reply` 端點只接受來自 localhost 的請求
- 驗證 `slackAppId` 對應的 Slack App 確實存在且已連線

---

## 十一、實作步驟排序

以下步驟按照依賴關係排序，每一步完成後應可獨立測試。

### Phase 1：資料層（無外部依賴）

- [x] 1. 建立 `backend/src/types/slack.ts`（型別定義）
  - 定義 `SlackAppStatus`, `SlackChannel`, `SlackApp`, `PodSlackBinding`, `SlackQueueMessage`, `PersistedSlackApp`
  - 在 `backend/src/types/index.ts` 新增 export
- [x] 2. 修改 `backend/src/types/pod.ts`
  - 在 `Pod` 介面新增 `slackBinding?: PodSlackBinding` 欄位
  - import `PodSlackBinding`
- [x] 3. 建立 `backend/src/schemas/slackSchemas.ts`（Zod Schema）
  - 定義所有 Slack 相關的驗證 schema 和 payload 型別
  - 在 `backend/src/schemas/index.ts` 新增 export
- [x] 4. 在 `backend/src/schemas/events.ts` 新增 Slack 相關事件常數
  - `WebSocketRequestEvents`：`SLACK_APP_CREATE`, `SLACK_APP_DELETE`, `SLACK_APP_LIST`, `SLACK_APP_GET`, `SLACK_APP_CHANNELS`, `SLACK_APP_CHANNELS_REFRESH`, `POD_BIND_SLACK`, `POD_UNBIND_SLACK`
  - `WebSocketResponseEvents`：`SLACK_APP_CREATED`, `SLACK_APP_DELETED`, `SLACK_APP_LIST_RESULT`, `SLACK_APP_GET_RESULT`, `SLACK_APP_CHANNELS_RESULT`, `SLACK_APP_CHANNELS_REFRESHED`, `POD_SLACK_BOUND`, `POD_SLACK_UNBOUND`, `SLACK_CONNECTION_STATUS_CHANGED`, `SLACK_MESSAGE_RECEIVED`, `SLACK_MESSAGE_QUEUED`
- [x] 5. 建立 `backend/src/services/slack/slackMessageQueue.ts`
  - 實作 `SlackMessageQueue` 類別（純記憶體佇列，無外部依賴）
- [x] 6. 建立 `backend/src/services/slack/slackAppStore.ts`
  - 實作 `SlackAppStore` 類別（CRUD + 持久化）
  - 使用 `WriteQueue` 和 `persistenceService`
- [x] 7. 修改 `backend/src/services/podStore.ts`
  - `deserializePod()`：讀取 `slackBinding` 欄位
  - 新增 `setSlackBinding()` 方法
  - 新增 `findBySlackApp(slackAppId)` 方法（全域搜尋）

### Phase 2：單元測試（Phase 1 完成後）

- [x] 8. 撰寫 `backend/tests/unit/slackAppStore.test.ts`
- [x] 9. 撰寫 `backend/tests/unit/slackMessageQueue.test.ts`

### Phase 3：Slack 連線層（需要安裝 `@slack/bolt`）

- [x] 10. 安裝 `@slack/bolt` 依賴
  - 執行 `cd backend && bun add @slack/bolt`
- [x] 11. 建立 `backend/src/services/slack/slackConnectionManager.ts`
  - 實作 Bolt App 建立、Socket Mode 連線、斷開、健康檢查、重連
- [x] 12. 建立 `backend/src/services/slack/slack-reply-mcp-server.ts`
  - 實作 MCP stdio server script（raw JSON-RPC）
  - 提供 `slack_reply` tool
- [x] 13. 建立 `backend/src/services/slack/slackMcpToolProvider.ts`
  - 實作 MCP 配置生成
- [x] 14. 撰寫 `backend/tests/unit/slackConnectionManager.test.ts`
  - mock `@slack/bolt` 的 App 類別

### Phase 4：事件處理層

- [ ] 15. 建立 `backend/src/services/slack/slackEventService.ts`
  - 實作 app_mention 事件處理、訊息路由、訊息注入、佇列處理

### Phase 5：WebSocket Handler 與 REST 內部端點

- [ ] 16. 建立 `backend/src/handlers/slackHandlers.ts`
  - 實作 `handleSlackAppCreate`, `handleSlackAppDelete`, `handleSlackAppList`, `handleSlackAppGet`, `handleSlackAppChannels`, `handleSlackAppChannelsRefresh`, `handlePodBindSlack`, `handlePodUnbindSlack`
- [ ] 17. 建立 `backend/src/handlers/groups/slackHandlerGroup.ts`
  - 註冊所有 Slack 事件到 handler group
- [ ] 18. 修改 `backend/src/handlers/index.ts`
  - import 並註冊 `slackHandlerGroup`
- [ ] 19. 建立 `backend/src/api/slackApi.ts`
  - 實作 `handleSlackReplyCallback`（MCP Tool 內部回呼端點）
- [ ] 20. 修改 `backend/src/api/apiRouter.ts`
  - 新增 1 條路由：`POST /api/internal/slack/reply`

### Phase 6：整合點修改

- [ ] 21. 修改 `backend/src/services/claude/claudeService.ts`
  - 在 `buildQueryOptions()` 中注入 slack_reply MCP Server
- [ ] 22. 修改 `backend/src/services/podService.ts`
  - 在 `deletePodWithCleanup()` 中清理 Slack 佇列
- [ ] 23. 修改 `backend/src/services/startupService.ts`
  - 啟動時載入 Slack App 並恢復連線
- [ ] 24. 修改 `backend/src/index.ts`
  - 關閉時銷毀 Slack 連線

### Phase 7：整合測試

- [ ] 25. 撰寫 `backend/tests/integration/slack.test.ts`
  - 測試 WebSocket CRUD 事件（create/delete/list/get/channels/channels:refresh）
  - 測試 WebSocket 綁定/解綁事件（pod:bind-slack / pod:unbind-slack）
  - 測試 Pod 刪除時的清理

### Phase 8：文件更新

- [ ] 26. 更新 `skill/claude-code-canvas/SKILL.md`
  - 新增內部端點 `/api/internal/slack/reply` 到 REST API 快速索引
- [ ] 27. 建立 `skill/claude-code-canvas/references/slack-ws.md`
  - 完整記錄所有 Slack WebSocket 事件格式與範例
