# Canvas API

## GET /api/canvas/list

取得所有畫布清單。

```bash
curl http://localhost:3001/api/canvas/list
```

---

## POST /api/canvas

建立新畫布。

| 規則 | 說明 |
|------|------|
| 必填 | 不可省略或為空白字串 |
| 類型 | string |
| 長度 | 1-50 字元 |
| 允許字元 | 英文字母、數字、底線（_）、連字號（-）、空格 |
| 唯一性 | 不可與現有 Canvas 名稱重複 |
| 保留名稱 | 不可為 Windows 保留名稱（CON、PRN、AUX、NUL、COM1-9、LPT1-9） |

```bash
curl -X POST http://localhost:3001/api/canvas \
  -H "Content-Type: application/json" \
  -d '{"name": "my-canvas"}'
```

---

## DELETE /api/canvas/:id

刪除指定畫布。`:id` 支援 UUID 或 name。

```bash
curl -X DELETE http://localhost:3001/api/canvas/my-canvas
```

---

## PATCH /api/canvas/:id

重新命名指定畫布。`:id` 支援 UUID 或 name。

### Request Body

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| name | string | 是 | 新的畫布名稱 |

命名規則同建立畫布：

| 規則 | 說明 |
|------|------|
| 長度 | 1-50 字元 |
| 允許字元 | 英文字母、數字、底線（_）、連字號（-）、空格 |
| 唯一性 | 不可與現有 Canvas 名稱重複 |
| 保留名稱 | 不可為 Windows 保留名稱（CON、PRN、AUX、NUL、COM1-9、LPT1-9） |

### 成功回應 200

```json
{
  "canvas": {
    "id": "xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx",
    "name": "new-canvas-name"
  }
}
```

### 錯誤回應

| 狀態碼 | 說明 |
|--------|------|
| 400 | 名稱驗證失敗（空白、超長、非法字元、重複名稱等） |
| 404 | 找不到 Canvas |

### curl 範例

```bash
# 用 canvas name 重新命名
curl -X PATCH http://localhost:3001/api/canvas/my-canvas \
  -H "Content-Type: application/json" \
  -d '{"name": "new-canvas-name"}'

# 用 canvas UUID 重新命名
curl -X PATCH http://localhost:3001/api/canvas/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx \
  -H "Content-Type: application/json" \
  -d '{"name": "new-canvas-name"}'
```
