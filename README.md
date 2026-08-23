[English](README.en.md) | [日本語](README.ja.md)

# Agent Canvas

視覺化設計與執行 AI Agent 工作流程的畫布工具，支援團隊多人協作。

<video src="https://github.com/user-attachments/assets/58a82eb0-e629-46cc-a944-5ba891692b52" controls width="100%"></video>

## 目錄

- [注意事項](#注意事項)
- [安裝](#安裝)
- [使用方式](#使用方式)
- [設定](#設定)
- [AI 存取](#ai-存取)
- [教學](#教學)
  - [什麼是 POD？](#什麼是-pod)
  - [如何切換模型？](#如何切換模型)
  - [Slot 說明](#slot-說明)
  - [Connection Line](#connection-line)
  - [Run 與平行執行](#run-與平行執行)
  - [Plugin](#plugin)
  - [Workflow 實戰案例](#workflow-實戰案例)
  - [Schedule 排程](#schedule-排程)
  - [Header 與管理中心](#header-與管理中心)

## 注意事項

- 目前在 **macOS / Linux** 上使用過，其他作業系統可能會有未知問題
- 建議優先在 **Local 環境** 使用。系統雖提供 Workspace Password，但目前沒有完整的多使用者帳號與角色權限；若要對外開放，請另外設定 HTTPS、防火牆或反向代理等保護
- Provider 的驗證方式各自不同，可使用支援的訂閱登入或 API Key 設定

## 安裝

**前提條件：** 至少完成一個支援的 AI Provider 驗證

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [OpenCode](https://opencode.ai/docs/cli/)

**一鍵安裝（推薦）**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/agent-canvas/main/install.sh | sh
```

**解除安裝**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/agent-canvas/main/install.sh | sh -s -- --uninstall
```

## 使用方式

```bash
# 啟動服務（背景 daemon 模式，預設 port 3001）
agent-canvas start

# 指定 port 啟動
agent-canvas start --port 8080

# 查看服務狀態
agent-canvas status

# 停止服務
agent-canvas stop

# 查看最新日誌（預設 50 行）
agent-canvas logs

# 查看指定行數的日誌
agent-canvas logs -n 100
```

啟動後開啟瀏覽器前往 `http://localhost:3001` 即可使用。

## 設定

如果要使用 Clone 相關功能存取私有 Repository，請使用 `config` 指令設定。如果已經使用 `gh` 登入過，理論上可以不需要額外填寫 GitHub Token。

```bash
# GitHub Token
agent-canvas config set GITHUB_TOKEN ghp_xxxxx

# GitLab Token
agent-canvas config set GITLAB_TOKEN glpat-xxxxx

# 自架 GitLab 網址（選填，預設為 gitlab.com）
agent-canvas config set GITLAB_URL https://gitlab.example.com

# 查看所有設定
agent-canvas config list
```

## AI 存取

在 Header 的管理中心開啟「AI 存取」，即可建立可撤銷的外部 Token、設定 Advertised URL，並下載不含 Token 的 Agent Canvas Skill。Token 的 Canvas 範圍與 `canvas:read`、`canvas:create`、`canvas:write`、`canvas:execute` 權限分開管理；`canvas:write` 會包含讀取權限。

Pod 的 MCP 選單另有預設關閉的內建 Agent Canvas MCP。啟用後，後端只在 Run 期間提供綁定目前 Canvas、Pod 與 Run 的短效執行權限，不會把外部管理 Token 傳給模型。

## 教學

### 什麼是 POD？

- 一個 Pod = 一個 AI Agent
- 右鍵畫布 → Pod → 選擇 AI Provider 即可建立
- 右鍵 Pod 可切換 Provider、連接 Integration，或調整其他 Pod 設定

### 如何切換模型？

- 移動到 Pod 上方的模型標籤，即可選擇該 Provider 支援的模型
- Brain 選單可調整 Thinking / effort 等級；實際選項依模型能力而定

### Slot 說明

- **Plugin**：選擇這個 Pod 要啟用的 Plugin / Skill bundle
- **MCP**：切換要提供給 Pod 使用的 MCP Server
- **Thinking**：調整模型的思考強度
- **Fast**：切換 Provider 支援的快速模式
- **Goal**：加入這個 Pod 執行時要遵循的目標內容
- **Repo**：綁定 Repository。執行 Run 時使用隔離的工作空間；未綁定時使用 Pod 自己的工作目錄

### Connection Line

右鍵 Connection Line 可設定基本模式，也可獨立開關 Direct：

- **Auto**：來源 Pod 完成後，自動把摘要傳給目標 Pod
- **Branch**：同一來源的多條 Branch 連線會由 AI 根據連線名稱與說明選出一條；判斷失敗時不觸發任何 Branch
- **Direct**：可與 Auto 或 Branch 同時存在。來源完成時直接觸發目標，不參與一般的多輸入等待

#### 多條觸發規則

當 Pod 被多條 Connection Line 接入：

- Auto + Auto：等待同一群組的來源都完成後，再合併摘要並觸發一次
- Auto + Branch：Branch 被選中時才算準備完成；被拒絕時，該群組不會觸發目標 Pod
- Direct + Direct：每條 Direct 完成後各自觸發，**目前不會等待 10 秒合併**
- Auto + Auto + Direct + Direct：Auto 群組依聚合規則觸發；每條 Direct 則獨立觸發，因此目標 Pod 可能執行多次
- 同一個 Run 內若目標 Pod 正忙碌，後續觸發會進入 queue，等目前執行完成後依序處理

#### 模型設定

前往 **管理中心 → Model 設定 → Connection Line** 選擇模型。此設定同時用於產生下游摘要，以及進行 Branch 判斷。

### Run 與平行執行

- 每次手動送出訊息、Schedule 或 Integration 事件都會建立一個 Run；同一個 Pod 的不同 Run 可平行執行
- 手動、排程與 Integration 建立的 Run，以及其中的下游 Workflow 執行，都可從 Run 歷程查看
- 綁定 Git Repo 時，不同 Run 使用隔離的工作空間；同一 Run 內使用相同 Repo 的 Pod 會共用該 Run 的工作空間，Run 結束後自動清理
- 同一 Run 內重複觸發同一個忙碌中的 Pod 時，會透過 queue 依序執行

### Plugin

Plugin Manager 用來管理可提供給 Pod 的 Plugin / Skill bundle，不需要先透過 Claude CLI 安裝。

- 從 **管理中心 → Plugin** 匯入 GitHub Repository 或上傳本機 bundle，再於 Plugin Manager 更新、刪除或調整順序
- 在 Pod 的 **Plugin Slot** 切換要啟用的項目
- 啟用後，Plugin 內的能力會在該 Pod 執行時提供給 Agent
- Plugin 與 MCP 是分開設定的能力，可以同時使用

### Workflow 實戰案例

#### 案例一：程式碼審查（Auto 串接）

```text
[Code Reviewer] --Auto--> [Report Generator]
```

- 在 Code Reviewer 的 Goal 設定審查準則
- Report Generator 會收到上游摘要並整理成完整報告

#### 案例二：智慧分流（Branch）

```text
                 /--Branch: Bug----> [Bug Handler]
[Issue Analyzer]
                 \--Branch: Feature-> [Feature Advisor]
```

- 為每條 Branch 填寫清楚的名稱與說明
- 決策成功時只會選一條 Branch；判斷失敗時不觸發任何分支

#### 案例三：平行蒐集 + 合併（多輸入聚合）

```text
[Security Analyst]    --Auto--\
                               --> [Final Report]
[Performance Analyst] --Auto--/
```

- 兩個 Analyst Pod 可平行執行
- Final Report 會等待同一 Auto 群組的所有來源完成，再接收合併後的摘要

#### 案例四：獨立通知（Direct）

```text
[Build] --Direct--> [Notifier]
[Test]  --Direct--> [Notifier]
```

- Build 與 Test 完成時會各自觸發 Notifier
- 兩條 Direct 不會等待固定時間合併；Notifier 忙碌時，後到的觸發會排隊

### Schedule 排程

- **設定**：點擊 Pod 上的時鐘按鈕 → 選擇頻率 → 啟用
- **頻率**：每 x 秒、每 x 分鐘、每 x 小時、每天或每週
- **修改 / 停用**：點擊時鐘 → 調整設定後更新，或直接停用

- 每次排程觸發都會建立新的 Run，完成後依 Connection Line 規則繼續下游 Workflow
- 排程不會因為同一 Pod 已有其他 Run 正在執行而跳過
- 「每天」與「每週」依照 **管理中心 → Global Settings → Timezone** 計算

### Header 與管理中心

Header 提供以下主要入口：

- **連線狀態**：顯示前端與後端的連線狀態
- **管理中心**：集中管理 Global Settings、Integration、AI 存取、MCP、Plugin、Model 設定與 OpenCode
- **Run 歷程**：查看各次 Run 與 Pod 對話
- **Canvas 選擇器**：切換或管理 Canvas

#### 切換語系

前往 **管理中心 → Global Settings → Language**，可切換：

- 繁體中文
- English
- 日本語

#### 全域設定

前往 **管理中心 → Global Settings**：

- **Timezone**：影響每日 / 每週 Schedule 與每日備份的觸發時間
- **Backup**：設定 Git Remote URL 與每日備份時間、立即備份，並將 Canvas 資料推送到遠端 Git Repository
- **Workspace Password**：保護目前工作區的存取；對外部署時仍應搭配 HTTPS 與網路層防護

> ⚠️ `encryption.key` 不會被備份，還原後需重新設定與加密金鑰相關的資料。

#### Integration 串接

前往 **管理中心 → Integration**，讓外部平台事件自動建立 Run 並觸發 Pod。

**通用設定流程**

1. 選擇 Provider → Add App → 填寫 Token / Secret → 確認
2. 右鍵 Pod → Connect Integration → 選擇已註冊的 App 與 Resource → 確認

**Discord**

- 所需資訊：Bot Token
- 選擇 Server 與 Channel 綁定；在該頻道提及 Bot 時觸發

**Slack**

- 所需資訊：Bot Token（`xoxb-` 開頭）+ Signing Secret（32 字元）
- Webhook URL：`/slack/events`

**Telegram**

- 所需資訊：Bot Token（從 BotFather 取得）
- 支援私訊，Resource 需填入 User ID

**Jira**

- 所需資訊：Site URL + Webhook Secret（至少 16 字元）
- Webhook URL：`/jira/events/{appName}`
- 可選事件過濾器：All / Status Changed

**Sentry**

- 所需資訊：Client Secret（至少 32 字元）
- Webhook URL：`/sentry/events/{appName}`
- 支援 created 和 unresolved 事件

**Webhook**

- 輸入名稱後，系統會產生 Bearer Token
- 外部程式透過 POST 請求觸發綁定的 Pod：

```bash
curl -X POST https://your-host/webhook/{appName} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "trigger"}'
```

#### Run 歷程

從 Header 開啟 Run 歷程，可查看上述 Run、下游 Workflow 與各 Pod 的對話內容。
