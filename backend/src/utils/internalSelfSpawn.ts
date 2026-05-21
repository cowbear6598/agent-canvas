import path from "path";
import { fileURLToPath } from "url";

/**
 * 建構「以自己 binary 為 child process」的 spawn config。
 *
 * 用途：goalRuntime / managed MCP proxy 需要 spawn 一個 MCP server child，
 * 該 child 是本 binary 自己（透過 internal flag 進入 bridge 模式）。
 *
 * 兩種模式：
 *   - compiled binary（bun build --compile）：entry 已 baked 為 cli.ts，
 *     直接 spawn execPath + [flag] 就會進到 cli.ts 的 flag dispatch。
 *   - dev（bun src/index.ts）：entry 是 index.ts 不是 cli.ts，且後端 daemon 的
 *     process.argv[1] 是 index.ts，不能沿用。改從 helper 自己的模組位置反推
 *     cli.ts 路徑（同 src/ 目錄），spawn 後 cli.ts 會走 import.meta.main 路徑
 *     觸發 flag dispatch。
 */
export function buildInternalSelfSpawn(flag: string): {
  command: string;
  args: string[];
} {
  const isCompiled =
    process.env.AGENT_CANVAS_COMPILED === "1" ||
    !process.argv[1] ||
    process.argv[1].includes("$bunfs");

  if (isCompiled) {
    return {
      command: process.execPath || "bun",
      args: [flag],
    };
  }

  // dev：helper 位於 backend/src/utils/internalSelfSpawn.ts → 反推 backend/src/cli.ts
  const helperDir = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.join(helperDir, "..", "cli.ts");
  return {
    command: process.execPath || "bun",
    args: [cliPath, flag],
  };
}
