# PRD：AgentCanvas Plugins Workspace Mount

## 摘要

AgentCanvas 會把 Plugin 定義成一個可在 Pod workspace 內掛載的本地 skill repo。

Plugins 的唯一來源改為：

`~/Documents/AgentCanvas/Plugins/`

每個 Plugin 都是使用者自己管理的 repo。AgentCanvas 負責掃描這個資料夾、讓使用者對每個 Pod 控制啟用哪些 Plugins、在 run 前把已啟用的 Plugins 掛進該 Pod 的 workspace，並注入一段簡短 note，讓 AI 知道應該先讀哪個 `SKILL.md`、相關檔案在哪裡。

V1 的 Plugin 不負責新增結構化工具能力。它提供的是：

- workflow 指令
- 參考文件
- 本地 scripts 與其他檔案

真正的執行仍由 host AI 原本就有的能力完成，例如 Bash、Read、Write、Git，以及已啟用的 MCP tools。

## 問題陳述

目前 codebase 的 Plugin 系統是 provider-native：

- Claude 掃 `~/.claude/plugins`
- Codex 掃 `~/.codex/plugins/cache`
- Gemini 掃 `~/.gemini/extensions`

這會造成幾個問題：

- 同一個「Plugin」概念在不同 provider 上行為不一致
- 使用者自己的 skill repo 與 scripts 無法穩定帶進每一個 Pod
- AgentCanvas 不擁有 Plugin lifecycle，真正的 source of truth 在各家 host 的安裝機制裡
- 雖然 Pod 已經有 Plugin toggle 狀態，但 runtime 語意不一致

## 產品目標

- 讓使用者能在同一個本機資料夾集中管理 Plugins
- 讓 Plugins 在 AgentCanvas 層變成 provider-agnostic
- 讓 Plugin 是否可用可以完全 per Pod 控制
- 確保 AI 能透過穩定的 workspace-local path 存取 Plugin 檔案與 scripts
- 不要求 Plugin 作者額外採用 AgentCanvas 專屬 manifest 或新的 repo 格式

## 非目標

- V1 不做 Plugin marketplace
- V1 不做遠端共享或同步 Plugins
- V1 不做 Plugin 專屬 execution runtime
- V1 不要求 Plugin 作者額外加 manifest、frontmatter 或 action schema
- V1 不把 Claude / Codex / Gemini 的原生 Plugin 格式當成產品主契約

## 產品原則

1. Plugin 是 repo，不是新的 runtime
2. `SKILL.md` 是入口，不是 machine-readable contract
3. AgentCanvas 掛載 Plugin 檔案；真正執行由 host AI 的原生能力完成
4. Pod toggle 狀態必須是 source of truth
5. AgentCanvas 不修改 Plugin repo 本身

## 目標使用者

主要使用者：

- 單機使用 AgentCanvas 的進階使用者，會在 Claude、Gemini、Codex、OpenCode 間切換，有時也會透過 OpenCode 使用 local model

## 使用者故事

- 作為使用者，我可以把 repo clone 到 `~/Documents/AgentCanvas/Plugins/`，AgentCanvas 會自動發現它
- 作為使用者，我可以看到哪些本機 repos 是有效的 Plugins
- 作為使用者，我可以對每個 Pod 啟用或停用 Plugins
- 作為使用者，我啟動 Pod 後，可以信任已啟用的 Plugins 會出現在該 Pod 的 workspace 內
- 作為使用者，我可以把 scripts 放進 Plugin repo，讓 AI 透過它原本就有的 shell / tool 能力去執行
- 作為使用者，我不需要把自己的 Plugin repo 改寫成 AgentCanvas 專屬格式

## 名詞定義

Plugin：

- 位於 `~/Documents/AgentCanvas/Plugins/` 之下的一個本地 repo
- 至少包含一個 `SKILL.md`
- 可以另外包含 `references/`、`scripts/`、`bin/`、`docs/`、`templates/` 或其他任意檔案

有效 Plugin：

- AgentCanvas 能根據 `SKILL.md` 判定為 Plugin 候選的 repo

已掛載 Plugin：

- 在本次 run 中已被複製或 materialize 到 Pod workspace 的 Plugin

Plugin Note：

- 在 runtime 由系統產生、注入到 AI context 的短 note，用來告訴模型目前啟用了哪些 Plugins、掛載路徑在哪裡、應該先讀哪個 `SKILL.md`

## Source of Truth

檔案層 source of truth：

- `~/Documents/AgentCanvas/Plugins/`

Pod 啟用狀態的 source of truth：

- `pod.pluginIds`

Runtime source of truth：

- Pod workspace 內已掛載的 Plugin snapshot

## 功能需求

### 1. Plugin 掃描

AgentCanvas 必須掃描：

- `~/Documents/AgentCanvas/Plugins/`

AgentCanvas 必須用至少存在一個 `SKILL.md` 來判定 Plugin 候選。

Scanner 需要支援：

- `<repo>/SKILL.md`
- `<repo>/skills/*/SKILL.md`

Scanner 必須忽略：

- 沒有任何 `SKILL.md` 的 repo
- 隱藏系統檔案
- 壞掉的 symlink 或不可讀 repo

### 2. Plugin Registry

AgentCanvas 必須建立本機 Plugin registry。

每個 registry entry 至少包含：

- `id`
- `name`
- `rootPath`
- `skillEntryPaths[]`
- `discoveredAt`
- `lastScannedAt`
- `isValid`
- `invalidReason?`

對同一個本地 repo，`id` 必須保持穩定。

### 3. Plugin UI

AgentCanvas 必須提供 Plugin 控制介面，放在 header 或 Pod UI 內，支援：

- 列出已發現 Plugins
- 依名稱或路徑搜尋
- 對 Pod toggle Plugins
- 未來可加入「輸入網址 clone repo 到 Plugin folder」

V1 可以先不實作 clone-by-URL，但 PRD 需要預留這條 UX 路徑。

### 4. Pod 層級啟用

Per-Pod Plugin 狀態必須儲存在：

- `pod.pluginIds`

當使用者對某個 Pod toggle 一個 Plugin 時：

- 該 Plugin 必須參與這個 Pod 的下一次 runtime resolve
- 除非其他 Pod 也啟用同一個 Plugin，否則只有該 Pod 應看得到它

### 5. Workspace Materialization

每次 run 前，AgentCanvas 必須把已啟用 Plugins materialize 到 Pod workspace。

建議目標路徑：

- `.agentcanvas/plugins/<plugin-id>/`

Materialization 需求：

- 不可寫進 tracked project files
- 不可要求使用者專案產生 Git 變更
- 必須保留每個 Plugin repo 原本的相對路徑結構
- 必須讓 Plugin scripts 對 host AI 來說可讀、可執行

AgentCanvas 不應在 materialization 過程中自動執行 Plugin scripts。

### 6. Plugin Context Injection

每次 run 前，AgentCanvas 必須注入一段簡短的 Plugin note 到 model context。

這段 note 至少包含：

- 已啟用的 Plugin 名稱
- 掛載後的 Plugin 路徑
- 應先讀哪個 `SKILL.md`
- 提醒模型：Plugin scripts 可以透過 host 原本的 shell / tool 能力執行

範例：

```text
Enabled plugin: jira-review
Path: .agentcanvas/plugins/jira-review/
Read first: .agentcanvas/plugins/jira-review/SKILL.md
This plugin may include scripts and references. Use your normal tools to inspect files and run scripts when needed.
```

### 7. Script 可存取性

Plugin repo 可以包含使用者自帶 scripts。

AgentCanvas 必須確保 AI 能透過 workspace-local 掛載路徑找到這些 scripts。

V1 行為如下：

- AgentCanvas 不解析或分類 scripts
- AgentCanvas 不從 scripts 產生 tool schema
- AgentCanvas 不接管 script execution
- AI 依 `SKILL.md` 指示，使用自己既有的 shell / file 能力去執行 scripts

### 8. Provider Independence

這套 Plugin 系統不應依賴 provider-native Plugin runtime。

掛載後的 Plugin 必須能以普通 workspace 檔案的形式被以下 host 使用：

- Claude
- Gemini
- Codex
- OpenCode

## UX 需求

### Plugin 清單項目

每個 Plugin item 應顯示：

- Plugin 名稱
- source path
- 是否存在 `SKILL.md`
- 對目前 Pod 是否已啟用

### Empty State

若沒有任何有效 Plugins：

- 要說明預期資料夾位置
- 要提示 Plugin repo 需要包含 `SKILL.md`

### Error State

如果 repo 存在但無效：

- 顯示 repo 名稱
- 顯示 invalid reason
- 不允許 toggle 為 enabled

## Runtime Flow

```text
使用者把 repo clone 到 ~/Documents/AgentCanvas/Plugins/
-> AgentCanvas scanner 發現 repo
-> AgentCanvas registry 建立 Plugin metadata
-> 使用者對某個 Pod 啟用 plugin
-> pod.pluginIds 更新
-> run 開始
-> AgentCanvas 把已啟用 Plugins materialize 到 .agentcanvas/plugins/
-> AgentCanvas 注入 Plugin note
-> AI 讀取 SKILL.md
-> AI 用原生 shell/tools 檢查檔案並執行 scripts
```

## 技術需求

### Scanner

目前 [backend/src/services/pluginScanner.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/services/pluginScanner.ts:1) 是 provider-native scanner，不能再當成 Plugin 主契約。

V1 需要一個新的本機 Plugin scanner，專門掃 `~/Documents/AgentCanvas/Plugins/`。

### Pod Binding

現有 [backend/src/types/pod.ts](/Users/cowbear6598/Desktop/claude-code-canvas/backend/src/types/pod.ts:1) 裡的 `pod.pluginIds` 可以沿用。

它的語意從：

- provider-native installed plugin ids

改成：

- AgentCanvas local Plugin registry ids

### Note Injection

各 provider adapter 都需要新增 Plugin note injection 步驟。

這段 note 應根據本次 resolve 出來的 enabled Plugins 與 mounted paths 動態生成。

### Materialization 策略

Materialization 應以 snapshot copy 或等價的安全掛載策略實作。

V1 應優先採用簡單 copy，而不是更複雜的 symlink，理由是：

- workspace / sandbox 可見性比較可預測
- 跨 provider 行為更一致

## 安全考量

- Plugins 是使用者自帶的本地 repos，可能包含任意 scripts
- AgentCanvas 不可自動執行 Plugin code
- 執行必須永遠由 AI 透過 host 原本的 shell / tool 模型主動發起
- 已掛載 Plugins 必須位於 workspace 可見邊界內
- AgentCanvas 應避免掛進 tracked source directories，避免被意外 commit

## 效能考量

- 大型 Plugin repos 若每次都完整 copy，成本可能偏高
- V1 可先用簡單 copy semantics
- 未來可以加入 hash 或 snapshot cache reuse 做優化

## 邊界案例

- 一個 repo 內有多個 `SKILL.md`
- repo 有 `SKILL.md`，但沒有實際可用 scripts
- repo scripts 依賴的 runtime 套件未安裝在目標 workspace
- `SKILL.md` 指示預設某種 shell 或平台，但使用者環境不同
- 兩個 Plugins repo 名稱相同

## 成功指標

- 使用者不用修改 repo 結構就能加入 Plugin
- 不同 Pods 可以各自啟用不同本地 Plugins
- AI 能穩定找到已掛載的 `SKILL.md`
- AI 能透過原生 host tools 執行 Plugin scripts
- Plugin 在 AgentCanvas 層對 Claude / Gemini / Codex / OpenCode 呈現一致行為

## 驗收標準

- 把 repo 放進 `~/Documents/AgentCanvas/Plugins/` 後，只要有 `SKILL.md` 就會出現在 Plugin UI
- Toggle Plugin 會更新 `pod.pluginIds`
- 啟動 run 後，已啟用 Plugin 會掛到 `.agentcanvas/plugins/<id>/`
- AI 會收到包含 mounted path 與 entry `SKILL.md` 的 note
- AI 能透過既有工具檢查並執行 mounted path 裡的 Plugin scripts
- 整個流程不需要依賴 provider-native Plugin 安裝

## Open Questions

- Materialization 應該 per Pod session 做一次，還是每次 run 都做？
- 多個 `SKILL.md` 應該被視為同一個 Plugin 的多個 entry，還是多個獨立 skill entries？
- AgentCanvas 是否要支援手動 refresh Plugin folder scan？
- 無效 repo 應該保留在清單中，還是預設隱藏？
