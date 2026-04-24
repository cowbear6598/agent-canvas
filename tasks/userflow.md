# User Flow — Provider 抽象層擴充性補齊

## 功能一：Pod 模型清單改為動態（來自後端 metadata）

### 情境：使用者開啟畫布時看到正確的模型清單
- Given 使用者開啟 Agent 畫布且 WebSocket 連線成功
- When 畫面上的 Pod 顯示模型選擇器
- Then 模型選擇器顯示的選項與該 Pod 所屬 provider（Claude 或 Codex）後端聲告的模型清單一致

### 情境：使用者切換 Pod 的 provider 後看到對應模型
- Given 使用者建立一個新的 Pod
- When 使用者將 Pod 的 provider 設定為 Codex
- Then 模型選擇器只顯示 Codex 支援的模型清單（從後端取得）

### 情境：WebSocket 連線剛建立、模型清單還沒載入完
- Given 使用者剛開啟畫布，WebSocket 連線瞬間尚未完成
- When Pod 的模型選擇器渲染
- Then 選擇器只顯示目前 Pod 的 model 一張卡片，不會有空白或錯誤畫面

### 情境：使用者切換模型
- Given 使用者看著模型選擇器，且清單已從後端載入
- When 使用者點擊清單中的另一個模型
- Then Pod 切換到該模型，訊息送出後後端以該模型回應

### 情境：WebSocket 斷線重連後
- Given 使用者因網路問題斷線，稍後自動重連成功
- When 重連完成
- Then 模型清單自動重新從後端載入，使用者不需手動重整

---

## 功能二：Model 白名單驗證（後端為準、不 fallback）

### 情境：使用者選擇了合法模型
- Given 使用者在模型選擇器上看到清單
- When 使用者點擊清單中任一選項
- Then Pod 的 model 更新成功，不會有錯誤

### 情境：異常請求嘗試寫入不合法模型
- Given 有人（或前端 bug）繞過 UI 直接發送切換模型的請求，model 值不在後端聲告的清單內
- When 後端接收到該請求
- Then 後端拒絕寫入（throw error），DB 不會被寫入非法值，前端收到錯誤回應
- And 後端**不會**自動把 model 改成預設值，因為使用者要求「驗證但不要 fallback」

---

## 功能三：新增第三個 Provider 時零硬編碼（開發者視角）

### 情境：開發者新增一個假想的 Gemini provider
- Given 開發者在 `backend/src/services/provider/` 下新增 geminiProvider.ts，並在 `index.ts` 的 registry 加入 `gemini: geminiProvider`
- When 開發者重啟後端
- Then podStore 的 provider 白名單驗證自動把 `gemini` 視為合法 provider，不需要改 podStore 程式碼

### 情境：新 Provider 聲告自己的模型清單
- Given 開發者在新 provider 的 metadata 宣告了 `availableModels`
- When 前端透過 `provider:list` 取得 provider 清單
- Then 使用者在該 provider 的 Pod 上看到新 provider 的模型清單，不需要改前端程式碼
