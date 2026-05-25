import { describe, expect, it } from "vitest";
import {
  allowConsoleOutput,
  findUnexpectedConsoleOutputs,
  type ConsoleOutputAllowlistEntry,
} from "../../setup";

describe("frontend console warning/error capture helper", () => {
  const makeOutput = (message: string) => ({
    method: "warn" as const,
    args: [message],
    message,
    testName: "frontend console capture 測試",
  });

  it("未列入 allowlist 的輸出會被判定為未預期", () => {
    const unexpected = findUnexpectedConsoleOutputs(
      [makeOutput("未預期 warning")],
      [],
    );

    expect(unexpected).toHaveLength(1);
    expect(unexpected[0]?.message).toBe("未預期 warning");
  });

  it("已列入 allowlist 的輸出會被視為合法", () => {
    const allowlist: ConsoleOutputAllowlistEntry[] = [
      {
        method: "warn",
        messageIncludes: "可預期 warning",
      },
    ];

    const unexpected = findUnexpectedConsoleOutputs(
      [makeOutput("可預期 warning：畫布不存在")],
      allowlist,
    );

    expect(unexpected).toHaveLength(0);
  });

  it("測試可用 runtime allowlist 明確允許預期 console.error", () => {
    allowConsoleOutput({
      method: "error",
      messageIncludes: "此輸出由前端測試明確允許",
    });

    console.error("此輸出由前端測試明確允許");
  });
});
