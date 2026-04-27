[English](README.en.md) | [日本語](README.ja.md)

# Claude Code Canvas

視覺化設計與執行 AI Agent 工作流程的畫布工具，串接 Claude Agent SDK 驅動 Agent 執行，也可支援團隊多人協作。

<video src="https://github.com/user-attachments/assets/58a82eb0-e629-46cc-a944-5ba891692b52" controls width="100%"></video>

## 目錄

- [注意事項](#注意事項)
- [安裝](#安裝)
- [使用方式](#使用方式)
- [設定](#設定)
- [教學](#教學)
  - [什麼是 POD？](#什麼是-pod)
  - [如何切換模型？](#如何切換模型)
  - [Slot 說明](#slot-說明)
  - [Connection Line](#connection-line)
  - [一般模式與 Multi-Instance 模式](#一般模式與-multi-instance-模式)
  - [Plugin](#plugin)
  - [Workflow 實戰案例](#workflow-實戰案例)
  - [Schedule 排程](#schedule-排程)
  - [Header 按鈕](#header-按鈕)

## 注意事項

- 建議在 **Local 環境** 使用，不建議部署到雲端（本工具目前沒有使用者認證機制）
- 因為使用 **Claude Agent SDK**，請確保此服務啟動在**已登入 Claude 的環境**，暫時不支援 API Key
- 目前在 **macOS / Linux** 上使用過，其他作業系統可能會有未知問題
- 畫布資料會存放在 `~/Documents/ClaudeCanvas`
- 目前是以**最大權限**開放給 AI，請小心操作

## 安裝

**前提條件：** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 已安裝並登入

**一鍵安裝（推薦）**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/claude-code-canvas/main/install.sh | sh
```

**解除安裝**

```bash
curl -fsSL https://raw.githubusercontent.com/cowbear6598/claude-code-canvas/main/install.sh | sh -s -- --uninstall
```

## 使用方式

```bash
# 啟動服務（背景 daemon 模式，預設 port 3001）
claude-code-canvas start

# 指定 port 啟動
claude-code-canvas start --port 8080

# 查看服務狀態
claude-code-canvas status

# 停止服務
claude-code-canvas stop

# 查看最新日誌（預設 50 行）
claude-code-canvas logs

# 查看指定行數的日誌
claude-code-canvas logs -n 100
```

啟動後開啟瀏覽器前往 `http://localhost:3001` 即可使用。

## 設定

如果要使用 Clone 相關功能存取私有 Repository，請使用 `config` 指令設定。如果已經使用 `gh` 登入過，理論上可以不需要額外填寫 GitHub Token。

```bash
# GitHub Token
claude-code-canvas config set GITHUB_TOKEN ghp_xxxxx

# GitLab Token
claude-code-canvas config set GITLAB_TOKEN glpat-xxxxx

# 自架 GitLab 網址（選填，預設為 gitlab.com）
claude-code-canvas config set GITLAB_URL https://gitlab.example.com

# 查看所有設定
claude-code-canvas config list
```

## 教學

### 什麼是 POD？

- 一個 Pod = Claude Code
- 右鍵畫布 → Pod 即可建立

### 如何切換模型？

- 移動到 Pod 上方的模型標籤，就可以選擇 Opus / Sonnet / Haiku

### Slot 說明

- Skills / SubAgents / MCPs 可以放入多個
- Style（Output Style）/ Command（Slash Command）/ Repo 只能單個
- Command 會讓你的訊息前方自動加入，例如：`/command message`
- Repo 會更改你的工作目錄，沒有放入則是 Pod 自己的目錄

### Connection Line

- Auto：不管怎樣都會往下一個 Pod 執行
- AI：會交由 AI 判斷有沒有需要往下一個 Pod 執行
- Direct：不理會其他 Connection Line 直接執行

#### 多條觸發規則

當 Pod 被多條 Connection Line 接入：

- Auto + Auto = 當兩條都準備好時，則會觸發 Pod
- Auto + AI = 當 AI 拒絕時，則不會觸發，同意時，則會觸發 Pod
- Direct + Direct = 當一條完成時，會等 10 秒看其他 Direct 是否完成，如果完成則一起做總結觸發 Pod，等不到的話則會各自總結
- Auto + Auto + Direct + Direct = 會分成兩組（Auto 組與 Direct 組）去做總結，哪一條先完成則會先觸發那組，另一組則會進入 queue 等待觸發

#### 模型設定

右鍵 Connection Line 可以切換以下模型（預設皆為 Sonnet）：

- **Summary Model**：用於產生摘要傳遞給下游 Pod 的模型
- **AI Model**：用於 AI 判斷是否觸發下游 Pod 的模型（僅在 AI 模式下可用）

### 一般模式與 Multi-Instance 模式

Pod 預設為一般模式，可透過**長按橡皮擦按鈕**切換為 Multi-Instance 模式，啟用後按鈕會顯示 **M** 圖示。

#### 一般模式

- 一次只能處理一則訊息，忙碌時新訊息需排隊等待
- Integration 事件在 Pod 忙碌時會被跳過

#### Multi-Instance 模式

- 每次送出訊息都會建立新的 Run，可同時平行執行多個
- Integration 事件不受忙碌狀態影響，永遠會執行
- 對話紀錄需從 Run 歷程中查看
- 綁定 Git Repo 時，每個 Run 會建立獨立的 Worktree，執行完畢後自動清理

### Plugin

Plugin 是透過 Claude CLI 安裝的擴充功能，可以為 Pod 增加額外的能力。

- Plugin 需先透過 `claude` CLI 安裝到系統中（`~/.claude/plugins/`）
- **右鍵 Pod** → Plugin → 透過開關切換啟用 / 停用
- 啟用後，Pod 對話時會載入該 Plugin
- 與 Skills、MCP、SubAgents 是不同的系統，可同時搭配使用

### Workflow 實戰案例

#### 案例一：程式碼審查（Auto 串接）

```
[Code Reviewer] --Auto--> [Report Generator]
```

- Pod A 設定 Output Style 執行 Code Review
- Pod B 接收摘要後整理成完整報告
- **Auto = 前一個 Pod 完成後自動觸發下一個**，下游收到的是摘要內容

#### 案例二：智慧分流（AI 條件分支）

```
                     /-Auto-> [Bug Handler]
[Issue Analyzer] --AI
                     \-Auto-> [Feature Advisor]
```

- AI 根據 Issue 內容決定要觸發哪個 Pod
- **AI 可能同時觸發多個，也可能都不觸發**

#### 案例三：平行蒐集 + 合併（多輸入聚合）

```
[Security Analyst]    --Auto-\
                               --> [Final Report]
[Performance Analyst] --Auto-/
```

- 兩個 Analyst Pod 平行執行，結果都送進 Final Report
- **多條 Auto 接入同一 Pod 時，會等所有來源都完成才觸發**

### Schedule 排程

讓 Pod 按照設定的時間自動執行。

**設定排程**

- **點擊 Pod 上的時鐘按鈕** → 選擇頻率 → **啟用**

**支援頻率**

- 每x秒
- 每x分
- 每x小時
- 每天
- 每週

**修改 / 停用**

- 修改：點擊時鐘 → 調整設定 → **更新**
- 停用：點擊時鐘 → **停用**

**行為說明**

- 排程觸發時，Pod 狀態變為 chatting，完成後會依照 Connection Line 觸發下游 Workflow
- 排程依賴時區設定（**Settings → Timezone**），請確認時區正確
- Pod 正在執行時跳過本次排程，不會堆疊觸發

### Header 按鈕

由左至右四個圖示：

- **地球圖示**：切換介面語言
- **齒輪圖示**：全域設定（時區、備份）
- **鑰匙圖示**：整合服務管理（Slack、Telegram、Jira、Sentry、Webhook）
- **時鐘圖示**：查看 Run 歷程

#### 切換語系

點擊 **地球圖示**，可切換介面語言：

- 繁體中文
- English
- 日本語

#### 全域設定

點擊 **齒輪圖示** 開啟全域設定。

**時區**

在 **Timezone** 中設定，會影響以下功能：

- **Schedule 排程**：「每天」和「每週」的觸發時間依據此時區計算
- **備份排程**：每日自動備份的觸發時間依據此時區計算

**備份**

- **Backup** → 開啟 → 輸入 Git Remote URL → 選擇每日備份時間 → **儲存**
- 備份機制：透過 Git 推送到遠端 Repository

> ⚠️ `encryption.key` 不會被備份，還原後需重新設定加密金鑰相關資料。

#### Integration 串接

點擊 **鑰匙圖示** 開啟整合服務管理，讓外部平台事件自動觸發 Pod 執行。

**通用設定流程**

1. 選擇 Provider → **Add App** → 填寫 Token / Secret → 確認
2. **右鍵 Pod** → Connect Integration → 選擇已註冊的 App → 確認

**Slack**

- 所需資訊：Bot Token（`xoxb-` 開頭）+ Signing Secret（32 字元）
- Webhook URL：`/slack/events`

**Telegram**

- 所需資訊：Bot Token（從 BotFather 取得）
- 只支援私訊，Resource 需手動輸入 User ID

**Jira**

- 所需資訊：Site URL + Webhook Secret（至少 16 字元）
- Webhook URL：`/jira/events/{appName}`
- 可選事件過濾器：All / Status Changed

**Sentry**

- 所需資訊：Client Secret（至少 32 字元）
- Webhook URL：`/sentry/events/{appName}`
- 支援 created 和 unresolved 事件

**Webhook**

提供 Webhook URL 給外部程式呼叫，自動觸發 Pod 執行。

- 只需填名稱，系統自動產生 Bearer Token
- 外部程式透過 POST 請求觸發 Pod：

```bash
curl -X POST https://your-host/webhook/events/{appName} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "trigger"}'
```

#### 歷程

點擊 **時鐘圖示** 開啟 Run 歷程面板，僅記錄 Multi-Instance 模式的執行紀錄。
