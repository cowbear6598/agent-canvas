import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { managedMcpStore } from "../../src/services/mcp/managedMcpStore.js";

describe("managedMcpStore business rules", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("stdio entry 會保留本機啟動設定並初始化為 unknown runtime 狀態", () => {
    const created = managedMcpStore.save({
      name: "context7",
      transport: "stdio",
      enabled: true,
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      cwd: "/tmp/project",
      env: { NODE_ENV: "test" },
    });

    expect(created.name).toBe("context7");
    expect(created.transport).toBe("stdio");
    expect(created.command).toBe("npx");
    expect(created.args).toEqual(["-y", "@upstash/context7-mcp"]);
    expect(created.cwd).toBe("/tmp/project");
    expect(created.env).toEqual({ NODE_ENV: "test" });
    expect(created.lastKnownStatus).toBe("unknown");
    expect(managedMcpStore.getByName("context7")?.id).toBe(created.id);
  });

  it("remote entry 更新 transport 時會清除 stdio 欄位並保留同一筆 registry identity", () => {
    const created = managedMcpStore.save({
      name: "remote-docs",
      transport: "http",
      enabled: true,
      url: "https://example.com/http",
    });

    const updated = managedMcpStore.save({
      id: created.id,
      name: "remote-docs",
      transport: "sse",
      enabled: true,
      url: "https://example.com/sse",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("remote-docs");
    expect(updated.transport).toBe("sse");
    expect(updated.url).toBe("https://example.com/sse");
    expect(updated.command).toBeNull();
    expect(updated.args).toEqual([]);
  });

  it("不同 transport 不能註冊重複 name，避免 pod 選取時指向不明確 target", () => {
    managedMcpStore.save({
      name: "context7",
      transport: "stdio",
      enabled: true,
      command: "npx",
    });

    expect(() =>
      managedMcpStore.save({
        name: "context7",
        transport: "http",
        enabled: true,
        url: "https://example.com/mcp",
      }),
    ).toThrow("managed MCP name 已存在");
  });

  it("runtime 狀態更新只影響健康狀態，不覆蓋 registry 設定", () => {
    managedMcpStore.save({
      name: "runtime-target",
      transport: "stdio",
      enabled: true,
      command: "node",
      args: ["server.js"],
      env: { API_TOKEN: "fake-token" },
    });

    const updated = managedMcpStore.updateRuntimeState(
      "runtime-target",
      "error",
      "connect timeout",
    );

    expect(updated).toMatchObject({
      name: "runtime-target",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      env: { API_TOKEN: "fake-token" },
      lastKnownStatus: "error",
      lastError: "connect timeout",
    });
  });

  it("空白 command 或 remote url 會被拒絕，避免產生不可啟動的 surface entry", () => {
    expect(() =>
      managedMcpStore.save({
        name: "blank-command",
        transport: "stdio",
        enabled: true,
        command: "   ",
      }),
    ).toThrow("stdio transport 需要 command");

    expect(() =>
      managedMcpStore.save({
        name: "blank-url",
        transport: "http",
        enabled: true,
        url: "   ",
      }),
    ).toThrow("http transport 需要 url");
  });
});
