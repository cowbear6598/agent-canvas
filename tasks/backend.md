## 後端實作計畫：Claude 外層 Sandbox 與 Multi-Instance 執行隔離

### 前提假設

- non-repo Pod 在 Multi-Instance 模式下，每個 run 會從 pod workspace 複製一份 snapshot 作為獨立工作區
- Normal mode 採 per-pod workspace / sandbox home
- Multi-Instance mode 採 per-run workspace / sandbox home
- 隔離是硬需求；若無法建立獨立 workspace 或 sandbox home，該次 run 應直接失敗，不回退到共享 workspace
- 本次範圍只做 backend，不新增前端設定面或切換開關

### 測試案例

- non-repo Multi-Instance run 建立時會配置獨立 workspace 與 sandbox home
- repo Multi-Instance run 建立時會同時配置 worktree 與獨立 sandbox home
- Normal mode 會解析到 pod-level workspace 與 pod-level sandbox home
- Run mode 會解析到 run-level workspace 與 run-level sandbox home
- run 刪除與程序 shutdown 會清理 non-repo run workspace、repo worktree、以及 run sandbox home
- Claude wrapper 會根據目前 cwd 對應到正確的 sandbox home 與 writable roots
- Claude 在 sandbox 下仍可使用已啟用的 MCP 與 Plugin
- Claude 嘗試寫入 workspace 以外位置時會被阻擋，但 `/tmp` 與 sandbox home 仍可寫
- 隔離資源建立失敗時，run 會進入 error，而不是退回共享 workspace
- summary / disposable chat 在 run mode 下也會吃到正確的 run-level workspace

### Phase 1

A. 建立通用執行路徑模型
  - [ ] 盤點目前所有只用單一路徑字串表達執行上下文的地方，統一收斂成「執行 workspace + sandbox home + 清理責任」的 runtime path model
  - [ ] 擴充 `run_pod_instances` 的持久化結構，讓 run instance 能保存非 repo 與 repo 兩種模式都需要的執行路徑資訊，而不是只存 `worktree_path`
  - [ ] 更新 `RunPodInstance`、`RunContext`、`runStore` row mapping 與相關 DTO，讓內部可以讀到新的 path model，同時維持前端仍看不到實體路徑
  - [ ] 新增集中式 path resolver，明確區分 normal mode 與 run mode 的 workspace / sandbox home 來源，避免各 service 各自推導

### Phase 2

A. 補齊 non-repo run workspace / home 生命週期
  - [ ] 在 run 建立流程中，為 non-repo Multi-Instance Pod 建立 run-level workspace 目錄
  - [ ] 將 pod workspace 內容複製到新建立的 run workspace，作為 run 啟動時的 snapshot
  - [ ] 為每個 run instance 建立對應的 sandbox home 根目錄，讓 Claude 內部狀態與 `/tmp` 以外的工具資料不互踩
  - [ ] 將 repo 與 non-repo 的 run-level 資源建立行為收斂到同一組 provisioning 流程，而不是 repo 用 worktree、non-repo 走另一套散落邏輯

B. 補齊 run 級清理
  - [ ] 在 run 自然完成、手動刪除、以及程序 shutdown 的清理流程中，一併回收 non-repo run workspace 與 run sandbox home
  - [ ] 保留既有 repo worktree 回收流程，但改成和新的 run workspace / home 清理共用同一個刪除入口
  - [ ] 補齊 orphan run 資源的辨識方式，確保異常中斷後下次啟動仍能沿既有 run 清理路徑回收殘留資料夾

### Phase 3

A. 建立 Claude sandbox wrapper 啟動模型
  - [ ] 新增 Claude wrapper 的啟動入口，讓 `pathToClaudeCodeExecutable` 指向 wrapper，而不是直接指向真實 `claude`
  - [ ] 在 wrapper 內依目前工作目錄推導本次執行對應的 sandbox home 與 writable roots，避免依賴 process-wide env 才能區分不同 run
  - [ ] 將真實 `~/.claude*` 視為 seed 來源，建立 managed sandbox home 的初始化流程；run mode 需從對應的 pod-level base home 複製出 run-level home
  - [ ] 定義 sandbox policy：允許寫 `cwd`、`/tmp`、sandbox home；其餘位置只讀
  - [ ] 以平台抽象包裝 macOS 與 Linux 的 sandbox 啟動行為，讓上層只依賴單一 launcher 介面

B. 確保 MCP / Plugin 可用
  - [ ] 確認 wrapper 與 sandbox policy 不會阻擋已啟用的 plugin install path、MCP command、以及其正常啟動所需的可讀系統路徑
  - [ ] 盤點 Claude provider 目前由 backend 組裝後傳入 SDK 的 MCP / Plugin 流程，確認切到 wrapper 後不需要改變使用者現有的啟用方式
  - [ ] 對第三方 MCP / Plugin 的執行約束定出 v1 邊界：先保證官方路徑與一般 CLI 依賴可用，不額外承諾所有第三方自訂寫路徑都能無痛運作

### Phase 4（可並行）

A. 將新 path model 接進聊天執行鏈
  - [ ] 將 `streamingChatExecutor` 從單純解析 `workspacePath` 改成消費新的 runtime path model
  - [ ] 更新 Claude provider / `runClaudeQuery` 所需的執行上下文，讓 wrapper 可以取得一致的 cwd 規則
  - [ ] 保持 Normal mode 仍使用 pod-level session / workspace，但讓 Multi-Instance mode 改吃 run-level session / workspace / home

B. 補齊 run mode 的其他 Claude 執行入口
  - [ ] 檢查 summary、disposable chat、workflow 內其他 Claude 執行入口，補上同一套 runtime path model，避免主聊天已隔離但 summary 仍落回 pod 原始路徑
  - [ ] 盤點是否有任何仍直接使用 `pod.workspacePath` 的 Claude 路徑，全部收斂到共用 resolver

### Phase 5

A. 資料遷移與相容整理
  - [ ] 為 `run_pod_instances` 新欄位或新結構補 migration
  - [ ] 保持現有 run 載入與刪除流程在舊資料上仍可運作，但不再新增只含 `worktree_path` 的新資料
  - [ ] 更新所有使用 `RunPodInstancePublic` 或 run wire format 的後端輸出組裝，確保新增的內部路徑資訊不會洩漏到前端

B. 文件與操作說明
  - [ ] 在 provider 或部署相關文件補充 Claude sandbox 的執行模型、Normal vs Multi-Instance 的 path/home 差異、以及真實 `~/.claude*` 僅作 seed 的原則
  - [ ] 記錄 plugin / MCP 的支援邊界與已知限制，避免使用者把全域 CLI 管理操作誤認為 sandbox 內一定可寫

### 測試規劃

#### Mock 邊界

- 需要 mock 的 wrapper interface：
  - `RunStore` / `PodStore` 的最外層資料存取介面
  - 新增的 runtime path provisioning / cleanup service
  - 新增的 sandbox launcher wrapper
  - 檔案系統 wrapper（若本次尚未有對應抽象，需先補）
  - `WorkspaceService` / `GitService` 這類跨檔案系統或 git 邊界的最外層 wrapper
- 不能 mock、必須走真實實作的內部邏輯：
  - run 建立與狀態流轉邏輯
  - runtime path resolver
  - provider 執行鏈的上下文組裝
  - run mode / normal mode 的 execution strategy 差異
- 不直接 mock 的底層：
  - `fs`
  - `simple-git`
  - Claude SDK 內部型別與第三方 CLI 細節

#### 測試內容

- `runExecutionService`：
  - non-repo Multi-Instance run 會建立 run workspace snapshot 與 run sandbox home
  - repo Multi-Instance run 會建立 worktree 與 run sandbox home
  - run 刪除與 shutdown 會回收 run 級資源
  - 隔離資源建立失敗時，run 直接進入錯誤，不退回共享 workspace
- runtime path resolver：
  - Normal mode 解析到 pod-level workspace / home
  - Run mode 解析到 run-level workspace / home
  - repo 與 non-repo 兩條路徑都會回傳正確結果
- Claude wrapper / launcher：
  - 會根據 cwd 映射到正確 sandbox home
  - 會以 seed 初始化 managed home
  - 會保留 `/tmp` 可寫與 workspace 外禁止寫入的規則
- Claude provider 執行鏈：
  - run mode 會把新的 path model 帶進 Claude 查詢
  - summary / disposable chat 在 run mode 會使用同一套 run-level 路徑
- A 類 wire-up smoke test：
  - run 建立後的對外事件 / 載入流程仍能成功帶出 run instance 資訊，不因 schema 或 DTO 接線遺漏而失效
