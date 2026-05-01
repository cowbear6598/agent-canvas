# AI Provider 系統訊息

### 情境：使用者在 Claude Pod 發送訊息後遇到 Provider 錯誤
- Given 使用者正在 Claude Pod 的對話框中
- When 送出訊息後 Claude 回傳認證、額度、服務暫時不可用或其他執行失敗訊息
- Then 對話框內出現一則保留原文的 system message，且不跳錯誤 Toast

### 情境：使用者在 Codex Pod 發送訊息後遇到 Provider 錯誤
- Given 使用者正在 Codex Pod 的對話框中
- When 送出訊息後 Codex CLI 回傳 JSON 事件中的錯誤訊息
- Then 對話框內出現一則保留原文的 system message，且不跳錯誤 Toast

### 情境：使用者在 Gemini Pod 發送訊息後遇到 Provider 錯誤
- Given 使用者正在 Gemini Pod 的對話框中
- When 送出訊息後 Gemini CLI 回傳串流錯誤或最終失敗訊息
- Then 對話框內出現一則保留原文的 system message，且不跳錯誤 Toast

### 情境：使用者重新打開對話紀錄查看先前錯誤
- Given 使用者先前的對話曾發生 provider 錯誤
- When 重新打開 Pod 對話框或 Run 歷史對話框
- Then 可以在原本對話脈絡中看到該 system message

### 情境：使用者查看 Workflow / Run 中失敗 Pod 的對話
- Given 使用者正在查看一個 Run 的對話紀錄
- When 某個 Pod 在執行過程中失敗
- Then 失敗原因顯示在該 Pod 的對話框內，而不是另外跳 Toast

### 情境：使用者修正問題後再次送出訊息
- Given 對話框內已經出現一則 system message
- When 使用者修正登入、額度或設定問題後再次送出
- Then 新的對話接續在原本紀錄後面，舊的 system message 保留作為上下文
