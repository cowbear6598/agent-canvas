# frontend

- Vue3 + Typescript
- Agent 畫布的前端
- 與後端使用 websocket 溝通

## 技術棧

- Vue3
- TypeScript
- Tailwind CSS
- Shadcn UI
- Pinia

# backend

- Bun + TypeScript
- Agent 畫布的後端
- 串接 Claude Agent SDK
- 使用 Bun 原生 WebSocket (已從 Socket.io 遷移)

## 技術棧

- Bun Runtime
- TypeScript
- Bun 原生 WebSocket
- Claude Agent SDK

## 後端 API 文件

- 如果有 新增/更新/刪除 API Router 的話要同步更新專案底下的 skill，WebSocket 不需要更新

# 特別注意

- 不需要執行 `bun run dev` 指令，我這邊都會常駐開啟
- `bun run test` 可以確認測試有沒有壞掉而不是 `bun test`
- `bun run style` 可以確認 eslint 以及 type
- 如果你有改動到任何後端程式碼，請告訴我要重啟
- 錯誤訊息/註解內容，都使用 zh-TW 撰寫
