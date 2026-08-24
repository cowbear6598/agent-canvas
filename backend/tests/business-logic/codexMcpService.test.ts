import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/mcp/codexMcpReader.js", () => ({
  readCodexMcpServers: vi.fn(),
  readCodexPluginEnabledOverrides: vi.fn(),
  readCodexPluginMcpEnabledOverrides: vi.fn(),
}));

import {
  readCodexMcpServers,
  readCodexPluginEnabledOverrides,
  readCodexPluginMcpEnabledOverrides,
} from "../../src/services/mcp/codexMcpReader.js";
import {
  buildCodexPluginMcpKey,
  buildCodexUserMcpKey,
  CodexMcpService,
} from "../../src/services/codex/codexMcpService.js";

describe("CodexMcpService", () => {
  beforeEach(() => {
    vi.mocked(readCodexMcpServers).mockReturnValue([]);
    vi.mocked(readCodexPluginEnabledOverrides).mockReturnValue([]);
    vi.mocked(readCodexPluginMcpEnabledOverrides).mockReturnValue([]);
  });

  it("保留同名的使用者與 Plugin MCP，並依來源建立不同 key", async () => {
    vi.mocked(readCodexMcpServers).mockReturnValue([
      { name: "search", type: "http", enabled: true },
    ]);
    const service = new CodexMcpService(async () => [
      {
        pluginId: "openai/search",
        name: "search",
        source: "official",
        transport: "stdio",
        enabled: true,
      },
    ]);

    const entries = await service.list("/workspace");

    expect(entries).toEqual([
      expect.objectContaining({
        key: buildCodexUserMcpKey("search"),
        source: "user",
      }),
      expect.objectContaining({
        key: buildCodexPluginMcpKey("openai/search", "search"),
        source: "official",
      }),
    ]);
  });

  it("全域停用的 MCP 不可保留在 Pod 白名單，且所有原生 MCP 都會明確覆寫 enabled", async () => {
    vi.mocked(readCodexMcpServers).mockReturnValue([
      { name: "enabled-one", type: "stdio", enabled: true },
      { name: "disabled-one", type: "stdio", enabled: false },
    ]);
    const service = new CodexMcpService(async () => []);
    const entries = await service.list("/workspace");
    const selected = service.resolveSelectedKeys(
      [buildCodexUserMcpKey("enabled-one"), buildCodexUserMcpKey("disabled-one")],
      entries,
    );

    expect(selected).toEqual([buildCodexUserMcpKey("enabled-one")]);
    expect(service.buildRuntimeConfigArgs(selected, entries)).toEqual([
      "-c",
      "mcp_servers.enabled-one.enabled=true",
      "-c",
      "mcp_servers.disabled-one.enabled=false",
    ]);
  });

  it("使用者 MCP 使用 Codex CLI 可合併既有 transport 的裸 dotted path", async () => {
    vi.mocked(readCodexMcpServers).mockReturnValue([
      { name: "codegraph", type: "stdio", enabled: true },
    ]);
    const service = new CodexMcpService(async () => []);
    const entries = await service.list("/workspace");

    expect(service.buildRuntimeConfigArgs([], entries)).toEqual([
      "-c",
      "mcp_servers.codegraph.enabled=false",
    ]);
  });

  it("Plugin MCP 使用 plugin scoped config override", async () => {
    const service = new CodexMcpService(async () => [
      {
        pluginId: "acme:tools",
        name: "docs",
        source: "user",
        transport: "stdio",
        enabled: true,
      },
    ]);
    const entries = await service.list("/workspace");
    const selected = [buildCodexPluginMcpKey("acme:tools", "docs")];

    expect(service.buildRuntimeConfigArgs(selected, entries)).toEqual([
      "-c",
      "plugins.acme:tools.mcp_servers.docs.enabled=true",
    ]);
  });

  it("略過含點號、無法安全套用 Codex CLI dotted path 的來源", async () => {
    vi.mocked(readCodexMcpServers).mockReturnValue([
      { name: "unsafe.name", type: "stdio", enabled: true },
    ]);
    const service = new CodexMcpService(async () => [
      {
        pluginId: "unsafe.plugin",
        name: "docs",
        source: "user",
        transport: "stdio",
        enabled: true,
      },
    ]);

    expect(await service.list("/workspace")).toEqual([]);
  });

  it("Plugin 內個別 MCP 被全域停用時不可保留在 Pod 白名單", async () => {
    vi.mocked(readCodexPluginMcpEnabledOverrides).mockReturnValue([
      { pluginId: "acme", name: "docs", enabled: false },
    ]);
    const service = new CodexMcpService(async () => [
      {
        pluginId: "acme",
        name: "docs",
        source: "user",
        transport: "stdio",
        enabled: true,
      },
    ]);
    const entries = await service.list("/workspace");

    expect(entries[0]?.globallyEnabled).toBe(false);
    expect(
      service.resolveSelectedKeys([buildCodexPluginMcpKey("acme", "docs")], entries),
    ).toEqual([]);
  });
});
