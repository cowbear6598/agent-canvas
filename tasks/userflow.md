# User Flow：connection.status / decideStatus 拆分重構

## 背景

把 connection.status 上「執行狀態」與「AI 決策結果」兩個概念拆開：
- `connection.status` 純剩執行狀態（idle / active / queued / waiting）
- `connection.decideStatus`（既有但 FE 沒消費的欄位）承載決策結果（none / pending / approved / rejected / error）

順手修兩個 bug：
- Bug A：multi-input rejection 早於 approval 到達時被靜默丟掉
- Bug B：multi-input 阻擋觸發時，approved branch 連線卡在「running」樣式，導致最上游 Pod 的橡皮擦永遠 disabled

視覺與互動使用者**不應感知到任何變化**——以下情境是行為一致性檢查（不是新功能）。

---

## Branch 決策視覺

### 情境：使用者觀察 branch 連線正在判斷
- Given 一個 source pod 連著一條 branch connection 到下游
- When source pod 對話完成、AI 開始判斷要不要走這條 branch
- Then 該 connection 顯示「判斷中」的紫色流動動畫

### 情境：使用者看到 AI 選中這條 branch
- Given branch 正在判斷中
- When AI 判斷完成並選中這條
- Then 該 connection 從「判斷中」動畫切換為「已選中」紫色實線
- And 下游 pod 開始接手執行

### 情境：使用者看到 AI 拒絕這條 branch
- Given branch 正在判斷中
- When AI 判斷完成、選了別條（或選 None）
- Then 該 connection 切換為「拒絕」紅色樣式
- And 下游 pod 不會被觸發

### 情境：使用者看到 branch 判斷錯誤
- Given branch 正在判斷中
- When AI 呼叫過程出錯
- Then 該 connection 顯示「錯誤」橘色樣式

---

## 多重來源 Branch（multi-input）

### 情境：使用者用兩條 branch 連到同一個下游 pod，其中一條被選中、另一條被拒
- Given 下游 pod 同時被兩條 branch 連線連入，分別來自兩個不同 source pod
- When 兩條 branch 的 AI 判斷都完成，一條被選中、一條被拒
- Then 下游 pod 的觸發**不會發生**（因為有任一來源被拒，整個 multi-input 視為不觸發）
- And 被選中那條呈現「AI 選中」紫色樣式
- And 被拒那條呈現「拒絕」紅色

### 情境：使用者用兩條 branch 連到同一個下游 pod，第一條判斷完成的是「拒絕」、第二條晚到判斷出「選中」
- Given 下游 pod 被兩條 branch 連入
- And 兩個 source pod 不同時段完成對話（先後啟動 branch 判斷）
- When 第一個完成判斷的 source 把這條 branch 標為 rejected
- And 第二個完成判斷的 source 把這條 branch 標為 approved
- Then 下游 pod 一樣**不會**被觸發（rejected 已被正確記錄，approved 收到後判定整組有 rejection 不觸發）

### 情境：使用者用兩條 branch 連到同一個下游 pod，兩條都被選中
- Given 下游 pod 被兩條 branch 連入
- When 兩條 branch 的 AI 判斷都完成且皆選中
- Then 下游 pod 接收兩條來源合併後的內容並觸發執行

### 情境：使用者用兩條 branch 連到同一個下游 pod，兩條都被拒
- Given 下游 pod 被兩條 branch 連入
- When 兩條 branch 都被 AI 拒絕
- Then 下游 pod 不會被觸發
- And 兩條 connection 都呈現「拒絕」樣式

---

## 最上游 Pod 的橡皮擦（清除整條 workflow）

### 情境：使用者在工作流程仍在執行時，看到最上游 Pod 的橡皮擦 disable
- Given 最上游 pod 已觸發整條工作流程
- When 任何下游 pod 正在 chatting / summarizing，或任何 connection 正在執行（active / queued / waiting / 判斷中）
- Then 橡皮擦按鈕為 disabled

### 情境：使用者看到工作流程跑完後，橡皮擦自動 enabled
- Given 整條工作流程剛完成（所有 pod 回 idle、所有 connection 不再執行）
- When 使用者望向最上游 pod
- Then 橡皮擦按鈕回 enabled，可以按下清除整條 workflow

### 情境：使用者觀察 multi-input 部分被拒導致下游不觸發後，橡皮擦狀態正確
- Given 兩條 branch 連到同一下游、一條被選一條被拒、下游沒被觸發
- When 整條工作流程的其他分支也都跑完
- Then 最上游 pod 的橡皮擦回 enabled（**這是修正的核心 bug：原本會卡 disabled**）

---

## Branch 連線右鍵操作

### 情境：使用者把已被 AI 拒絕的 branch 連線切換成 auto / direct
- Given 一條 branch connection 已被標為「拒絕」
- When 使用者透過右鍵切換 trigger mode 為 auto 或 direct
- Then 該 connection 切換成功，原本的決策狀態被清除（不再呈現紅色）

### 情境：使用者修改 branch 的 label / description / provider / model
- Given branch connection 已存在
- When 使用者透過右鍵或 modal 修改任一欄位
- Then 修改成功，視覺與設定一致（與重構前行為相同）

---

## 工作流程清除（橡皮擦點下後）

### 情境：使用者按下橡皮擦清除整條 workflow
- Given 工作流程已跑完，橡皮擦 enabled
- When 使用者長按或點擊橡皮擦並確認清除
- Then 整條工作流程的所有 connection 決策狀態被清掉、訊息清空、connection 與 pod 回到初始狀態
