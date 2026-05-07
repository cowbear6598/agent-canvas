import os from "os";
import path from "path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  buildClaudeSandboxAllowWrite,
  buildClaudeSandboxDenyWrite,
  buildClaudeSandboxNetwork,
} from "../../src/services/claude/claudeSandboxPaths.js";
import { loadDomainWhitelist } from "../../src/services/claude/sandboxDomainWhitelist.js";

vi.mock("../../src/services/claude/sandboxDomainWhitelist.js", () => ({
  loadDomainWhitelist: vi.fn(),
}));

describe("buildClaudeSandboxAllowWrite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("傳入 workspacePath 時，回傳清單包含該路徑", () => {
    const result = buildClaudeSandboxAllowWrite("/canvas/my-workspace");
    expect(result).toContain("/canvas/my-workspace");
  });

  it("傳入 sandboxHomePath 時，清單包含該路徑", () => {
    const result = buildClaudeSandboxAllowWrite(
      "/canvas/my-workspace",
      "/sandbox/home",
    );
    expect(result).toContain("/sandbox/home");
  });

  it("不傳 sandboxHomePath 時，清單不含 sandboxHomePath", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");
    const result = buildClaudeSandboxAllowWrite("/canvas/my-workspace");
    // sandboxHomePath 未傳入，清單裡不應有 undefined 或 null
    expect(result.every((p) => typeof p === "string" && p !== "")).toBe(true);
    // 確認長度比有傳 sandboxHomePath 時少一個
    const resultWithHome = buildClaudeSandboxAllowWrite(
      "/canvas/my-workspace",
      "/sandbox/home",
    );
    expect(result.length).toBe(resultWithHome.length - 1);
  });

  it("Darwin 平台：含 /private/tmp 與 Library/Application Support/uv，不含 .local/share/uv", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/Users/testuser");
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    const result = buildClaudeSandboxAllowWrite("/canvas/ws");

    expect(result).toContain("/private/tmp");
    expect(result).toContain(
      path.join("/Users/testuser", "Library", "Application Support", "uv"),
    );
    expect(result.some((p) => p.includes(".local/share/uv"))).toBe(false);
  });

  it("Linux 平台：含 /tmp，不含 /private/tmp，不含 Library/Application Support/uv", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    const result = buildClaudeSandboxAllowWrite("/canvas/ws");

    expect(result).toContain("/tmp");
    expect(result).not.toContain("/private/tmp");
    expect(result.some((p) => p.includes("Library/Application Support"))).toBe(
      false,
    );
  });

  it("Linux 且設了 XDG_DATA_HOME 時，使用 XDG_DATA_HOME/uv 而非 ~/.local/share/uv", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    vi.stubEnv("XDG_DATA_HOME", "/custom/data");

    const result = buildClaudeSandboxAllowWrite("/canvas/ws");

    expect(result).toContain(path.join("/custom/data", "uv"));
    expect(result.some((p) => p.includes(".local/share/uv"))).toBe(false);
  });

  it("清單一律包含 /tmp、~/.npm、~/.cache/uv、~/.bun/install/cache", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    const result = buildClaudeSandboxAllowWrite("/canvas/ws");

    expect(result).toContain("/tmp");
    expect(result).toContain(path.join("/home/testuser", ".npm"));
    expect(result).toContain(path.join("/home/testuser", ".cache", "uv"));
    expect(result).toContain(
      path.join("/home/testuser", ".bun", "install", "cache"),
    );
  });
});

describe("buildClaudeSandboxDenyWrite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("包含敏感 credential 目錄（~/.ssh、~/.aws、~/.gnupg、~/.config/gh）", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");

    const result = buildClaudeSandboxDenyWrite();

    expect(result).toContain(path.join("/home/testuser", ".ssh"));
    expect(result).toContain(path.join("/home/testuser", ".aws"));
    expect(result).toContain(path.join("/home/testuser", ".gnupg"));
    expect(result).toContain(path.join("/home/testuser", ".config", "gh"));
  });

  it("包含含 token 的設定檔（~/.netrc、~/.npmrc、~/.docker/config.json）", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");

    const result = buildClaudeSandboxDenyWrite();

    expect(result).toContain(path.join("/home/testuser", ".netrc"));
    expect(result).toContain(path.join("/home/testuser", ".npmrc"));
    expect(result).toContain(
      path.join("/home/testuser", ".docker", "config.json"),
    );
  });

  it("包含 shell 設定檔（bash / zsh / profile 系列）", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");

    const result = buildClaudeSandboxDenyWrite();

    for (const file of [
      ".bashrc",
      ".bash_profile",
      ".bash_login",
      ".bash_logout",
      ".zshrc",
      ".zprofile",
      ".zshenv",
      ".zlogin",
      ".zlogout",
      ".profile",
    ]) {
      expect(result).toContain(path.join("/home/testuser", file));
    }
  });

  it("不應包含 ~/.claude / ~/.claude.json，避免擋掉 Claude 自身認證寫入", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");

    const result = buildClaudeSandboxDenyWrite();

    expect(result).not.toContain(path.join("/home/testuser", ".claude"));
    expect(result).not.toContain(path.join("/home/testuser", ".claude.json"));
  });

  it("不應包含 ~/.npm / ~/.cache/uv / ~/.bun/install/cache，避免擋掉 MCP cache 寫入", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/testuser");

    const result = buildClaudeSandboxDenyWrite();

    expect(result).not.toContain(path.join("/home/testuser", ".npm"));
    expect(result).not.toContain(path.join("/home/testuser", ".cache", "uv"));
    expect(result).not.toContain(
      path.join("/home/testuser", ".bun", "install", "cache"),
    );
  });
});

describe("buildClaudeSandboxNetwork", () => {
  beforeEach(() => {
    vi.mocked(loadDomainWhitelist).mockReset();
  });

  it("回傳格式為 { allowedDomains: [...] }，內容來自 loadDomainWhitelist 的回傳值", () => {
    vi.mocked(loadDomainWhitelist).mockReturnValue([
      "api.anthropic.com",
      "github.com",
    ]);
    const result = buildClaudeSandboxNetwork();
    expect(result).toEqual({
      allowedDomains: ["api.anthropic.com", "github.com"],
    });
  });

  it("loadDomainWhitelist 回傳空陣列時，allowedDomains 仍為空陣列（行為觀察，無 fallback）", () => {
    vi.mocked(loadDomainWhitelist).mockReturnValue([]);
    const result = buildClaudeSandboxNetwork();
    expect(result).toEqual({ allowedDomains: [] });
  });
});
