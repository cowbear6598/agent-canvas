import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  ssr: {
    // 強制 Vite SSR 將 zod 視為內部模組進行轉換，
    // 避免 Bun runtime 下 Vite SSR 外部模組解析失敗
    // （zod v4 的 re-export 結構在 Bun + Vite SSR 組合下會導致 named export 為 undefined）
    noExternal: ["zod"],
  },
  test: {
    globals: true,
    setupFiles: ["./tests/setup/testConfig.ts", "./tests/setup/globalSetup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // 整合測試共用 Server 和資料目錄，必須循序執行避免衝突
    fileParallelism: false,
    pool: "forks",
    reporters: ["verbose"],
  },
});
