# Provider 新增指南

## 核心概念

### 為什麼要有 Provider 抽象？

本系統的 AI Agent 執行路徑統一由 `streamingChatExecutor` 驅動，透過 `AgentProvider<TOptions>` 介面隔離各 AI 的實作細節。

**「任何一個 AI 不影響另一個 AI」**：

- Claude 有 OutputStyle、MCP Server、Plugin、Integration 等豐富能力
- Codex 只支援基本聊天，透過 CLI subprocess 執行

兩者走完全相同的執行路徑（`provider.buildOptions` → `provider.chat`），executor 完全不知道裡面是 SDK 還是 subprocess。

新增第三個 Provider 時，**executor、chatHandlers、abortRegistry 完全不需要改動**。

### 關鍵設計決策

| 概念 | 說明 |
|---|---|
| `Pod.providerConfig` | **儲存型別**（DB wire 格式），平坦結構 `{ model: string }`，DB schema 不動 |
| `ChatRequestContext.options: TOptions` | **執行時型別**，由 `buildOptions` 輸出，僅存在於記憶體中，每個 provider 形狀不同 |
| `abortRegistry` | 全站唯一的 AbortController 來源，以 queryKey 隔離各 Pod |
| session 回報 | 透過 `yield { type: "session_started", sessionId }` NormalizedEvent，executor 消化後呼叫 `strategy.onSessionInit` |

---

## 檔案結構

```
backend/src/services/provider/
├── README.md                  ← 本文件
├── types.ts                   ← AgentProvider、NormalizedEvent、ChatRequestContext 定義
├── types.md                   ← 型別契約說明文件
├── capabilities.ts            ← CLAUDE_CAPABILITIES、CODEX_CAPABILITIES
├── index.ts                   ← providerRegistry、getProvider、ProviderName 型別
├── abortRegistry.ts           ← 全站 AbortController 管理
├── claudeProvider.ts          ← Claude Provider 實作
├── claudeProvider.md          ← Claude 獨有行為說明
├── codexProvider.ts           ← Codex Provider 實作
├── codexProvider.md           ← Codex 獨有行為說明
└── claude/                    ← Claude 子模組
    ├── buildClaudeOptions.ts  ← 選項建構（OutputStyle / MCP / Plugin / Integration）
    ├── runClaudeQuery.ts      ← SDK 呼叫 + SDKMessage → NormalizedEvent 轉換
    └── sessionRetry.ts        ← Session resume 失敗自動重試
```

**新增一個 Provider** 時只需要動以下位置：

```
backend/src/services/provider/
├── capabilities.ts            ← 新增 XXX_CAPABILITIES
├── xxxProvider.ts             ← 新增 Provider 實作（主要工作）
├── xxxProvider.md             ← 新增說明文件
└── index.ts                   ← 在 providerRegistry 加 key

backend/tests/provider/
├── xxxProvider.test.ts              ← chat() 測試
└── xxxProviderBuildOptions.test.ts  ← buildOptions() 測試
```

---

## Step-by-step Checklist

### 步驟 1：在 `capabilities.ts` 新增能力矩陣

```ts
// capabilities.ts

/** MyAI Provider 支援的功能 */
export const MYAI_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  chat: true,
  outputStyle: false,   // 不支援的能力設 false
  skill: false,
  subAgent: false,
  repository: false,
  command: false,
  mcp: false,
  integration: false,
  runMode: false,
});
```

`ProviderCapabilities` 每個欄位的意義詳見 `types.md`。

### 步驟 2：新增 `xxxProvider.ts`，實作 Provider 介面

```ts
// myaiProvider.ts

import { MYAI_CAPABILITIES } from "./capabilities.js";
import type { AgentProvider, ChatRequestContext, NormalizedEvent, ProviderMetadata } from "./types.js";
import type { Pod } from "../../types/pod.js";
import type { RunContext } from "../../types/run.js";

// 1. 定義執行時選項介面
export interface MyAIOptions {
  model: string;
  // ... 其他 Provider 獨有欄位
}

// 2. 實作 Provider 物件（或 class）
export const myaiProvider: AgentProvider<MyAIOptions> = {
  // 3. 宣告 metadata（name / capabilities / defaultOptions）
  metadata: {
    name: "myai",   // 對應 index.ts 的 key
    capabilities: MYAI_CAPABILITIES,
    defaultOptions: {
      model: "myai-default-model",
    },
  } satisfies ProviderMetadata<MyAIOptions>,

  // 4. 實作 buildOptions：從 Pod 設定建構執行時選項
  async buildOptions(pod: Pod, runContext?: RunContext): Promise<MyAIOptions> {
    const model =
      typeof pod.providerConfig?.model === "string" && pod.providerConfig.model
        ? pod.providerConfig.model
        : this.metadata.defaultOptions.model;

    return { model };
  },

  // 5. 實作 chat：呼叫 AI、yield NormalizedEvent
  async *chat(ctx: ChatRequestContext<MyAIOptions>): AsyncIterable<NormalizedEvent> {
    const { podId, message, workspacePath, resumeSessionId, abortSignal, options } = ctx;

    // ⚠️ 必須消費 abortSignal，不要自建 AbortController
    abortSignal.addEventListener("abort", () => {
      // 中斷 I/O（如：kill subprocess、abort fetch）
    }, { once: true });

    // 呼叫 AI、轉換格式
    yield { type: "session_started", sessionId: "new-session-id" };
    yield { type: "text", content: "Hello from MyAI" };
    yield { type: "turn_complete" };
  },
};
```

### 步驟 3：在 `index.ts` 的 `providerRegistry` 加一個 key

```ts
// index.ts

import { myaiProvider } from "./myaiProvider.js";

export const providerRegistry = {
  claude: claudeProvider,
  codex: codexProvider,
  myai: myaiProvider,  // ← 加這行
} as const;

// ProviderName 自動從 registry key 推導為 "claude" | "codex" | "myai"
export type ProviderName = keyof typeof providerRegistry;
```

TypeScript 會自動將 `ProviderName` 擴展為包含新 key，**不需要手動修改其他任何型別定義**。

### 步驟 4：新增測試

**`tests/provider/myaiProvider.test.ts`**（測試 `chat()`）：

```ts
describe("MyAIProvider", () => {
  it("正常對話產生 session_started → text → turn_complete", async () => {
    // mock AI 呼叫（subprocess、HTTP client 等）
    // 驗證 NormalizedEvent 序列
  });

  it("abortSignal 觸發時 stream 正常結束", async () => {
    // 驗證 abort 不會拋出未捕捉錯誤
  });

  it("錯誤時產生 error event", async () => {
    // 驗證 fatal 欄位
  });
});
```

**`tests/provider/myaiProviderBuildOptions.test.ts`**（測試 `buildOptions()`）：

```ts
describe("MyAIProvider.buildOptions()", () => {
  it("空 providerConfig → 回傳 metadata.defaultOptions", async () => { ... });
  it("providerConfig.model 合法 → 採用之", async () => { ... });
  it("providerConfig.model 不合法 → fallback 為 default", async () => { ... });
});
```

### 步驟 5：新增 `xxxProvider.md`

說明 Provider 獨有的行為細節（CLI 指令格式、SDK 呼叫流程、Resume 機制、Abort 方式、Security 考量等）。

### 不需要動的檔案

下列檔案**完全不需要修改**：

- `backend/src/services/claude/streamingChatExecutor.ts` — executor 只呼叫 `provider.chat(ctx)`，與具體 provider 無關
- `backend/src/handlers/chatHandlers.ts` — 取得 provider 用 `getProvider(pod.provider)`，自動支援新 key
- `backend/src/services/provider/abortRegistry.ts` — abort 邏輯獨立於 provider 實作
- **前端 Pod 類型選單** — 前端透過 `provider:list` 拿到 `providerRegistry` 的完整清單（含 `defaultOptions`），自動顯示新 provider

---

## 常見陷阱

### 1. `buildOptions` 必須是 async

介面規定 `buildOptions` 回傳 `Promise<TOptions>`，即使你的實作不需要 async，也要寫成：

```ts
async buildOptions(pod: Pod): Promise<MyAIOptions> {
  return { model: pod.providerConfig?.model ?? "default" };
}
```

原因：統一讓 executor 不必判斷 union 型別；Claude 的 `buildClaudeOptions` 需要 async 呼叫 `outputStyleService.getContent`，設計上統一為 async。

### 2. `chat(ctx)` 必須消費 `ctx.abortSignal`

**錯誤做法**：自己建立 `AbortController`

```ts
// ❌ 錯誤：不要自建 AbortController
const ac = new AbortController();
fetch(url, { signal: ac.signal });
```

**正確做法**：監聽 `ctx.abortSignal`

```ts
// ✓ 正確：消費外部傳入的 signal
ctx.abortSignal.addEventListener("abort", () => { /* 中斷 I/O */ }, { once: true });
```

`abortSignal` 由 `abortRegistry` 統一管理，確保多 Pod 同時中止時彼此不干擾。

### 3. session 回報用 NormalizedEvent，不用 callback

**錯誤做法**：呼叫 `podStore.setSessionId`

```ts
// ❌ 錯誤：Provider 不應直接寫 DB
await podStore.setSessionId(podId, sessionId);
```

**正確做法**：yield `session_started` NormalizedEvent

```ts
// ✓ 正確：yield 事件，由 executor 消化並呼叫 strategy.onSessionInit
yield { type: "session_started", sessionId };
```

executor 在 for-await loop 中消化 `session_started` 事件並呼叫 `strategy.onSessionInit(sessionId)` 完成持久化。

### 4. `runContext` 參數位要保留（可為 undefined）

`buildOptions` 的簽名是 `(pod: Pod, runContext?: RunContext): Promise<TOptions>`。

即使你的 Provider 目前不使用 `runContext`，參數位也要保留（加 `_runContext?: RunContext`），以符合介面規範：

```ts
async buildOptions(pod: Pod, _runContext?: RunContext): Promise<MyAIOptions> {
  // 目前不使用 runContext
  return { model: pod.providerConfig?.model ?? this.metadata.defaultOptions.model };
}
```

---

## 參考實作

### Claude（複雜版，子模組拆解）

`claudeProvider.ts` 是完整能力的參考實作：

- `buildOptions` 委派給 `claude/buildClaudeOptions.ts`，涵蓋 OutputStyle / MCP / Plugin / Integration 全部邏輯
- `chat` 委派給 `claude/sessionRetry.ts`（包裝 `claude/runClaudeQuery.ts`），支援 session resume 失敗後自動重試
- 子模組拆解讓各功能獨立可測

### Codex（簡單版，subprocess）

`codexProvider.ts` 是最簡潔的參考實作：

- `buildOptions`：從 `pod.providerConfig.model` 取 model，通過 MODEL_RE 驗證後回傳 `CodexOptions`
- `chat`：spawn `codex exec` subprocess，監聽 stdout JSON line → `normalize()` → yield NormalizedEvent
- abort：`ctx.abortSignal.addEventListener('abort', () => proc.kill())`
- Security：env 白名單、MODEL_RE / SESSION_ID_RE 防 CLI 旗標注入、stderr 遮蔽

詳見各自的 `*Provider.md` 說明文件。
