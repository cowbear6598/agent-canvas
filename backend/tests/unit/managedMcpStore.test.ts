import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { managedMcpStore } from "../../src/services/mcp/managedMcpStore.js";

describe("managedMcpStore", () => {
  beforeEach(() => {
    resetStatements();
    initTestDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("建立 stdio entry 成功", () => {
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

  it("更新 http/sse entry 保留同一個 name", () => {
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

  it("重複 name 被拒絕", () => {
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

  it("刪除 entry 後 list 不再回傳", () => {
    const created = managedMcpStore.save({
      name: "temporary-server",
      transport: "stdio",
      enabled: false,
      command: "node",
      args: ["server.js"],
    });

    const deleted = managedMcpStore.delete(created.id);

    expect(deleted).toBe(true);
    expect(managedMcpStore.list().map((item) => item.name)).not.toContain(
      "temporary-server",
    );
  });
});
