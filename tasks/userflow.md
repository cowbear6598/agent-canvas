## Claude Sandbox for Pod Execution

### 情境：一般模式的 Claude Pod 在自己的工作區內編輯檔案
- Given 使用者有一個一般模式的 Claude Pod
- When 送出一個需要建立或修改檔案的任務
- Then Claude 只會在這個 Pod 自己的工作區內留下變更

### 情境：一般模式的 Claude Pod 可以正常使用已啟用的 MCP 與 Plugin
- Given 使用者已為 Claude Pod 啟用 MCP 與 Plugin
- When 送出一個需要呼叫這些能力的任務
- Then Claude 仍可正常使用已啟用的 MCP 與 Plugin 完成工作

### 情境：Multi-Instance 的非 Repo Claude Pod 每次執行彼此隔離
- Given 使用者將一個未綁定 Git Repo 的 Claude Pod 切換為 Multi-Instance 模式
- When 幾乎同時送出兩個任務
- Then 每次執行都使用各自獨立的工作區，不會互相看到或覆蓋彼此的檔案變更

### 情境：Multi-Instance 的非 Repo Claude Pod 會從既有內容開始執行
- Given 使用者的非 Repo Claude Pod 既有工作區中已經有檔案與設定
- When 這個 Pod 產生新的 Multi-Instance 執行
- Then 新的執行會從一份獨立副本開始，而不是從空目錄開始

### 情境：綁定 Git Repo 的 Multi-Instance Claude Pod 每次執行彼此隔離
- Given 使用者將一個綁定 Git Repo 的 Claude Pod 切換為 Multi-Instance 模式
- When 幾乎同時送出兩個任務
- Then 每次執行都在各自獨立的 Repo 副本中進行，不會互相覆蓋彼此的檔案變更

### 情境：Claude 需要暫存檔與自身執行狀態時仍可完成任務
- Given 使用者送出一個需要產生暫存內容或使用 Claude 內部執行狀態的任務
- When Claude 在 sandbox 內執行
- Then 任務仍可正常完成，而且這些暫存內容不會污染其他 Pod 或其他執行

### 情境：Claude 嘗試寫入自己工作區以外的位置時被阻擋
- Given 使用者送出一個會引導 Claude 寫入其他目錄的任務
- When Claude 嘗試在自己工作區以外建立或修改檔案
- Then 這次寫入會被阻擋，且不會影響其他 Pod 或其他執行的檔案
