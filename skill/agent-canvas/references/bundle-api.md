# Bundle Import API

## POST /api/bundles/import

上傳本地 skill bundle 的 ZIP 壓縮檔並直接匯入管理清單。

此 API 用於安裝 bundle，不會產生 `uploadSessionId`，也不會觸發 Pod 對話附件流程。

### Request

- **Content-Type**：`multipart/form-data`

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| bundle | File | 是 | 要匯入的 bundle ZIP 檔 |

#### 接受規則

- 壓縮檔大小上限為 10 MB
- 解壓後總大小上限為 25 MB
- 單一檔案大小上限為 5 MB
- bundle 內檔案數量上限為 500 個
- 壓縮檔內至少要有一個 `SKILL.md`
- `plugin.json` / `.claude-plugin/plugin.json` 可省略，系統會自動 fallback metadata
- 不接受路徑穿越、symlink、空壓縮檔、ZIP64 或非法 ZIP

### 成功回應 201

```json
{
  "bundle": {
    "id": "upload:3f4c7fd94d8f7af4f5ad42a0c9218f3e",
    "source": {
      "type": "upload",
      "ref": "3f4c7fd94d8f7af4f5ad42a0c9218f3e"
    },
    "githubRepo": "3f4c7fd94d8f7af4f5ad42a0c9218f3e",
    "displayName": "Plan Bundle",
    "description": "本地匯入的 skill bundle",
    "installPath": "/tmp/AgentCanvas/plugins/upload__3f4c7fd94d8f7af4f5ad42a0c9218f3e",
    "sortIndex": 0,
    "installedAt": "2026-05-31T12:34:56.000Z",
    "updatedAt": "2026-05-31T12:34:56.000Z"
  }
}
```

### 錯誤回應格式

```json
{
  "error": "錯誤說明",
  "code": "ERROR_CODE"
}
```

### 錯誤碼表

| 狀態碼 | code | 說明 |
|--------|------|------|
| 400 | `INVALID_BUNDLE_FORM_DATA` | 無法解析 multipart/form-data |
| 400 | `BUNDLE_FILE_REQUIRED` | 缺少 `bundle` 欄位 |
| 400 | `BUNDLE_FILE_INVALID` | `bundle` 欄位不是檔案 |
| 413 | `BUNDLE_FILE_TOO_LARGE` | ZIP 壓縮檔超過 10 MB 上限 |
| 400 | `BUNDLE_SKILL_NOT_FOUND` | bundle 內找不到任何 `SKILL.md` |
| 400 | `EMPTY_BUNDLE_ARCHIVE` | ZIP 內沒有可匯入內容 |
| 400 | `BUNDLE_PATH_TRAVERSAL` | ZIP 內含不安全路徑 |
| 400 | `BUNDLE_SYMLINK_FORBIDDEN` | ZIP 內含 symlink |
| 413 | `BUNDLE_ENTRY_TOO_LARGE` | ZIP 內單一檔案超過 5 MB 上限 |
| 413 | `BUNDLE_ARCHIVE_TOO_LARGE` | ZIP 解壓後總大小超過 25 MB 上限 |
| 400 | `BUNDLE_TOO_MANY_FILES` | ZIP 內檔案數量超過 500 個 |
| 400 | `INVALID_BUNDLE_ARCHIVE` | 檔案不是合法 ZIP 或內容格式異常 |
| 409 | `PLUGIN_ALREADY_INSTALLED` | 相同來源的 bundle 已存在 |
| 500 | 其他 | 其他未分類匯入失敗 |

### curl 範例

```bash
curl -X POST http://localhost:3001/api/bundles/import \
  -F "bundle=@/path/to/my-skill-bundle.zip"
```
