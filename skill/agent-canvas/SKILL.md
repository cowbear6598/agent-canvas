---
name: agent-canvas
description: 透過 REST API 操控 agent-canvas 畫布系統。當 AI Agent 需要查詢或操控畫布時使用此 Skill 參考可用的端點和格式。
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash(curl *)
---

# agent-canvas 概覽

agent-canvas 是一個 Agent 畫布系統，後端使用 **Bun + TypeScript** 實作，提供 REST API 通訊方式：

- **REST API**：HTTP 端點，用於查詢畫布資訊

---

## 前置條件

使用此 Skill 前，agent-canvas 後端必須正在運行。

- 預設位址：`http://localhost:3001`

---

## 通用規則

- 基底 URL：`http://localhost:3001`
- 所有錯誤回應格式：`{ "error": "訊息" }`
- 路徑參數 `:id` 支援 UUID 或 canvas name，伺服器自動判斷：符合 UUID v4 格式則用 id 查詢，否則當作 name 查詢
- 通用錯誤碼：

| 狀態碼 | 說明 |
|--------|------|
| 404 | 找不到資源 |
| 500 | 伺服器錯誤 |

---

## REST API 端點快速索引

### Canvas

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/canvas/list | 列出所有畫布 |
| POST | /api/canvas | 建立新畫布 |
| DELETE | /api/canvas/:id | 刪除指定畫布（支援 UUID 或 name） |
| PATCH | /api/canvas/:id | 重新命名指定畫布（支援 UUID 或 name） |

詳細格式與範例：[references/canvas-api.md](references/canvas-api.md)

### Pod

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/canvas/:id/pods | 取得指定畫布的所有 Pod（:id 支援 UUID 或 name） |
| POST | /api/canvas/:id/pods | 在指定畫布建立新 Pod（:id 支援 UUID 或 name） |
| DELETE | /api/canvas/:id/pods/:podId | 刪除指定 Pod（:id 支援 UUID 或 name，:podId 支援 UUID 或 name） |
| PATCH | /api/canvas/:id/pods/:podId | 重新命名指定 Pod（:id 支援 UUID 或 name，:podId 支援 UUID 或 name） |

詳細格式與範例：[references/pod-api.md](references/pod-api.md)

### Connection

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /api/canvas/:id/connections | 取得指定畫布的所有 Connection（:id 支援 UUID 或 name） |
| POST | /api/canvas/:id/connections | 在指定畫布建立新 Connection（:id 支援 UUID 或 name） |
| DELETE | /api/canvas/:id/connections/:connectionId | 刪除指定 Connection（:id 支援 UUID 或 name，:connectionId 僅支援 UUID） |
| PATCH | /api/canvas/:id/connections/:connectionId | 更新指定 Connection 的觸發模式（:id 支援 UUID 或 name，:connectionId 僅支援 UUID） |

詳細格式與範例：[references/connection-api.md](references/connection-api.md)

---

## 錯誤處理

| 情況 | 原因 | 解法 |
|------|------|------|
| HTTP 404 | API 路徑錯誤 | 確認 URL 路徑正確 |
| HTTP 500 | 後端內部錯誤 | 查看後端 log 排查問題 |
