# Claude Provider 行為說明

## 總覽

`claudeProvider` 透過 Anthropic Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）執行 AI 查詢，支援 Claude 全部的獨有能力：MCP Server、Plugin、Integration Tool、Sub-Agent、Repository、Session Resume/Retry、Run 模式。

實作分為三個子模組 + 一個主模組：

```
claudeProvider.ts          ← 主模組（組裝 metadata、委派 buildOptions / chat）
claude/
├── buildClaudeOptions.ts  ← 選項建構（從 Pod 設定組裝 ClaudeOptions）
├── runClaudeQuery.ts      ← SDK 呼叫 + SDKMessage → NormalizedEvent 轉換
└── sessionRetry.ts        ← Session resume 失敗時的自動重試包裝
```

---

## SDK 呼叫流程

```
chat(ctx)
  └── withSessionRetry(ctx)                     # sessionRetry.ts
        └── runClaudeQuery(ctx)                 # runClaudeQuery.ts
              ├── buildPrompt(message, ...)      # 組裝 SDK prompt
              ├── query({ prompt, options })     # 呼叫 SDK
              └── for await sdkMessage:
                    dispatchSDKMessage → yield NormalizedEvent
```

### 1. 組裝 prompt

`buildPrompt(message, resumeSessionId)` 根據 message 型別：

- `string`：直接使用（Command 展開已在上層 `streamingChatExecutor` 完成，Provider 不再處理 `/name` 前綴）
- `ContentBlock[]`：呼叫 `buildClaudeContentBlocks` 轉換，再包入 `createUserMessageStream`（支援圖片附件）

### 2. 組裝 SDK Options

`runClaudeQuery` 將 `ClaudeOptions` 展開為 SDK 的 `Options` 格式：

```ts
const sdkOptions: Options = {
  cwd: ctx.workspacePath,        // 由 executor 透過 resolveWorkspacePath 解析後傳入
  settingSources: ["project"],
  permissionMode: "bypassPermissions",
  includePartialMessages: true,
  pathToClaudeCodeExecutable: ...,
  allowedTools: options.allowedTools,
  model: options.model,
  abortController: new AbortController(),
  // 以下為 Pod 設定衍生：
  mcpServers: options.mcpServers,       // 來自 MCP Server + Integration Tool
  plugins: options.plugins,             // 來自 Plugin
  resume: ctx.resumeSessionId,          // 來自 Pod session
};
```

### 3. 消費 SDK 串流

```ts
for await (const sdkMessage of query({ prompt, options: sdkOptions })) {
  yield* dispatchSDKMessage(sdkMessage, state);
}
```

`dispatchSDKMessage` 依 `sdkMessage.type` 分派至各處理器（詳見下方「SDKMessage 對應表」）。

### SDKMessage → NormalizedEvent 對應表

| SDKMessage | NormalizedEvent |
|---|---|
| `system/init` | `session_started`（含 `session_id`） |
| `system/api_retry` | `text`（重試通知文字） |
| `assistant`（text block） | `text` |
| `assistant`（tool_use block） | `tool_call_start` |
| `assistant`（error field） | `text`（錯誤文字）+ 拋出 Error |
| `user`（tool_result block） | `tool_call_result` |
| `tool_progress`（含 output） | `tool_call_result` |
| `result/success` | `turn_complete` |
| `result/error` | `text`（錯誤文字）+ 拋出 Error |
| `rate_limit_event`（拒絕） | `text`（帳戶用量提示）+ 拋出 Error |
| `auth_status`（錯誤） | `text`（認證錯誤提示）+ 拋出 Error |

---

## 子模組說明

### `buildClaudeOptions.ts`

**職責**：從 Pod 設定組裝完整的 `ClaudeOptions`（執行時選項）。

匯出：
- `ClaudeOptions` — 執行時選項介面
- `BASE_ALLOWED_TOOLS` — 預設允許工具清單（Read/Write/Edit/Bash/Glob/Grep/Skill/WebSearch）
- `buildClaudeOptions(pod, runContext?)` — 主要建構函式
- `resolvePodCwd(pod)` — 解析 Pod 的工作目錄

合併順序：

```
1. buildBaseOptions（固定 SDK 設定）
2. applyMcpServers（mcpServers）
3. applyIntegrationToolOptions（追加 mcpServers + allowedTools）
4. applyPlugins（plugins）
5. model（來自 pod.providerConfig.model 或 "opus" fallback）
```

注意：`ClaudeOptions.cwd` 在 `buildOptions` 階段為 `undefined`，由 `runClaudeQuery` 在組裝 SDK Options 時從 `ctx.workspacePath` 填入。

### `runClaudeQuery.ts`

**職責**：呼叫 Claude SDK `query()`，將 SDKMessage 轉換為 NormalizedEvent 串流。

- 不處理 session retry，由 `sessionRetry.ts` 包裝此函式來完成
- 消費 `ctx.abortSignal`：橋接到 SDK 的 `abortController`
- 串流結束後若 `abortSignal.aborted` 為 true，拋出 `AbortError`（防禦性檢查）

### `sessionRetry.ts`

**職責**：包裝 `runClaudeQuery`，處理 resume session 失敗後的自動重試。

重試邏輯：

```
第一次：帶 resumeSessionId 執行 runClaudeQuery
  成功 → 結束
  拋出 AbortError → 向上拋出（正常中止）
  錯誤且含 "session"/"resume" 關鍵字 → 第二次：清除 resumeSessionId 重試
  其他錯誤 → yield error event 並終止

第二次：resumeSessionId = null 執行 runClaudeQuery
  成功 → 結束
  拋出 AbortError → 向上拋出
  任何錯誤 → yield error event 並終止（不再重試）
```

---

## MCP Server 套用

`pod.mcpServerIds` → `mcpServerStore.getByIds(mcpServerIds)` → `ClaudeOptions.mcpServers`

- `mcpServers` 為物件格式：`{ [serverName]: serverConfig }`
- 多個 MCP Server 合併為一個 mcpServers 物件
- Integration Tool 的 reply server 也會加入此物件（見下方）

## Plugin 套用

`pod.pluginIds` → `scanInstalledPlugins()` → 過濾已安裝的 Plugin → `ClaudeOptions.plugins`

- `scanInstalledPlugins` 從 `~/.claude/plugins/installed_plugins.json` 讀取已安裝 Plugin
- 只有 `pod.pluginIds` 中存在且已安裝的 Plugin 才會被加入
- Plugin 格式：`{ type: "local", path: plugin.installPath }`

## Integration Tool 套用

`pod.integrationBindings` → 為每個 binding 建立 MCP reply server → 追加 `mcpServers` + `allowedTools`

### 流程

1. 對每個 `integrationBinding`，從 `integrationRegistry` 取得 provider
2. 建立 MCP reply tool（使用 `tool()` + `createSdkMcpServer()`）
3. Reply tool 的 closure 透過 `replyContextStore.get(buildReplyContextKey(runContext, podId))` 取得回覆上下文
4. server 命名為 `${binding.provider}-reply`，tool 命名為 `${binding.provider}_reply`
5. `allowedTools` 加入 `mcp__${serverName}__${toolName}`

### 注意

`buildIntegrationTool` 的 closure 依賴 `runContext` 才能定址正確的 `replyContextStore` 條目，因此：
- `buildClaudeOptions(pod, runContext?)` 必須收 `runContext` 參數
- `AgentProvider.buildOptions` 介面同樣設計為 `(pod, runContext?)` 簽名

## Repository / cwd 解析

`resolvePodCwd(pod)` 解析工作目錄：

- 有 `repositoryId` → `config.repositoriesRoot / repositoryId`（驗證路徑在 `repositoriesRoot` 內）
- 否則 → `pod.workspacePath`（驗證路徑在 `canvasRoot` 內）

兩者都有路徑安全驗證（`isPathWithinDirectory`），防止目錄遍歷攻擊。

**注意**：實際傳入 SDK 的 `cwd` 是 `ctx.workspacePath`（由 executor 呼叫 `resolveWorkspacePath` 解析，Run 模式下使用 worktree 路徑），而非 `resolvePodCwd` 的結果。`resolvePodCwd` 主要用於驗證路徑合法性。

---

## Session Resume / Retry

### 正常 Resume

1. executor 從 `pod.sessionId` 取得 `resumeSessionId`
2. 傳入 `ctx.resumeSessionId`
3. `runClaudeQuery` 設定 `sdkOptions.resume = resumeSessionId`
4. SDK 接續先前 session

### Session 失敗重試（`sessionRetry.ts`）

當 SDK 拋出錯誤且錯誤訊息含 `"session"` 或 `"resume"` 關鍵字時：

1. 清除 `resumeSessionId`（設為 null）
2. 重跑 `runClaudeQuery`（新對話模式）
3. 最多重試一次，避免無限迴圈

### Run 模式差異

Run 模式（帶 `ctx.runContext`）下：

- 不清除 Pod 全域 session（`podStore.resetClaudeSession` 不在此呼叫）
- session 持久化由 executor 透過 `session_started` 事件消化後呼叫 `strategy.onSessionInit(sessionId)` 完成

---

## Abort 機制

### `ctx.abortSignal` → SDK `abortController`

`runClaudeQuery` 橋接外部 signal 至 SDK：

```ts
const sdkOptions = { abortController: new AbortController(), ... };

if (abortSignal.aborted) {
  sdkOptions.abortController.abort();
} else {
  abortSignal.addEventListener("abort", () => sdkOptions.abortController.abort(), { once: true });
}
```

- 若 signal 已 aborted（呼叫前就中止），立即 abort SDK controller
- 否則監聽 `abort` 事件，觸發時轉接至 SDK

### 觸發來源

```
前端發送 abort WS 訊息
  → chatHandlers.ts 呼叫 abortRegistry.abort(podId)
    → abortRegistry 找到對應 AbortController 並 abort
      → signal 觸發 → runClaudeQuery 將 abort 轉接給 SDK
        → SDK 停止串流
```

---

## Run 模式

### queryKey 命名

- Normal 模式：`podId`（如 `"pod-abc123"`）
- Run 模式：`${runId}:${podId}`（如 `"run-001:pod-abc123"`）

這確保多 Pod 在 Run 模式下同時執行時，abort 操作能精確定址到特定 Pod 的特定 Run。

### workspacePath 解析

Run 模式下，executor 呼叫 `resolveWorkspacePath(pod, runContext)`：

- `runContext.instance.worktreePath` 有值 → 使用 worktree 路徑（Git worktree 隔離）
- 否則 → 使用 `pod.workspacePath`

此邏輯在 `backend/src/services/runtime/workspacePath.ts` 中，為所有 provider 共用。

---

## 重要常數

| 常數 | 值 | 說明 |
|---|---|---|
| `metadata.defaultOptions.model` | `"opus"` | Claude 預設模型 |
| `BASE_ALLOWED_TOOLS` | `["Read","Write","Edit","Bash","Glob","Grep","Skill","WebSearch"]` | Claude 預設允許的工具 |
| `settingSources` | `["project"]` | SDK 設定來源（讀取專案 .claude 設定） |
| `permissionMode` | `"bypassPermissions"` | SDK 權限模式（繞過工具使用確認） |
| `includePartialMessages` | `true` | 串流中包含部分訊息 |
