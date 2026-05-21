import { describe, expect, it } from "vitest";
import { managedMcpRegistryInputSchema } from "../../src/schemas/mcpSchemas.js";

function baseStdio(env: Record<string, string>): unknown {
  return {
    name: "context7",
    transport: "stdio",
    enabled: true,
    command: "node",
    args: ["server.js"],
    env,
  };
}

describe("managedMcpRegistryInputSchema env 限制", () => {
  it("常見 key/value 合法時通過", () => {
    const result = managedMcpRegistryInputSchema.safeParse(
      baseStdio({ API_KEY: "abc123", HOME_PROXY: "" }),
    );
    expect(result.success).toBe(true);
  });

  it("env key 含小寫被禁止字 PATH（大小寫不敏感）也被擋下", () => {
    const result = managedMcpRegistryInputSchema.safeParse(
      baseStdio({ path: "/tmp/evil" }),
    );
    expect(result.success).toBe(false);
  });

  it("env key 為 LD_PRELOAD 被擋下", () => {
    const result = managedMcpRegistryInputSchema.safeParse(
      baseStdio({ LD_PRELOAD: "/tmp/x.so" }),
    );
    expect(result.success).toBe(false);
  });

  it("env key 以 DYLD_ 開頭被擋下", () => {
    const result = managedMcpRegistryInputSchema.safeParse(
      baseStdio({ DYLD_INSERT_LIBRARIES: "/tmp/x.dylib" }),
    );
    expect(result.success).toBe(false);
  });

  it("env key 含非法字元（含空白）被擋下", () => {
    const result = managedMcpRegistryInputSchema.safeParse(
      baseStdio({ "BAD KEY": "x" }),
    );
    expect(result.success).toBe(false);
  });

  it("env 超過 32 keys 被擋下", () => {
    const env: Record<string, string> = {};
    for (let i = 0; i < 33; i += 1) {
      env[`KEY_${i}`] = "v";
    }
    const result = managedMcpRegistryInputSchema.safeParse(baseStdio(env));
    expect(result.success).toBe(false);
  });
});
