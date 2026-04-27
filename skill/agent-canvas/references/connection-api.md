# Connection API

## GET /api/canvas/:id/connections

取得指定 Canvas 下所有 Connection。`:id` 支援 UUID 或 name。

```bash
curl http://localhost:3001/api/canvas/my-canvas/connections
```

### 回傳格式

```json
{
  "connections": [
    {
      "id": "xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx",
      "sourcePodId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      "sourceAnchor": "right",
      "targetPodId": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "targetAnchor": "left",
      "triggerMode": "auto",
      "decideStatus": null,
      "decideReason": null,
      "connectionStatus": "idle"
    }
  ]
}
```

---

## POST /api/canvas/:id/connections

在指定 Canvas 下建立新 Connection。`:id` 支援 UUID 或 name。

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| sourcePodId | string | 是 | 來源 Pod 的 UUID |
| targetPodId | string | 是 | 目標 Pod 的 UUID |
| sourceAnchor | string | 是 | 來源錨點：top / bottom / left / right |
| targetAnchor | string | 是 | 目標錨點：top / bottom / left / right |

> `triggerMode` 預設為 `auto`，建立時不需指定。

### 成功回應 201

```json
{
  "connection": {
    "id": "xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx",
    "sourcePodId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    "sourceAnchor": "right",
    "targetPodId": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "targetAnchor": "left",
    "triggerMode": "auto",
    "decideStatus": null,
    "decideReason": null,
    "connectionStatus": "idle"
  }
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 400 | 無效的請求格式 / 驗證失敗 |
| 404 | 找不到 Canvas 或找不到 Pod |

### curl 範例

```bash
# 建立 Connection（使用 canvas name）
curl -X POST http://localhost:3001/api/canvas/my-canvas/connections \
  -H "Content-Type: application/json" \
  -d '{"sourcePodId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "targetPodId": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", "sourceAnchor": "right", "targetAnchor": "left"}'

# 建立 Connection（使用 canvas UUID）
curl -X POST http://localhost:3001/api/canvas/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx/connections \
  -H "Content-Type: application/json" \
  -d '{"sourcePodId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "targetPodId": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", "sourceAnchor": "bottom", "targetAnchor": "top"}'
```

---

## DELETE /api/canvas/:id/connections/:connectionId

刪除指定 Connection。`:id` 支援 UUID 或 name，`:connectionId` 僅支援 UUID。

### 成功回應 200

```json
{
  "success": true
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 404 | 找不到 Canvas 或找不到 Connection |

### curl 範例

```bash
# 用 canvas name 刪除 Connection
curl -X DELETE http://localhost:3001/api/canvas/my-canvas/connections/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx

# 用 canvas UUID 刪除 Connection
curl -X DELETE http://localhost:3001/api/canvas/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/connections/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx
```

---

## PATCH /api/canvas/:id/connections/:connectionId

更新指定 Connection 的觸發模式。`:id` 支援 UUID 或 name，`:connectionId` 僅支援 UUID。

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| triggerMode | string | 是 | 觸發模式：auto / ai-decide / direct |

### 成功回應 200

```json
{
  "connection": {
    "id": "xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx",
    "sourcePodId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    "sourceAnchor": "right",
    "targetPodId": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "targetAnchor": "left",
    "triggerMode": "ai-decide",
    "decideStatus": null,
    "decideReason": null,
    "connectionStatus": "idle"
  }
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 400 | 無效的 triggerMode |
| 404 | 找不到 Canvas 或找不到 Connection |

### curl 範例

```bash
# 更新 triggerMode 為 ai-decide（使用 canvas name）
curl -X PATCH http://localhost:3001/api/canvas/my-canvas/connections/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -d '{"triggerMode": "ai-decide"}'

# 更新 triggerMode 為 direct（使用 canvas UUID）
curl -X PATCH http://localhost:3001/api/canvas/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/connections/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -d '{"triggerMode": "direct"}'
```
