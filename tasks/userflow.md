# User Flow

## 用 Codex provider 在指定 Repo 內對話

### 情境：使用者把 Repository 拖到 Pod 後用 Codex 對話
- Given 使用者在畫布上有一個 Pod，且 provider 設定為 Codex
- When 使用者把一個 RepositoryNote 拖到該 Pod 上，並開始對話
- Then Codex 在該 repo 的目錄裡執行，且能讀寫該 repo 的檔案、能上網安裝套件或推送

### 情境：使用者沒有拖 Repository 直接用 Codex 對話
- Given 使用者有一個 Pod，provider 設定為 Codex，沒有綁定 Repository
- When 使用者直接開始對話
- Then Codex 在該 Pod 預設的工作空間裡執行，行為一致

### 情境：使用者透過 Codex 安裝套件或推送程式碼
- Given 使用者在綁定 Repository 的 Pod 上用 Codex 對話
- When 使用者請 Codex 執行需要網路的操作（例如安裝套件、推送 git）
- Then 操作能成功完成，不會被沙箱阻擋

### 情境：使用者請 Codex 修改 Repo 之外的檔案
- Given 使用者在綁定 Repository 的 Pod 上用 Codex 對話
- When 使用者請 Codex 寫入該 repo 範圍之外的檔案
- Then Codex 不會寫到該範圍之外，使用者會看到操作被沙箱限制

## 用 Claude provider 在指定 Repo 內對話

### 情境：使用者把 Repository 拖到 Pod 後用 Claude 對話
- Given 使用者在畫布上有一個 Pod，且 provider 設定為 Claude
- When 使用者把一個 RepositoryNote 拖到該 Pod 上，並開始對話
- Then Claude agent 在該 repo 的目錄裡執行，能正確存取該 repo 的內容

### 情境：使用者沒有拖 Repository 直接用 Claude 對話
- Given 使用者有一個 Pod，provider 設定為 Claude，沒有綁定 Repository
- When 使用者直接開始對話
- Then Claude agent 在該 Pod 預設的工作空間裡執行，行為一致

## 在同一個 Pod 切換 provider

### 情境：使用者把 Pod 從 Codex 切到 Claude
- Given 使用者有一個綁定 Repository 的 Pod，目前用 Codex
- When 使用者把該 Pod 的 provider 切到 Claude 並繼續對話
- Then Claude 在同一個 repo 目錄裡執行，使用者感受到的工作範圍一致

### 情境：使用者把 Pod 從 Claude 切到 Codex
- Given 使用者有一個綁定 Repository 的 Pod，目前用 Claude
- When 使用者把該 Pod 的 provider 切到 Codex 並繼續對話
- Then Codex 在同一個 repo 目錄裡執行，使用者感受到的工作範圍一致

## Pod 路徑解析失敗

### 情境：使用者用一個指向不合法路徑的 Pod 開始對話
- Given 使用者有一個 Pod，其 Repository 或工作空間路徑已經失效或不在允許的範圍內
- When 使用者開始對話
- Then 對話無法啟動，使用者會看到一則中文錯誤訊息說明路徑無法使用
