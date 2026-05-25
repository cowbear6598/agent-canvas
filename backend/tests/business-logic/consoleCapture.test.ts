import {
  allowConsoleOutput,
  findUnexpectedConsoleOutputs,
  type ConsoleOutputAllowlistEntry,
} from "../setup/testConfig.js";

describe("console warning/error capture helper", () => {
  const makeOutput = (message: string) => ({
    method: "error" as const,
    args: [message],
    message,
    testName: "console capture 測試",
  });

  it("未列入 allowlist 的輸出會被判定為未預期", () => {
    const unexpected = findUnexpectedConsoleOutputs(
      [makeOutput("未預期錯誤")],
      [],
    );

    expect(unexpected).toHaveLength(1);
    expect(unexpected[0].message).toBe("未預期錯誤");
  });

  it("已列入 allowlist 的輸出會被視為合法", () => {
    const allowlist: ConsoleOutputAllowlistEntry[] = [
      {
        method: "error",
        messageIncludes: "可預期錯誤",
      },
    ];

    const unexpected = findUnexpectedConsoleOutputs(
      [makeOutput("可預期錯誤：連線中斷")],
      allowlist,
    );

    expect(unexpected).toHaveLength(0);
  });

  it("測試可用 runtime allowlist 明確允許預期 console.error", () => {
    allowConsoleOutput({
      method: "error",
      messageIncludes: "此輸出由測試明確允許",
    });

    console.error("此輸出由測試明確允許");
  });
});
