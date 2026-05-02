import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/claude/claudePathResolver.js", () => ({
  getClaudeCodePath: vi.fn(() => "/usr/local/bin/claude"),
}));

import { resolveClaudeExecutablePath } from "../../src/services/claude/claudeSandboxLauncher.js";

describe("claudeSandboxLauncher", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dirPath of tempDirs.splice(0)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  });

  function createSandboxHomePath(): string {
    const dirPath = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "claude-sandbox-launcher-"),
    );
    tempDirs.push(dirPath);
    return dirPath;
  }

  it("不再 seed fake HOME，launcher 改為共用 host Claude runtime", () => {
    const sandboxHomePath = createSandboxHomePath();
    const executablePath = resolveClaudeExecutablePath({
      workspacePath: "/workspace/project",
      sandboxHomePath,
    });

    expect(executablePath).toBe(
      path.join(sandboxHomePath, ".agent-canvas", "claude-sandbox"),
    );
    expect(fs.existsSync(path.join(sandboxHomePath, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(sandboxHomePath, ".claude.json"))).toBe(
      false,
    );

    const launcherScript = fs.readFileSync(executablePath!, "utf8");
    expect(launcherScript).toContain("export TMPDIR=");
    expect(launcherScript).not.toContain("export HOME=");
    expect(launcherScript).not.toContain("XDG_CONFIG_HOME");
    expect(launcherScript).not.toContain("XDG_STATE_HOME");
    expect(launcherScript).not.toContain("XDG_CACHE_HOME");
    expect(launcherScript).toContain(path.join(os.homedir(), ".claude"));
    expect(launcherScript).toContain("claude-cli-nodejs");
  });

  it("macOS profile 應放行 host Claude runtime 寫入", () => {
    if (process.platform !== "darwin") return;

    const sandboxHomePath = createSandboxHomePath();
    resolveClaudeExecutablePath({
      workspacePath: "/workspace/project",
      sandboxHomePath,
    });

    const profilePath = path.join(
      sandboxHomePath,
      ".agent-canvas",
      "claude-sandbox.sb",
    );
    const profile = fs.readFileSync(profilePath, "utf8");

    expect(profile).toContain("/workspace/project");
    expect(profile).toContain(path.join(os.homedir(), ".claude"));
    expect(profile).toContain(path.join(os.homedir(), ".claude.json"));
    expect(profile).toContain(
      path.join(os.homedir(), "Library", "Caches", "claude-cli-nodejs"),
    );
    // MCP runtime cache 路徑斷言
    expect(profile).toContain(path.join(os.homedir(), ".npm"));
    expect(profile).toContain(path.join(os.homedir(), ".cache", "uv"));
    expect(profile).toContain(
      path.join(os.homedir(), "Library", "Application Support", "uv"),
    );
    expect(profile).toContain(
      path.join(os.homedir(), ".bun", "install", "cache"),
    );
  });

  it("launcher script 應含 MCP cache 路徑的 mkdir -p 與 bwrap --bind", () => {
    const sandboxHomePath = createSandboxHomePath();
    const executablePath = resolveClaudeExecutablePath({
      workspacePath: "/workspace/project",
      sandboxHomePath,
    });

    const script = fs.readFileSync(executablePath!, "utf8");

    // mkdir -p 確保路徑存在（bwrap 對不存在路徑做 --bind 會失敗）
    expect(script).toContain(path.join(os.homedir(), ".npm"));
    expect(script).toContain(path.join(os.homedir(), ".cache", "uv"));
    expect(script).toContain(
      path.join(os.homedir(), ".bun", "install", "cache"),
    );
  });
});
