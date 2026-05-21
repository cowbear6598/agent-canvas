import path from "path";
import fs from "fs/promises";
import { $ } from "bun";

export type GitFakeMethod =
  | "clone"
  | "checkout"
  | "fetch"
  | "reset"
  | "raw"
  | "getRemotes"
  | "branch"
  | "status"
  | "revparse";

export interface GitFakeCall {
  basePath?: string;
  method: GitFakeMethod;
  args: unknown[];
}

export interface GitFakeFailure {
  method: GitFakeMethod;
  message: string;
}

export interface GitFakeRemote {
  name: string;
  refs?: {
    fetch?: string;
    push?: string;
  };
}

export interface GitFakeBranchSummary {
  all: string[];
  current: string;
}

export interface GitFakeStatus {
  current?: string;
  isClean(): boolean;
}

export interface SimpleGitFakeHarness {
  calls: GitFakeCall[];
  failures: GitFakeFailure[];
  setFailure(method: GitFakeMethod, message: string): void;
  clearFailures(): void;
  factory(basePathOrOptions?: string | { baseDir?: string }): SimpleGitFake;
}

export interface SimpleGitFake {
  clone(repoUrl: string, targetPath: string, options?: string[]): Promise<void>;
  checkout(args: string[]): Promise<void>;
  fetch(args: string[]): Promise<void>;
  reset(args: string[]): Promise<void>;
  raw(args: string[]): Promise<string>;
  getRemotes(verbose?: boolean): Promise<GitFakeRemote[]>;
  branch(): Promise<GitFakeBranchSummary>;
  status(): Promise<GitFakeStatus>;
  revparse(args: string[]): Promise<string>;
}

function resolveBasePath(
  basePathOrOptions?: string | { baseDir?: string },
): string | undefined {
  if (typeof basePathOrOptions === "string") return basePathOrOptions;
  return basePathOrOptions?.baseDir;
}

export function createSimpleGitFakeHarness(options: {
  remotes?: GitFakeRemote[];
  branchSummary?: GitFakeBranchSummary;
  currentBranch?: string;
  clean?: boolean;
  rawResult?: string;
} = {}): SimpleGitFakeHarness {
  const calls: GitFakeCall[] = [];
  const failures: GitFakeFailure[] = [];

  const throwIfFailed = (method: GitFakeMethod): void => {
    const failure = failures.find((item) => item.method === method);
    if (failure) throw new Error(failure.message);
  };

  const record = (
    basePath: string | undefined,
    method: GitFakeMethod,
    args: unknown[],
  ): void => {
    calls.push({ basePath, method, args });
  };

  return {
    calls,
    failures,
    setFailure(method, message) {
      failures.push({ method, message });
    },
    clearFailures() {
      failures.length = 0;
    },
    factory(basePathOrOptions) {
      const basePath = resolveBasePath(basePathOrOptions);
      return {
        async clone(repoUrl, targetPath, cloneOptions = []) {
          record(basePath, "clone", [repoUrl, targetPath, cloneOptions]);
          throwIfFailed("clone");
        },
        async checkout(args) {
          record(basePath, "checkout", [args]);
          throwIfFailed("checkout");
        },
        async fetch(args) {
          record(basePath, "fetch", [args]);
          throwIfFailed("fetch");
        },
        async reset(args) {
          record(basePath, "reset", [args]);
          throwIfFailed("reset");
        },
        async raw(args) {
          record(basePath, "raw", [args]);
          throwIfFailed("raw");
          return options.rawResult ?? "";
        },
        async getRemotes(verbose = false) {
          record(basePath, "getRemotes", [verbose]);
          throwIfFailed("getRemotes");
          return options.remotes ?? [{ name: "origin", refs: {} }];
        },
        async branch() {
          record(basePath, "branch", []);
          throwIfFailed("branch");
          return (
            options.branchSummary ?? {
              all: [options.currentBranch ?? "main"],
              current: options.currentBranch ?? "main",
            }
          );
        },
        async status() {
          record(basePath, "status", []);
          throwIfFailed("status");
          return {
            current: options.currentBranch ?? "main",
            isClean: () => options.clean ?? true,
          };
        },
        async revparse(args) {
          record(basePath, "revparse", [args]);
          throwIfFailed("revparse");
          return "HEAD";
        },
      };
    },
  };
}

export interface GitFixtureRepository {
  root: string;
  remotePath: string;
  sourcePath: string;
  clonePath: string;
  cleanup(): Promise<void>;
}

export async function createGitFixtureRepository(
  rootDir: string,
  options: {
    branch?: string;
    filename?: string;
    content?: string;
    commitMessage?: string;
  } = {},
): Promise<GitFixtureRepository> {
  const branch = options.branch ?? "main";
  const filename = options.filename ?? "README.md";
  const content = options.content ?? "git fake fixture\n";
  const commitMessage = options.commitMessage ?? "initial fixture commit";
  const root = path.join(
    rootDir,
    `git-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const remotePath = path.join(root, "remote.git");
  const sourcePath = path.join(root, "source");
  const clonePath = path.join(root, "clone");

  await fs.mkdir(root, { recursive: true });
  await $`git init --bare ${remotePath}`.quiet();
  await $`git init --initial-branch=${branch} ${sourcePath}`.quiet();
  await $`git -C ${sourcePath} config user.email "test@example.com"`.quiet();
  await $`git -C ${sourcePath} config user.name "Test User"`.quiet();
  await fs.writeFile(path.join(sourcePath, filename), content, "utf8");
  await $`git -C ${sourcePath} add ${filename}`.quiet();
  await $`git -C ${sourcePath} commit -m ${commitMessage}`.quiet();
  await $`git -C ${sourcePath} remote add origin ${remotePath}`.quiet();
  await $`git -C ${sourcePath} push -u origin ${branch}`.quiet();

  return {
    root,
    remotePath,
    sourcePath,
    clonePath,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

export interface GitStubExecutable {
  binDir: string;
  executablePath: string;
  logPath: string;
  env: Record<string, string>;
  readCalls(): Promise<string[]>;
  cleanup(): Promise<void>;
}

export async function createGitStubExecutable(
  rootDir: string,
): Promise<GitStubExecutable> {
  const binDir = path.join(
    rootDir,
    `git-stub-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const executablePath = path.join(binDir, "git");
  const logPath = path.join(binDir, "git-calls.log");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    executablePath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'echo "$*" >> "$GIT_FAKE_LOG_PATH"',
      'if [[ -n "${GIT_FAKE_FAIL_MATCH:-}" && "$*" == *"$GIT_FAKE_FAIL_MATCH"* ]]; then',
      '  echo "${GIT_FAKE_FAIL_MESSAGE:-git fake failure}" >&2',
      "  exit ${GIT_FAKE_FAIL_CODE:-1}",
      "fi",
      'case "$1" in',
      '  clone)',
      '    target="${@: -1}"',
      '    mkdir -p "$target/.git"',
      "    ;;",
      '  checkout|pull|fetch|reset|branch|status|rev-parse|remote)',
      "    ;;",
      "esac",
    ].join("\n"),
    { mode: 0o755 },
  );

  return {
    binDir,
    executablePath,
    logPath,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      GIT_FAKE_LOG_PATH: logPath,
    },
    readCalls: async () => {
      const content = await fs.readFile(logPath, "utf8").catch(() => "");
      return content.split("\n").filter(Boolean);
    },
    cleanup: async () => {
      await fs.rm(binDir, { recursive: true, force: true });
    },
  };
}
