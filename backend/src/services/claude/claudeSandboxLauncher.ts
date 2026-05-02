import fs from "fs";
import os from "os";
import path from "path";

import { getClaudeCodePath } from "./claudePathResolver.js";

// module-level cache：key = sandboxHomePath，value = 已解析的 launcher path
// 避免相同 sandboxHomePath 重複執行 writeFileSync / chmodSync
const launcherPathCache = new Map<string, string>();

interface LauncherPaths {
  launcherPath: string;
  profilePath: string;
  tmpDirPath: string;
}

interface HostRuntimePaths {
  claudeDirPath: string;
  claudeJsonPath: string;
  claudeCachePath: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureClaudeSandboxHomeSeeded(sandboxHomePath: string): void {
  ensureDir(sandboxHomePath);
}

function getLauncherPaths(sandboxHomePath: string): LauncherPaths {
  const baseDir = path.join(sandboxHomePath, ".agent-canvas");
  return {
    launcherPath: path.join(baseDir, "claude-sandbox"),
    profilePath: path.join(baseDir, "claude-sandbox.sb"),
    tmpDirPath: path.join(sandboxHomePath, "tmp"),
  };
}

function getHostRuntimePaths(): HostRuntimePaths {
  const hostHome = os.homedir();
  const cacheRoot =
    process.platform === "darwin"
      ? path.join(hostHome, "Library", "Caches")
      : (process.env.XDG_CACHE_HOME ?? path.join(hostHome, ".cache"));

  return {
    claudeDirPath: path.join(hostHome, ".claude"),
    claudeJsonPath: path.join(hostHome, ".claude.json"),
    claudeCachePath: path.join(cacheRoot, "claude-cli-nodejs"),
  };
}

function buildMacSandboxRule(
  targetPath: string,
  type: "file" | "directory" = "directory",
): string {
  const keyword = type === "file" ? "literal" : "subpath";
  return `  (${keyword} ${JSON.stringify(targetPath)})`;
}

function buildMacSandboxProfile(params: {
  workspacePath: string;
  sandboxHomePath: string;
  hostRuntimePaths: HostRuntimePaths;
}): string {
  const writablePaths = [
    buildMacSandboxRule("/tmp"),
    buildMacSandboxRule("/private/tmp"),
    buildMacSandboxRule(params.workspacePath),
    buildMacSandboxRule(params.sandboxHomePath),
    buildMacSandboxRule(params.hostRuntimePaths.claudeDirPath),
    buildMacSandboxRule(params.hostRuntimePaths.claudeCachePath),
    buildMacSandboxRule(params.hostRuntimePaths.claudeJsonPath, "file"),
  ].join("\n");

  return [
    "(version 1)",
    "(allow default)",
    '(deny file-write* (regex #"^/"))',
    `(allow file-write*\n${writablePaths}\n)`,
    "",
  ].join("\n");
}

function buildLauncherScript(params: {
  realClaudePath: string;
  workspacePath: string;
  sandboxHomePath: string;
  profilePath: string;
  tmpDirPath: string;
  hostRuntimePaths: HostRuntimePaths;
}): string {
  const realClaude = shellQuote(params.realClaudePath);
  const workspace = shellQuote(params.workspacePath);
  const sandboxHome = shellQuote(params.sandboxHomePath);
  const profile = shellQuote(params.profilePath);
  const tmpDir = shellQuote(params.tmpDirPath);
  const hostClaudeDir = shellQuote(params.hostRuntimePaths.claudeDirPath);
  const hostClaudeCache = shellQuote(params.hostRuntimePaths.claudeCachePath);

  const envSetup = [
    `export TMPDIR=${tmpDir}`,
    `mkdir -p ${sandboxHome} ${tmpDir} ${hostClaudeDir} ${hostClaudeCache}`,
  ].join("\n");

  const darwinExec = [
    "if command -v sandbox-exec >/dev/null 2>&1; then",
    `  exec sandbox-exec -f ${profile} ${realClaude} "$@"`,
    "fi",
    'echo "Claude sandbox requires sandbox-exec on macOS" >&2',
    "exit 1",
  ].join("\n");

  const linuxExec = [
    "if command -v bwrap >/dev/null 2>&1; then",
    "  exec bwrap \\",
    "    --die-with-parent \\",
    "    --ro-bind / / \\",
    "    --dev /dev \\",
    "    --proc /proc \\",
    `    --bind ${workspace} ${workspace} \\`,
    `    --bind ${sandboxHome} ${sandboxHome} \\`,
    `    --bind ${hostClaudeDir} ${hostClaudeDir} \\`,
    `    --bind ${hostClaudeCache} ${hostClaudeCache} \\`,
    "    --bind /tmp /tmp \\",
    `    --bind ${tmpDir} ${tmpDir} \\`,
    `    --chdir ${workspace} \\`,
    `    --setenv TMPDIR ${tmpDir} \\`,
    '    --setenv PATH "$PATH" \\',
    `    ${realClaude} "$@"`,
    "fi",
    'echo "Claude sandbox requires bubblewrap (bwrap) on Linux" >&2',
    "exit 1",
  ].join("\n");

  return [
    "#!/bin/sh",
    "set -eu",
    envSetup,
    'case "$(uname -s)" in',
    `  Darwin)\n${darwinExec}\n    ;;`,
    `  Linux)\n${linuxExec}\n    ;;`,
    '  *) echo "Unsupported platform for Claude sandbox launcher" >&2; exit 1 ;;',
    "esac",
    "",
  ].join("\n");
}

export function resolveClaudeExecutablePath(params: {
  workspacePath: string;
  sandboxHomePath?: string;
}): string | undefined {
  const realClaudePath = getClaudeCodePath();
  if (!params.sandboxHomePath) {
    return realClaudePath;
  }
  if (!realClaudePath) {
    throw new Error("找不到 Claude Code 可執行檔，無法建立 sandbox launcher");
  }

  // 快取命中：若 launcher 已存在則直接回傳，避免重複 writeFileSync / chmodSync
  const cached = launcherPathCache.get(params.sandboxHomePath);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  // cache 存在但檔案已被外部刪除，清除 cache 後重新產生
  if (cached) {
    launcherPathCache.delete(params.sandboxHomePath);
  }

  ensureClaudeSandboxHomeSeeded(params.sandboxHomePath);
  const hostRuntimePaths = getHostRuntimePaths();

  const { launcherPath, profilePath, tmpDirPath } = getLauncherPaths(
    params.sandboxHomePath,
  );
  ensureDir(path.dirname(launcherPath));
  ensureDir(tmpDirPath);

  if (process.platform === "darwin") {
    fs.writeFileSync(
      profilePath,
      buildMacSandboxProfile({
        workspacePath: params.workspacePath,
        sandboxHomePath: params.sandboxHomePath,
        hostRuntimePaths,
      }),
      "utf8",
    );
  }

  try {
    fs.writeFileSync(
      launcherPath,
      buildLauncherScript({
        realClaudePath,
        workspacePath: params.workspacePath,
        sandboxHomePath: params.sandboxHomePath,
        profilePath,
        tmpDirPath,
        hostRuntimePaths,
      }),
      "utf8",
    );
    fs.chmodSync(launcherPath, 0o755);
  } catch (err) {
    // 寫檔或 chmod 失敗時不寫入 cache，讓下次呼叫重試
    launcherPathCache.delete(params.sandboxHomePath);
    throw err;
  }

  launcherPathCache.set(params.sandboxHomePath, launcherPath);
  return launcherPath;
}
