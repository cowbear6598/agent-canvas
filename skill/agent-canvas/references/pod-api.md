# Pod API

## GET /api/canvas/:id/pods

取得指定 Canvas 下所有 Pod。`:id` 支援 UUID 或 name。

```bash
curl http://localhost:3001/api/canvas/my-canvas/pods
```

---

## POST /api/canvas/:id/pods

在指定 Canvas 下建立新 Pod。`:id` 支援 UUID 或 name。

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| name | string | 是 | Pod 名稱，1-100 字元 |
| x | number | 是 | X 座標（像素） |
| y | number | 是 | Y 座標（像素） |
| model | string | 否 | 模型類型：`opus` / `sonnet` / `haiku`，預設 `opus` |

> Pod 尺寸為 224x168 px，建議 Pod 之間保持 200px 間距。

### 成功回應 201

```json
{
  "pod": {
    "id": "xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx",
    "name": "My Pod",
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
  }
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 400 | 無效的請求格式 / 驗證失敗 |
| 404 | 找不到 Canvas |
| 409 | 同一 Canvas 下已存在相同名稱的 Pod |

### curl 範例

```bash
# 建立 Pod（使用 canvas name）
curl -X POST http://localhost:3001/api/canvas/my-canvas/pods \
  -H "Content-Type: application/json" \
  -d '{"name": "My Pod", "x": 100, "y": 200}'

# 建立 Pod 並指定 model
curl -X POST http://localhost:3001/api/canvas/my-canvas/pods \
  -H "Content-Type: application/json" \
  -d '{"name": "Sonnet Pod", "x": 244, "y": 200, "model": "sonnet"}'
```

---

## DELETE /api/canvas/:id/pods/:podId

刪除指定 Canvas 下的 Pod。`:id` 支援 UUID 或 name，`:podId` 支援 UUID 或 name。

### 成功回應 200

```json
{
  "success": true
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 404 | 找不到 Canvas 或找不到 Pod |
| 500 | 刪除 Pod 時發生錯誤 |

### curl 範例

```bash
# 用 canvas name 刪除 Pod（podId 為 UUID）
curl -X DELETE http://localhost:3001/api/canvas/my-canvas/pods/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx

# 用 canvas UUID 刪除 Pod（podId 為 UUID）
curl -X DELETE http://localhost:3001/api/canvas/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx/pods/yyyyyyyy-yyyy-4yyy-yyyy-yyyyyyyyyyyy

# 用 Pod 名稱刪除 Pod
curl -X DELETE http://localhost:3001/api/canvas/my-canvas/pods/My%20Pod
```

---

## GET /api/canvas/:id/pods/:podId/download

下載指定 Pod 工作目錄的 zip 壓縮檔。`:id` 支援 UUID 或 name，`:podId` 支援 UUID 或 name。

### 成功回應 200

回應 `Content-Type: application/zip`，`Content-Disposition: attachment; filename="<pod-name>.zip"`，Body 為 zip 二進位內容。

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 404 | 找不到 Canvas、找不到 Pod 或工作目錄不存在 |
| 500 | 壓縮時發生錯誤 |

### curl 範例

```bash
# 下載 Pod 工作目錄 zip（podId 為 UUID）
curl -O -J http://localhost:3001/api/canvas/my-canvas/pods/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx/download

# 用 Pod 名稱下載
curl -O -J http://localhost:3001/api/canvas/my-canvas/pods/My%20Pod/download
```

---

## PATCH /api/canvas/:id/pods/:podId

重新命名指定 Canvas 下的 Pod。`:id` 支援 UUID 或 name，`:podId` 支援 UUID 或 name。

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| name | string | 是 | 新的 Pod 名稱，1-100 字元 |

### 成功回應 200

```json
{
  "pod": {
    "id": "xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx",
    "name": "New Pod Name",
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
  }
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 400 | 無效的請求格式 / Pod 名稱驗證失敗 |
| 404 | 找不到 Canvas 或找不到 Pod |
| 409 | 同一 Canvas 下已存在相同名稱的 Pod |

### curl 範例

```bash
# 用 canvas name 重新命名 Pod（podId 為 UUID）
curl -X PATCH http://localhost:3001/api/canvas/my-canvas/pods/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -d '{"name": "New Pod Name"}'

# 用 Pod 名稱重新命名 Pod
curl -X PATCH http://localhost:3001/api/canvas/my-canvas/pods/Old%20Pod%20Name \
  -H "Content-Type: application/json" \
  -d '{"name": "New Pod Name"}'
```
