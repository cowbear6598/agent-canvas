# PRD：AgentCanvas Managed MCP Registry

## 摘要

AgentCanvas 將接管 MCP 的設定與 lifecycle，不再把 Claude、Codex、Gemini、OpenCode 各自的 host config 當成 runtime source of truth。

使用者透過 AgentCanvas UI 設定 MCP servers。AgentCanvas 會負責：

- 儲存 server definitions
- 啟動或連線到 child MCP servers
- 監控健康狀態與錯誤
- 依 Pod 過濾可見能力
- 對 host AI 暴露單一、穩定的 AgentCanvas-managed MCP surface

這會把「工具 / runtime 能力」與 Plugin repos 明確拆開。

## 問題陳述

目前 MCP 模型是 host-owned：

- Claude 讀 `~/.claude.json`
- Codex 讀 `~/.codex/config.toml`
- Gemini 讀 `~/.gemini/settings.json`
- OpenCode 讀自己的 config

codebase 也反映了這件事，現有 reader 與 handler 都是 provider-specific，例如 [backend/src/handlers/mcpHandlers.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/handlers/mcpHandlers.ts:1)。

這會帶來幾個問題：

- 各家 config 格式不同
- 使用者必須在多個地方管理 MCP
- 雖然 Pod 已有 MCP toggle 狀態，但真正的 source of truth 在 AgentCanvas 外面
- 很難在多 provider 間得到一致的 runtime 行為

## 產品目標

- 讓 AgentCanvas 成為 MCP server registration 的 owner
- 讓使用者直接在 AgentCanvas UI 內新增與管理 MCP servers
- 支援 per Pod 啟用與停用
- 讓 Claude、Gemini、Codex、OpenCode 都走一致的 AgentCanvas-managed runtime 故事
- 把 MCP capability management 與 Plugin repo management 明確拆開

## 非目標

- V1 不要求支援各 provider 原生 `.mcp.json` 或等價格式作為主契約
- V1 不同步回各家 host config files
- V1 不處理多使用者共用或遠端共享 registry
- V1 不把 plugin-native MCP import 當成核心 runtime contract

## 產品原則

1. MCP 是正式的工具 / runtime capability 層
2. AgentCanvas 擁有 server definitions 與 lifecycle
3. Per-Pod enablement 必須是 source of truth
4. 各 host 盡量只連一個 AgentCanvas-managed MCP surface
5. Plugin repos 與 MCP servers 是兩套不同概念

## 目標使用者

主要使用者：

- 在單機環境使用 AgentCanvas，並在多個 AI hosts 與 models 間切換的使用者

## 使用者故事

- 作為使用者，我可以直接從 AgentCanvas UI 新增 MCP server，而不用手動編輯各家 host config
- 作為使用者，我可以設定 stdio、HTTP、SSE 三種 MCP server
- 作為使用者，我可以對每個 Pod 啟用或停用 MCP servers
- 作為使用者，我可以看到 MCP server 是健康、失敗還是無法連線
- 作為使用者，我可以信任 AgentCanvas 會把 MCP 能力以穩定方式暴露給當前選擇的 host

## 名詞定義

Managed MCP Server：

- 註冊在 AgentCanvas 本機 MCP registry 裡的一個 MCP server

Child MCP Server：

- AgentCanvas 會去啟動或連線的實際上游 MCP server

Aggregator MCP：

- 對外暴露給 host AIs 的 AgentCanvas-managed MCP surface

Per-Pod MCP Surface：

- 根據某個 Pod 的 toggle 狀態所過濾出的 tools / resources / prompts 集合

## Source of Truth

設定層 source of truth：

- AgentCanvas local MCP registry

Pod 啟用狀態 source of truth：

- `pod.mcpServerNames`

Runtime source of truth：

- 當前 Pod 或當前 run 對應的 AgentCanvas-managed MCP surface

## 功能需求

### 1. MCP Registry

AgentCanvas 必須維護一份本機 MCP registry。

每個 server entry 至少支援：

- `id`
- `name`
- `transport`
- `command`
- `args[]`
- `cwd`
- `env`
- `url`
- `enabled`
- `createdAt`
- `updatedAt`
- `lastKnownStatus`
- `lastError`

`transport` 至少支援：

- `stdio`
- `http`
- `sse`

### 2. MCP UI

AgentCanvas 必須在 header 或等價的全域入口提供 MCP 控制介面。

UI 需要支援：

- 列出已註冊 MCP servers
- 建立 server entry
- 編輯 server entry
- 刪除 server entry
- 對 Pod 啟用或停用
- 查看 status 與最近一次 failure reason

### 3. Pod 層級啟用

Per-Pod MCP 狀態必須儲存在：

- `pod.mcpServerNames`

它的語意從：

- 由 provider-native host config 掃出來的 server names

改成：

- AgentCanvas-managed MCP registry ids 或穩定 names

### 4. Child Server 啟動與連線

AgentCanvas 必須能：

- spawn stdio child MCP servers
- connect 到 HTTP MCP servers
- connect 到 SSE MCP servers

AgentCanvas 必須負責：

- startup success 判定
- shutdown
- reconnect 或 recovery 策略
- error capture

### 5. Aggregation

AgentCanvas 必須把已啟用的 child MCP servers 聚合到單一 AgentCanvas-managed MCP surface 後再對外暴露。

這個 surface 必須：

- 提供穩定 namespace
- 避免命名衝突
- 套用 Pod-level filtering
- 視需要 re-export tools、resources、prompts

Tool names 應採用 namespace，避免碰撞。

例如：

- `mcp__jira__search_issues`
- `mcp__sentry__list_issues`

### 6. Per-Pod Filtering

如果不同 Pods 的 toggle 狀態不同，AgentCanvas 不能只靠一顆全域、未過濾的 MCP surface。

因此 V1 必須支援以下其中一種模式：

- per-Pod AgentCanvas MCP instance
- per-run AgentCanvas MCP instance

Runtime surface 必須只暴露該 Pod 被允許使用的 MCP capabilities。

### 7. Provider Injection

各 host 應該接 AgentCanvas-managed MCP，而不是再以 provider-native readers 當 runtime contract。

V1 目標行為：

- Claude 透過 `mcpServers` 接入 AgentCanvas MCP
- Gemini 透過 allowed server configuration 接入 AgentCanvas MCP
- Codex 透過 MCP client config 接入 AgentCanvas MCP
- OpenCode 透過自己的 MCP integration path 接入 AgentCanvas MCP

### 8. Runtime Guidance

AgentCanvas 應注入一段簡短 note 或 instructions，讓 AI 知道目前有 AgentCanvas MCP 可用，以及什麼時候應該使用它。

這段 guidance 應保持簡短。

真正的核心 capability signal 還是 MCP discovery 本身，不是 note。

## Runtime Flow

```text
使用者在 AgentCanvas 建立 MCP entry
-> AgentCanvas 儲存本機 MCP registry entry
-> 使用者對某個 Pod 啟用 MCP
-> pod.mcpServerNames 更新
-> run 開始
-> AgentCanvas resolve 出已啟用的 child MCP servers
-> AgentCanvas 啟動或連線到 child servers
-> AgentCanvas 建立經過過濾的 aggregated MCP surface
-> Host AI 連到 AgentCanvas MCP
-> Model 只看得到這個 Pod 被允許使用的 MCP capabilities
```

## 與 Plugins 的關係

Plugins 與 MCP 必須明確分開。

Plugins：

- 本地 skill repos
- 被掛進 workspace
- 提供 instructions 與 local files

MCP：

- 外部或本地的 tool / runtime capability
- 設定於 AgentCanvas registry
- 由 AgentCanvas 管理並對外暴露

V1 策略：

- 忽略 Plugin-native `.mcp.json` 或其他 vendor config，不能拿來當 runtime input
- 如果未來要支援 import，也只能是 optional importer，而不是核心契約

## 技術需求

### 目前 codebase 限制

目前 provider 的 MCP handling 都是 provider-specific：

- Claude reader：[backend/src/services/mcp/claudeMcpReader.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/services/mcp/claudeMcpReader.ts:1)
- Codex reader：[backend/src/services/mcp/codexMcpReader.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/services/mcp/codexMcpReader.ts:1)
- Gemini reader：[backend/src/services/mcp/geminiMcpReader.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/services/mcp/geminiMcpReader.ts:1)
- central handler：[backend/src/handlers/mcpHandlers.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/handlers/mcpHandlers.ts:1)

這些 readers 可以保留作歷史相容或參考，但不能繼續當 runtime 的主 source of truth。

### Pod Binding

現有 [backend/src/types/pod.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/types/pod.ts:1) 裡的 `pod.mcpServerNames` 可以沿用。

### Provider Adapters

Provider adapters 必須調整成優先吃 AgentCanvas-managed MCP injection，而不是 provider-native discovery。

關鍵提醒：

- Claude 最容易接，因為本來就能接受顯式 `mcpServers`
- Gemini 目前偏 name-based allowlisting，需要小心調整注入路徑
- Codex 現在預設假設 server 先存在於 config，需補新的 injection path
- OpenCode 已有 tool subset 邏輯，只要 server source 改成 AgentCanvas-owned，適配會比較順

## UX 需求

### MCP 清單項目

每個 MCP item 應顯示：

- display name
- transport type
- status
- 最近一次 error
- 對目前 Pod 是否已啟用

### 建立 / 編輯表單

表單至少支援：

- server 名稱
- transport 類型
- stdio 的 command 與 args
- HTTP / SSE 的 URL
- working directory
- env vars

### Status Signals

至少包含：

- idle
- starting
- healthy
- degraded
- failed

## 安全考量

- AgentCanvas 會啟動使用者設定的 child processes
- env 注入必須是顯式且可見的
- 敏感 env values 在 UI 與 logs 中必須遮罩
- child servers 不可取得超出 AgentCanvas runtime 既有邊界以外的權限
- Pod-level filtering 必須由 AgentCanvas 強制執行，不能丟給模型自己判斷

## 效能考量

- 如果每次 run 都重新 spawn child MCP servers，latency 可能增加
- 改成 long-lived child server reuse 雖能改善效能，但會提高 lifecycle 複雜度
- V1 可以先採較簡單的 lifecycle 保證，之後再優化

## 邊界案例

- child server 啟動失敗
- child server 啟動成功但沒有暴露任何 tools
- 兩個 servers 暴露出衝突的 tool names
- 同一個 server 對某個 Pod 啟用、對另一個 Pod 停用
- 遠端 HTTP / SSE server 在 session 中途斷線

## 成功指標

- 使用者在 AgentCanvas 設定一次 MCP，就不必再編輯多家 host configs
- Pod-level MCP toggle 在不同 providers 上產生一致行為
- Tool visibility 能準確反映 Pod toggle 狀態
- Claude、Gemini、Codex、OpenCode 都能接入 AgentCanvas-managed MCP 路徑

## 驗收標準

- 使用者可從 AgentCanvas UI 建立 MCP server entries
- Toggle 會更新 `pod.mcpServerNames`
- 啟動 run 後，該 Pod 只會看到已啟用的 MCP capabilities
- Runtime 不再以 `~/.claude.json`、`~/.codex/config.toml`、`~/.gemini/settings.json` 當 primary source of truth
- 啟動或連線失敗會在 UI 中被觀察到
- MCP layer 與 Plugin repo handling 保持分離

## Open Questions

- AgentCanvas 應該使用一個 long-lived aggregator server 搭配 Pod-scoped sessions，還是改成 per-Pod / per-run instances？
- Tool names 應保留 upstream names，還是強制全部 namespace 化？
- 對於被停用的 MCP servers，是否仍需要背景 health check？
- V1 是否需要 secret storage 來保存 env values，還是先只支援 plain local env passthrough？
