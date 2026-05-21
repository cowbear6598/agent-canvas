import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { AGENT_CANVAS_TEST_ROOT } from "../setup/testConfig.js";

export interface RepositoryFixture {
  id: string;
  name: string;
  path: string;
}

export interface TestWorkspaceHarness {
  rootDir: string;
  podsDir: string;
  repositoriesDir: string;
  createPodDirectory: (podName?: string) => Promise<string>;
  createRepositoryFixture: (
    name?: string,
    options?: { git?: boolean },
  ) => Promise<RepositoryFixture>;
  cleanup: () => Promise<void>;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTestWorkspaceHarness(
  prefix = "workspace",
): Promise<TestWorkspaceHarness> {
  const rootDir = join(AGENT_CANVAS_TEST_ROOT, uniqueName(prefix));
  const podsDir = join(rootDir, "pods");
  const repositoriesDir = join(rootDir, "repositories");

  await mkdir(podsDir, { recursive: true });
  await mkdir(repositoriesDir, { recursive: true });

  return {
    rootDir,
    podsDir,
    repositoriesDir,
    createPodDirectory: async (podName = "pod") => {
      const podDir = join(podsDir, uniqueName(podName));
      await mkdir(podDir, { recursive: true });
      return podDir;
    },
    createRepositoryFixture: async (
      name = "repository",
      options: { git?: boolean } = {},
    ) => {
      const repoName = uniqueName(name);
      const repoPath = join(repositoriesDir, repoName);
      await mkdir(repoPath, { recursive: true });
      await writeFile(join(repoPath, "README.md"), "# Test Repository\n");

      if (options.git) {
        await $`git init ${repoPath}`.quiet();
        await $`git -C ${repoPath} config user.email "test@example.com"`.quiet();
        await $`git -C ${repoPath} config user.name "Test User"`.quiet();
        await $`git -C ${repoPath} add README.md`.quiet();
        await $`git -C ${repoPath} commit -m "Initial commit"`.quiet();
      }

      return {
        id: repoName,
        name: repoName,
        path: repoPath,
      };
    },
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}
