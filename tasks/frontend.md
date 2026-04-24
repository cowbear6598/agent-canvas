# 前端實作計畫書 — Pod Model Selector 改版

> 目的：把 `PodModelSelector` 從 Pod 左上角的 3 張垂直直立窄卡改為 Pod 上緣中央的一條橫向寬版 tag，hover 時整個組合「扶起來」，其他 model 選項從上方垂直堆疊長出。純前端改動，不動後端、不動 slot 系統架構、不保留向後相容。

## 測試案例列表（先列名稱，Phase 4 才實作）

1. 預設只顯示當前 active model 橫向 tag（非 active 選項不渲染或不可見）
2. Hover 時整體往上扶起、非 active 選項展開可見
3. 點擊非 active 選項會 emit `update:model` 帶正確 value
4. 點擊當前 active 選項不會 emit，會觸發收合動畫
5. Hover 離開後經過 debounce 自動收合回預設
6. Hover 在 active 與非 active 選項之間移動不會誤收合（hover 容錯區覆蓋縫隙）
7. Codex provider 只有單一選項時不展開非 active 區塊
8. Selector 寬度約為 Pod 上緣的 50%、水平置中
9. 展開時不遮擋 Pod 中央的 PodMiniScreen（z-index 層疊正確）
10. 多個 Pod 的 selector 互相獨立，hover 一個不會影響另一個

---

### Phase 1

A. 盤點與確認改動範圍
  - [ ] 開啟 `/frontend/src/components/pod/PodModelSelector.vue`，確認 L16-18 的三個時間常數（`HOVER_DEBOUNCE_MS` / `COLLAPSE_ANIMATION_MS` / `SELECT_FEEDBACK_DELAY_MS`）會完整保留，這次只改視覺與 DOM 結構
  - [ ] 確認 `isHovered` / `isAnimating` / `isCollapsing` / `hoverTimeoutId` 四個 ref 狀態機邏輯保留不動，`handleMouseEnter` / `handleMouseLeave` / `selectModel` 三個 handler 也保留
  - [ ] 確認 `allOptions` / `isSingleOption` / `sortedOptions` 三個 computed 的語義（active 在第一個）維持不變，僅 template 呈現順序可能調整
  - [ ] 確認 `emit("update:model", model)` 只有 `selectModel` 一處呼叫，WebSocket 通訊不動
  - [ ] 確認 `CanvasPod.vue` L340-345 的 PodModelSelector 插入點位置不變，props 與 emits 不變
  - [ ] 確認 `/frontend/src/assets/styles/doodle/slots.css` 的 `.pod-slot-has-item`（L31-40）樣式（實線 border + `2px 2px 0` 投影）作為 has-note 風格參考

### Phase 2

A. 改寫 PodModelSelector.vue template
  - [ ] 外層 `.pod-model-slot` 容器保留，但移除左對齊語意，改為用於「上方中央」定位的錨點
  - [ ] 容器改為 stack 垂直堆疊排列：`.model-cards-stack`（或沿用 `.model-cards-container`，但語義已改）
  - [ ] 堆疊順序：非 active 選項放上面（離 Pod 遠）、active 選項固定在最下面（貼 Pod 上緣）
    - 排序策略：在 template 反轉 `sortedOptions` 或用 CSS `flex-direction: column-reverse`，擇一即可，計畫採用 CSS 方式以減少 computed 改動
  - [ ] 每個 `.model-card` 仍為 `<button>`，保留 `@mouseenter`（active 才觸發展開）與 `@click.stop="selectModel"`
  - [ ] active 卡片永遠可見（預設狀態）；非 active 卡片預設 `opacity: 0; pointer-events: none`，`.expanded` 時變 `opacity: 1; pointer-events: auto`
  - [ ] 加入 hover 容錯區：在堆疊上方與左右擴一圈透明 padding / `::before` 偽元素，讓滑鼠在縫隙移動仍被容器捕捉到
  - [ ] 維持 `TransitionGroup` 包裝，確保切換動畫自然；若 `card-swap` 動畫類別在橫向場景下不適合，改名並於 CSS 重新定義

B. 改寫 PodModelSelector.vue CSS
  - [ ] 刪除 `.model-card` 上的 `writing-mode: vertical-lr` / `text-orientation: upright` / `letter-spacing: -2px` / `width: 24px` / `min-height: 70px` / `height: max-content`，全部換成橫向 tag 尺寸
  - [ ] 新增橫向 tag 樣式：
    - padding 約 `4px 10px`（視 Pod 上緣高度微調）
    - `border: 2px solid var(--doodle-ink)`、`border-radius: 2px`（對齊 `pod-slot-has-item` 的實線風格）
    - `box-shadow: 2px 2px 0 oklch(0.4 0.02 50 / 0.3)`（對齊 has-note 投影）
    - hover 時 `box-shadow: 3px 3px 0 oklch(0.4 0.02 50 / 0.4)`（對齊 has-note hover 投影）
    - 字體保留 `var(--font-mono)`，字級改回水平常態（約 `10px`~`11px`），`letter-spacing` 回正常
    - `white-space: nowrap` 保留
  - [ ] `.pod-model-slot` 定位改為上方中央：
    - `position: absolute; bottom: 100%;`
    - `left: 50%; transform: translateX(-50%);`
    - 移除原本的 `left: 12px`
    - `margin-bottom` 微調讓 active tag 貼住 Pod 上緣（原本 `-12px` 視新尺寸調整，避免重疊到 pod border）
  - [ ] Selector 寬度為 Pod 上緣 50%：
    - 採 `width: 50%` 讓它相對 Pod wrapper（`CanvasPod.vue` 的 `.pod-with-notch` 或 `.pod-doodle`）父層為基準；若發現父層不是定位上下文，再於父層加 `position: relative`（僅在必要時）
    - 備案：若 50% 寬讓文字太擠，用 `min-width` 設一個合理下限
    - `.model-card` 內寬 `width: 100%` 讓每張卡片填滿 selector 寬度，視覺上成為等寬堆疊
  - [ ] 垂直堆疊容器 `.model-cards-stack`：
    - `display: flex; flex-direction: column-reverse;`（active 顯示在最下靠近 Pod）
    - `gap: 4px`
    - `transition: transform 0.3s ease;`
    - 預設 `transform: translateY(2px)`（輕微往下貼 Pod；實作時為對齊 notch，減少下推深度到 2px）
    - `.expanded` 時 `transform: translateY(-12px)`（整個組合扶起來讓出展開空間；展開行程約 14px，配合預設 2px 下推）
  - [ ] 非 active 卡片可見性規則：
    - 預設 `opacity: 0; pointer-events: none; transform: translateY(8px);`（稍微往下、為展開做起點）
    - `.expanded .model-card:not(.active)` → `opacity: 1; pointer-events: auto; transform: translateY(0);`
    - `.collapsing .model-card:not(.active)` → `opacity: 0` 過渡出場
  - [ ] z-index 層級：
    - `.pod-model-slot` 原 `z-index: -1` 會讓 selector 在 Pod 後面，原設計因為位置在上方所以 Pod 只遮到下緣；改為上方中央後若 Pod 內 mini screen 高度/位置有交疊風險，改為 `z-index: 1`，並確認 active tag 預設 `translateY(12px)` 不會蓋到 `PodMiniScreen`（Mini Screen 位置為 Pod 內部、不在 Pod 上緣外，理論上安全）
    - 展開時 selector 顯示在 Pod 上方外部，`z-index` 只需要高過 Pod 外框光暈層即可，不要蓋過跨 Pod 的 context menu
  - [ ] Hover 容錯區：
    - 於 `.pod-model-slot` 新增 `padding: 8px 12px 0 12px`（向上、左右延伸）讓堆疊縫隙與頂部空白仍在 `mouseleave` 判定內
    - 或改用 `::before` 偽元素覆蓋整個容器擴大版圖（擇一即可，計畫採 padding 方案較單純）
  - [ ] 保留 `.card-opus` / `.card-sonnet` / `.card-haiku` / `.card-codex` 的背景色 class，但垂直文字 hack（`letter-spacing: -1px` 等）一併刪除
  - [ ] 刪除 `.card-single` 下關於 cursor 的 hack 以外的 vertical-only 規則；cursor 規則保留

C. CanvasPod.vue 定位上下文確認
  - [ ] 在 `CanvasPod.vue` L335-345 確認 PodModelSelector 的直接父層（`.pod-with-notch` 或 `.pod-doodle`）有 `position: relative`；若無則補上，讓 `width: 50%` 相對 Pod 寬度計算
  - [ ] 若父層已經 `position: relative`，不做變動；只在開發者工具驗證寬度為 Pod 的 50% 後打勾
  - [ ] 不修改 emit listener，不修改 provider / currentModel props 傳遞

### Phase 3

A. 清理舊程式碼與驗證
  - [ ] 全域搜尋 `writing-mode: vertical-lr`，確認只剩非 PodModelSelector 的 slot 相關檔，不殘留在本元件
  - [ ] 全域搜尋 `.card-opus` / `.card-sonnet` / `.card-haiku` / `.card-codex` 的使用位置，確保改版後仍正確對應
  - [ ] 在瀏覽器手動驗證 10 個 user flow 情境：
    - 預設只看到 active tag、水平置中、寬度約 Pod 50%
    - Hover 整體扶起、非 active 選項從上方長出
    - 點擊非 active 選項切換 model，收合後只剩新 active
    - 點擊當前 active 選項 → 收合動畫
    - 離開 hover 區 → 經 debounce 收合
    - Hover 在縫隙之間移動不誤收合
    - Codex 單一選項只顯示 tag、hover 不展開額外選項
    - Mini Screen 不被遮擋、不抖動
    - 兩個 Pod 同時存在時互不影響
    - 連續快速 hover / click 不會卡死動畫（沿用 `isAnimating` 保護）
  - [ ] 跑 `bun run style`（前端目錄下）確認 ESLint + TypeScript 無警告
  - [ ] 告知使用者改動屬於純前端，不需重啟後端

### Phase 4

A. 補測試
  - [ ] 於 `PodModelSelector` 對應的測試檔（如無則新增 `PodModelSelector.spec.ts`，擺在元件同層或既有 `__tests__` 目錄，依專案慣例）寫以下 Vue Test：
    - [ ] 測試 1：預設只顯示 active model tag（斷言非 active 的 button opacity 為 0 或 `pointer-events: none`）
    - [ ] 測試 2：Hover 後展開，非 active 選項可見且可點擊
    - [ ] 測試 3：點擊非 active 選項 emit `update:model` 帶正確值
    - [ ] 測試 4：點擊 active 選項不 emit、進入 collapsing 狀態
    - [ ] 測試 5：`mouseleave` 後經 `HOVER_DEBOUNCE_MS` 收合（用 `vi.useFakeTimers()` 推進時間）
    - [ ] 測試 6：Codex provider 且只有單一選項時，不進入可切換模式（`selectModel` 早退）
  - [ ] 跑 `bun run test`（前端目錄下）確認新測試全通過，既有測試無回歸
