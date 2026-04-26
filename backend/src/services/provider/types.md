# Provider 型別契約

本文件說明 `types.ts` 中各介面的責任邊界與使用規範。

---

## `AgentProvider<TOptions>` 契約

```ts
interface AgentProvider<TOptions = unknown> {
  metadata: ProviderMetadata<TOptions>;
  buildOptions(pod: Pod, runContext?: RunContext): Promise<TOptions>;
  chat(ctx: ChatRequestContext<TOptions>): AsyncIterable<NormalizedEvent>;
}
```

### `metadata: ProviderMetadata<TOptions>`

Provider 的靜態描述，系統啟動時就確定，不會隨請求改變。

- 不應在 `chat()` 執行中途修改
- `defaultOptions` 會廣播給前端（透過 `provider:list` WS 事件），前端用此在新建 Pod 時顯示預設模型

### `buildOptions(pod, runContext?): Promise<TOptions>`

從 Pod 的持久化設定與 RunContext 建構**執行時選項**。

**責任**：
- 讀取 `pod.providerConfig`、`pod.mcpServerIds` 等 Pod 設定
- 呼叫外部 service 取得設定內容
- 回傳完整的 `TOptions`，executor 直接傳入 `chat(ctx)` 使用

**規範**：
- 簽名固定為 `Promise<TOptions>`（即使內部不需要 async），統一讓 executor 不必判斷型別
- `runContext` 為可選參數，executor 呼叫時無論 Run 模式與否都會傳入（可能為 undefined）
- 不應在此直接執行 AI 呼叫或寫 DB

### `chat(ctx): AsyncIterable<NormalizedEvent>`

發起 AI 對話，以 async generator 形式產出 `NormalizedEvent` 串流。

**責任**：
- 消費 `ctx.abortSignal`（必須），不要自建 `AbortController`
- 在 session 建立時 yield `session_started` NormalizedEvent
- 正常結束時 yield `turn_complete`
- 錯誤時 yield `error` NormalizedEvent（不應拋出未捕捉的 Error 讓 executor 無法處理）

**規範**：
- 不應呼叫 `podStore.setSessionId`，session 持久化由 executor 透過 `session_started` 事件完成
- 不應在 `chat` 內再次呼叫 `buildOptions`，`ctx.options` 已經是建構好的選項

---

## `NormalizedEvent` Discriminated Union

所有 Provider 的串流輸出統一為此格式，executor 與前端共用。

```ts
type NormalizedEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call_start"; toolUseId: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool_call_result"; toolUseId: string; toolName: string; output: string }
  | { type: "turn_complete" }
  | { type: "error"; message: string; fatal: boolean };
```

### 各 type 的意義與產出時機

| type | 意義 | 產出時機 |
|---|---|---|
| `session_started` | Session 建立完成 | AI 回應第一個 `system/init` 或等效訊息時；executor 消化此事件並呼叫 `strategy.onSessionInit(sessionId)` 完成持久化 |
| `text` | AI 回應的文字片段 | 收到 assistant message 的 text block 時；可能分多次 yield（streaming 分批） |
| `thinking` | AI 的思考過程（思維鏈） | 收到 thinking block 時（若 SDK 支援） |
| `tool_call_start` | AI 開始呼叫工具 | 收到 assistant message 的 tool_use block 時 |
| `tool_call_result` | 工具執行結果 | 收到 user message 的 tool_result block 或 tool_progress 訊息時 |
| `turn_complete` | 這一輪對話結束 | AI 回應 result/success 或等效完成訊息時 |
| `error` | 發生錯誤 | 任何不可忽略的錯誤（rate limit、auth 失敗、session 錯誤等） |

### `error` 的 `fatal` 欄位

- `fatal: true`：嚴重錯誤，此 Pod 的對話無法繼續（如 spawn 失敗、auth 失敗）；前端可能需要顯示明顯提示
- `fatal: false`：可恢復的錯誤，串流結束但 Pod 仍可繼續新對話（如 exit code 非 0 但已完成部分輸出）

---

## `ChatRequestContext<TOptions>` 欄位

```ts
interface ChatRequestContext<TOptions = unknown> {
  podId: string;
  message: string | ContentBlock[];
  workspacePath: string;
  resumeSessionId: string | null;
  abortSignal: AbortSignal;
  runContext?: RunContext;
  options?: TOptions;
}
```

### executor 提供的欄位

| 欄位 | 來源 | 說明 |
|---|---|---|
| `podId` | Pod 資料 | Pod 的唯一識別 ID |
| `message` | 前端傳入的訊息 | 文字字串或包含圖片的 ContentBlock 陣列 |
| `workspacePath` | `resolveWorkspacePath(pod, runContext)` | 已解析的工作目錄（Run 模式下為 worktree 路徑） |
| `resumeSessionId` | podStore | `null` 代表新對話；非 null 代表要接續的 session ID |
| `abortSignal` | `abortRegistry.register(queryKey).signal` | Provider 必須聆聽此 signal 並中斷 I/O |
| `runContext` | executor 傳入 | Run 模式才有；包含 `runId`、`instanceId`、`worktreePath` 等 |
| `options` | `provider.buildOptions(pod, runContext)` | 執行時選項，型別由 provider 決定 |

### `resumeSessionId`

- `null`：全新對話，Provider 不帶 resume 參數呼叫 AI
- 非 null：嘗試接續先前的 session；若 AI 回報 session 已過期，Provider 可自行重試（如 `sessionRetry.ts`）

### `abortSignal`

- 由 `abortRegistry` 統一管理，以 queryKey 隔離各 Pod（normal：`podId`；run：`${runId}:${podId}`）
- Provider **必須**監聽此 signal，在收到 abort 時中斷所有 I/O（關閉 SDK stream、kill subprocess 等）
- **不要**自建 `AbortController`；使用外部傳入的 signal 確保多 Pod 中止時彼此隔離

### `runContext`

- 僅在 Run 模式（`pod.multiInstance = true` 的 workflow 執行）下存在
- `buildOptions` 也會收到相同的 `runContext`（用於 Integration Tool 的 reply closure 定址）
- Provider 可透過 `runContext.runId` 決定 queryKey 命名（Run 模式：`${runId}:${podId}`）

### 不包含 `onSessionInit` callback

原本 Claude 走 callback 通報 session 建立，Codex 走 `session_started` NormalizedEvent。**現已統一**：

Provider 遇到 session 建立時只 `yield { type: "session_started", sessionId }` NormalizedEvent，由 executor 在 for-await loop 內消化並呼叫 `strategy.onSessionInit(sessionId)` 完成持久化。

---

## `ProviderMetadata<TOptions>` 契約

```ts
interface ProviderMetadata<TOptions = unknown> {
  name: ProviderName;
  capabilities: ProviderCapabilities;
  defaultOptions: TOptions;
}
```

### `name`

對應 `providerRegistry` 的 key（如 `"claude"`、`"codex"`）。

### `capabilities: ProviderCapabilities`

功能能力矩陣，前端依此決定顯示哪些設定選項（MCP 等）。

```ts
interface ProviderCapabilities {
  chat: boolean;        // 基本聊天（應永遠為 true）
  skill: boolean;       // Skill（Command）功能
  repository: boolean;  // Repository 綁定
  command: boolean;     // Command 設定
  mcp: boolean;         // MCP Server 功能
  integration: boolean; // Integration Tool 功能
  runMode: boolean;     // 支援 Run 模式（多 Pod workflow 執行）
}
```

### `defaultOptions: TOptions`

Provider 的預設執行時選項，有兩個用途：

1. **前端顯示**：透過 `provider:list` WS 事件廣播給前端，前端可取 `defaultOptions.model` 顯示新建 Pod 時的預設模型
2. **fallback**：`buildOptions` 若 Pod 設定不完整（如舊資料缺欄位），可回退到 `metadata.defaultOptions`

### `TOptions` vs `Pod.providerConfig` 的區別

| | `Pod.providerConfig` | `ChatRequestContext.options: TOptions` |
|---|---|---|
| 性質 | **儲存型別**（DB wire 格式） | **執行時型別**（記憶體中） |
| 形狀 | 固定為平坦 `{ model: string }` | 每個 provider 自定義（`ClaudeOptions` / `CodexOptions`） |
| 生命週期 | 持久化在 DB | 僅在一次 chat 請求中存在 |
| 誰建構 | 前端 / podStore | `buildOptions(pod, runContext)` |
| 抽象隔離 | 不動（DB schema 穩定） | 在此層發生（各 provider 的獨有能力） |
