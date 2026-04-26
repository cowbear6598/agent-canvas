# Codex Provider 行為說明

## 總覽

`codexProvider` 透過 `codex exec` CLI subprocess 執行 OpenAI Codex，將其 JSON line 輸出轉換為 `NormalizedEvent` 串流。

這是最簡潔的 Provider 實作，適合作為新增 Provider 的參考範本（subprocess 模式）。

---

## CLI 呼叫流程

```
chat(ctx)
  ├── buildCodexArgs(resumeSessionId, model)  # 組合 CLI 參數
  ├── buildPromptText(message)                # 組合 stdin 文字
  ├── spawnCodexProcess(args, workspacePath)  # 啟動 subprocess
  └── streamCodexOutput(proc, prompt, ...)    # 讀取 stdout → NormalizedEvent
```

### CLI 指令格式

**新對話**：
```
codex exec - --json --yolo --skip-git-repo-check --model <model>
```

**恢復對話**（resumeSessionId 存在且格式合法時）：
```
codex exec resume <sessionId> - --json --yolo
```

- `-`：從 stdin 讀取 prompt
- `--json`：輸出 JSON line 格式
- `--yolo`：跳過確認提示
- `--skip-git-repo-check`：跳過 git repo 檢查（新對話時）
- `--model`：指定模型（**resume 時不帶此參數**，由 session 決定）

---

## Resume 模式

### `resumeMode: "cli"` 的意義

`CodexOptions.resumeMode = "cli"` 表示 Codex 的 session resume 透過 CLI 的 `resume <id>` 子命令實作（非 SDK 層 API）。

目前只有 `"cli"` 一種 resume 模式，此欄位保留為未來擴充預留空間（如未來 Codex 支援 API level resume）。

### Resume 流程

1. executor 從 `pod.sessionId` 取得 `resumeSessionId`，傳入 `ctx.resumeSessionId`
2. `buildCodexArgs` 偵測到非 null 的 `resumeSessionId`，驗證格式後組合 `resume <id>` 參數
3. **Resume 時不帶 `--model`**，由 Codex 從 session 記錄中決定模型
4. Codex 的 session resume 無自動重試機制（不同於 Claude 的 `sessionRetry.ts`）

### Resume SessionId 格式驗證

```ts
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;
```

- 僅允許英數字、底線、連字號
- 格式不合法時，記 warn log 並**改走新對話模式**（加 `--skip-git-repo-check --model <model>`）

---

## Abort 機制

```ts
// abort signal 觸發時 kill subprocess
const onAbort = (): void => {
  try {
    proc?.kill();
  } catch {
    // subprocess 已結束則忽略
  }
};

if (abortSignal.aborted) {
  onAbort();  // 已 abort，立即 kill
  return;
}
abortSignal.addEventListener("abort", onAbort, { once: true });
```

**特點**：

- 不自建 `AbortController`，直接消費 `ctx.abortSignal`
- 不再使用 `activeProcesses` Map 自管 subprocess（Phase 3 後已刪除）
- abort 由外部 `abortRegistry` 驅動 signal，subprocess 監聽 signal 自己退場
- `finally` 中移除 event listener，避免記憶體洩漏

---

## 不支援的能力清單

對應 `CODEX_CAPABILITIES`：

| 能力 | 支援 | 說明 |
|---|---|---|
| `chat` | ✓ | 基本聊天（JSON line 格式輸出） |
| `skill` | ✗ | 無 Command / Skill 支援 |
| `repository` | ✗ | cwd 只從 `ctx.workspacePath` 取得，無 repositoryId 處理 |
| `command` | ✗ | 無 Command 前綴機制 |
| `mcp` | ✗ | 無 MCP Server 整合 |
| `integration` | ✗ | 無 Integration Tool 建立機制 |
| `runMode` | ✗ | 不支援 Run 模式（workflow 多 Pod 執行） |

---

## Security 機制

### 環境變數白名單（`CODEX_ENV_WHITELIST`）

子程序繼承的環境變數嚴格限制在白名單內，防止洩漏其他 API key 或敏感資訊：

```ts
const CODEX_ENV_WHITELIST = new Set([
  "PATH",          // 讓 codex 找到可執行檔
  "HOME",          // 讀取使用者設定檔
  "LANG",          // 避免 CLI 輸出亂碼
  "LC_ALL",        // locale override
  "OPENAI_API_KEY", // codex 的 API 認證
  "TERM",          // 終端機類型
]);
```

另有 `CODEX_ALLOWED_ENV`（`CODEX_DISABLE_TELEMETRY`、`CODEX_LOG_LEVEL`），允許明確列出的 `CODEX_*` key。

### MODEL_RE — 防 CLI 旗標注入

```ts
const MODEL_RE = /^[a-zA-Z0-9._-]+$/;
```

- 只允許英數字、點、底線、連字號
- 不合法的 model 名稱（含空格、`--`、換行等）會拒絕並使用 default model
- 防止攻擊者透過 model 名稱注入額外的 CLI 旗標

### SESSION_ID_RE — 防 CLI 旗標注入

```ts
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;
```

- 與 MODEL_RE 同樣用途，防止 resumeSessionId 注入 CLI 旗標
- 不合法時改走新對話模式

### stderr 遮蔽

stderr 內容僅寫入 server log，**不對前端廣播**：

```ts
function maskSensitiveText(text: string): string {
  return text
    .replace(/OPENAI_API_KEY\s*=\s*\S+/gi, "OPENAI_API_KEY=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}
```

即使 OPENAI_API_KEY 出現在 stderr，也會被遮蔽後才寫入 logger。

### STDERR_MAX_BYTES — 防記憶體爆炸

```ts
const STDERR_MAX_BYTES = 64 * 1024; // 64KB
```

- 長時間執行的 codex 可能輸出大量 debug log
- 超過 64KB 後停止收集，標記為 `[TRUNCATED]`

---

## 圖片附件處理

Codex CLI 不支援 `--image` 旗標（在 `--json` 模式下會 hang），因此改用 **base64 data URI inline** 方式：

```ts
// ContentBlock 中的 image block 轉換為 data URI
parts.unshift(`[image: data:${block.mediaType};base64,${block.base64Data}]`);
```

### 安全驗證

**BASE64_RE**：驗證 base64 格式，防止換行符造成 prompt injection：

```ts
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
```

**ALLOWED_IMAGE_EXTS**：MIME 類型白名單：

```ts
const ALLOWED_IMAGE_EXTS = new Set(["jpg", "png", "gif", "webp"]);
```

不在白名單內的 MIME 類型或不合法的 base64 資料會被略過（記 warn log）。

---

## `buildOptions()` 行為

```ts
async buildOptions(pod: Pod, _runContext?: RunContext): Promise<CodexOptions> {
  const rawModel = pod.providerConfig?.model;
  const model =
    typeof rawModel === "string" && MODEL_RE.test(rawModel)
      ? rawModel
      : this.metadata.defaultOptions.model;

  return { model, resumeMode: "cli" };
}
```

- 從 `pod.providerConfig.model` 讀取，通過 `MODEL_RE` 驗證
- 不合法（包含非英數字元）或未設定 → fallback 到 `metadata.defaultOptions.model`（`"gpt-5.4"`）
- `runContext` 接收但不使用（介面規範要求保留參數位）
- `resumeMode` 固定為 `"cli"`

---

## stdout JSON line 解析

stdout 每一行都是 codex 的 JSON 事件，由 `codexNormalizer.ts` 的 `normalize(line)` 解析：

```
{ "type": "thread.started", "thread_id": "thr-xxx" }
  → { type: "session_started", sessionId: "thr-xxx" }

{ "type": "item.completed", "item": { "type": "agent_message", "text": "..." } }
  → { type: "text", content: "..." }

{ "type": "turn.completed" }
  → { type: "turn_complete" }
```

不能辨識的 JSON 格式 → `normalize` 回傳 `null`，略過

---

## exit code 處理

| 情況 | 行為 |
|---|---|
| exit code = 0 | 正常結束，不產生 error event |
| exit code ≠ 0 且無 `turn_complete` | yield `{ type: "error", fatal: false, message: "exit code: X" }` |
| exit code ≠ 0 但已有 `turn_complete` | 不產生 error event（視為正常完成） |
| abort signal 已觸發 | 不產生 error event（abort 為使用者主動操作） |

`fatal: false` 表示 Pod 仍可繼續新對話，不是 spawn 失敗等嚴重錯誤。

---

## 預設值

| 常數 | 值 | 說明 |
|---|---|---|
| `metadata.defaultOptions.model` | `"gpt-5.4"` | Codex 預設模型 |
| `metadata.defaultOptions.resumeMode` | `"cli"` | Resume 模式 |
| `STDERR_MAX_BYTES` | `65536`（64KB） | stderr 收集上限 |
