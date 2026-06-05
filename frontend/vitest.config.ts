import { defineConfig, mergeConfig } from "vitest/config";
import { createViteConfig } from "./vite.config";

export default mergeConfig(
  createViteConfig("test"),
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["tests/setup.ts"],
      include: ["tests/**/*.test.ts"],
      reporters: ["verbose"],
    },
  }),
);
