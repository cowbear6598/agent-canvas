# Workflow API

## GET /api/canvas/:id/workflows

取得指定 Canvas 下所有 Workflow。`:id` 支援 UUID 或 name。

Workflow 定義：透過 Connection 連接的 Pod 鏈路，或沒有任何 Connection 的單獨 Pod。入口 Pod = 沒有 inbound connection 的 Pod。`workflowId` = 入口 Pod 的 ID。已綁定 Slack 或 Telegram 的 Pod 不會出現在列表中。

```bash
curl http://localhost:3001/api/canvas/my-canvas/workflows
```

### 回傳格式

```json
{
  "workflows": [
    {
      "workflowId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      "entryPod": {
        "id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "name": "Entry Pod",
        "status": "idle",
        "workspacePath": "/path/to/workspace",
        "x": 100,
        "y": 200,
        "rotation": 0,
        "model": "opus",
        "skillIds": [],
        "subAgentIds": [],
        "mcpServerIds": [],
        "multiInstance": false
      },
      "nodes": {
        "pod": {
          "id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          "name": "Entry Pod",
          "status": "idle",
          "workspacePath": "/path/to/workspace",
          "x": 100,
          "y": 200,
          "rotation": 0,
          "model": "opus",
          "skillIds": [],
          "subAgentIds": [],
          "mcpServerIds": [],
          "multiInstance": false
        },
        "connections": [
          {
            "id": "cccccccc-cccc-4ccc-cccc-cccccccccccc",
            "sourcePodId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            "sourceAnchor": "right",
            "targetPodId": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
            "targetAnchor": "left",
            "triggerMode": "auto",
            "decideStatus": null,
            "decideReason": null,
            "connectionStatus": "idle"
          }
        ],
        "children": [
          {
            "pod": {
              "id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
              "name": "Downstream Pod",
              "status": "idle",
              "workspacePath": "/path/to/workspace",
              "x": 400,
              "y": 200,
              "rotation": 0,
              "model": "opus",
              "skillIds": [],
              "subAgentIds": [],
              "mcpServerIds": [],
              "multiInstance": false
            },
            "connections": [],
            "children": []
          }
        ]
      }
    }
  ]
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 404 | 找不到 Canvas |

---

## POST /api/canvas/:id/workflows/:podId/chat

對指定 Workflow 發送訊息。`:id` 支援 UUID 或 name，`:podId` 支援 UUID 或 name。

Fire-and-forget 模式：立即回傳 202 Accepted，Claude 的回應透過 WebSocket 推送給前端。

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| message | string 或 ContentBlock[] | 是 | 訊息內容，string 最長 10000 字元 |

> **ContentBlock 格式說明**：`message` 可傳入 string 或 ContentBlock 陣列。ContentBlock 有以下兩種類型：
> - `TextContentBlock`：`{ "type": "text", "text": "內容" }`
> - `ImageContentBlock`：`{ "type": "image", "mediaType": "image/png", "base64Data": "..." }`

### 成功回應 202

```json
{
  "success": true,
  "podId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 400 | 無效的請求格式 |
| 400 | 訊息格式錯誤 |
| 400 | 此 Pod 不是 Workflow 入口，無法直接發送訊息 |
| 400 | Pod 已連接 Slack，無法手動發送訊息 |
| 404 | 找不到 Canvas |
| 404 | 找不到 Pod |
| 409 | Pod 目前正在忙碌中，請稍後再試 |

### curl 範例

```bash
# 用 canvas name + pod name 發送純文字訊息
curl -X POST http://localhost:3001/api/canvas/my-canvas/workflows/My%20Pod/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "請幫我分析這份資料"}'

# 用 UUID 發送純文字訊息
curl -X POST http://localhost:3001/api/canvas/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx/workflows/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "請幫我分析這份資料"}'

# 發送 ContentBlock[] 訊息（含圖片）
curl -X POST http://localhost:3001/api/canvas/my-canvas/workflows/My%20Pod/chat \
  -H "Content-Type: application/json" \
  -d '{"message": [{"type": "text", "text": "請描述這張圖片"}, {"type": "image", "mediaType": "image/png", "base64Data": "iVBORw0KGgo..."}]}'
```

---

## POST /api/canvas/:id/workflows/:podId/stop

中斷指定 Workflow 的對話。`:id` 支援 UUID 或 name，`:podId` 支援 UUID 或 name。

### 成功回應 200

```json
{
  "success": true
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 404 | 找不到 Canvas |
| 404 | 找不到 Pod |
| 409 | Pod 目前不在對話中，無法中斷 |

### curl 範例

```bash
# 用 canvas name + pod name 中斷對話
curl -X POST http://localhost:3001/api/canvas/my-canvas/workflows/My%20Pod/stop

# 用 UUID 中斷對話
curl -X POST http://localhost:3001/api/canvas/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx/workflows/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/stop
```

---

## WebSocket 同步

`chat` 和 `stop` 的操作結果不會在 HTTP 回應中直接返回，而是透過 WebSocket 即時推送給前端。發送訊息後可監聽以下事件取得對話進度與結果：

| 事件名稱 | 說明 |
|----------|------|
| `pod:chat:user-message` | 使用者訊息已送出，開始處理 |
| `pod:claude:chat:message` | Claude 串流回傳的文字片段 |
| `pod:chat:tool_use` | Claude 正在呼叫工具 |
| `pod:chat:tool_result` | 工具執行結果回傳 |
| `pod:chat:complete` | 對話完成 |
| `pod:chat:aborted` | 對話被中斷（stop API 呼叫後觸發） |
| `pod:status:changed` | Pod 狀態變更（如 idle → busy → idle） |
