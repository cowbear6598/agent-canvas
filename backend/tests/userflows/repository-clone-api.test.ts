import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { describe, expect, it, vi } from "vitest";
import {
  closeTestServer,
  createSocketClient,
  createTestServer,
  disconnectSocket,
  emitAndWaitResponse,
  type TestServerInstance,
  type TestWebSocketClient,
} from "../setup";
import { testConfig } from "../setup/testConfig";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type RepositoryGitClonePayload,
} from "../../src/schemas";
import type {
  RepositoryGitCloneProgressPayload,
  RepositoryGitCloneResultPayload,
} from "../../src/types";

const { simpleGitState } = vi.hoisted(() => ({
  simpleGitState: {
    calls: [] as Array<{ basePath?: string; method: string; args: unknown[] }>,
    cloneFailure: null as string | null,
  },
}));

vi.mock("simple-git", async () => {
  const fs = await import("fs/promises");
  const path = await import("path");

  return {
    simpleGit: (basePathOrOptions?: string | { baseDir?: string }) => {
      const basePath =
        typeof basePathOrOptions === "string"
          ? basePathOrOptions
          : basePathOrOptions?.baseDir;

      return {
        async clone(repoUrl: string, targetPath: string, options: string[] = []) {
          simpleGitState.calls.push({
            basePath,
            method: "clone",
            args: [repoUrl, targetPath, options],
          });
          if (simpleGitState.cloneFailure) {
            throw new Error(simpleGitState.cloneFailure);
          }
          await fs.mkdir(path.join(targetPath, ".git"), { recursive: true });
        },
        async status() {
          simpleGitState.calls.push({
            basePath,
            method: "status",
            args: [],
          });
          return { current: "main", isClean: () => true };
        },
      };
    },
  };
});

async function withRepositoryClient<T>(
  run: (
    server: TestServerInstance,
    client: TestWebSocketClient,
  ) => Promise<T>,
): Promise<T> {
  const server = await createTestServer();
  const client = await createSocketClient(server.baseUrl, server.canvasId);

  try {
    return await run(server, client);
  } finally {
    if (client.connected) await disconnectSocket(client);
    await closeTestServer(server);
  }
}

function collectCloneProgress(
  client: TestWebSocketClient,
): RepositoryGitCloneProgressPayload[] {
  const progressEvents: RepositoryGitCloneProgressPayload[] = [];
  client.on(
    WebSocketResponseEvents.REPOSITORY_GIT_CLONE_PROGRESS,
    (event: RepositoryGitCloneProgressPayload) => {
      progressEvents.push(event);
    },
  );
  return progressEvents;
}

describe("repository clone API flow", () => {
  it("creates a repository from a Git URL, emits progress, and stores it under the test repository root", async () => {
    await withRepositoryClient(async (_server, client) => {
      simpleGitState.calls.length = 0;
      simpleGitState.cloneFailure = null;
      const progressEvents = collectCloneProgress(client);
      const repoName = `clone-flow-${uuidv4()}`;

      const response = await emitAndWaitResponse<
        RepositoryGitClonePayload,
        RepositoryGitCloneResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GIT_CLONE,
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        {
          requestId: uuidv4(),
          repoUrl: `https://github.com/acme/${repoName}.git`,
          branch: "main",
        },
      );

      expect(response.success).toBe(true);
      expect(response.repository).toEqual({
        id: repoName,
        name: repoName,
        repoMemoryEnabled: false,
        hasRepoMemory: false,
      });
      expect(progressEvents.map((event) => event.progress)).toEqual(
        expect.arrayContaining([0, 5, 95, 100]),
      );

      const repositoryPath = path.join(testConfig.repositoriesRoot, repoName);
      await expect(fs.stat(path.join(repositoryPath, ".git"))).resolves.toEqual(
        expect.objectContaining({}),
      );
      expect(repositoryPath.startsWith(testConfig.repositoriesRoot)).toBe(true);
      expect(simpleGitState.calls).toContainEqual(
        expect.objectContaining({
          method: "clone",
          args: [
            `https://github.com/acme/${repoName}.git`,
            repositoryPath,
            ["--branch", "main"],
          ],
        }),
      );
    });
  });

  it("removes the created repository directory and reports a user-facing error when clone fails", async () => {
    await withRepositoryClient(async (_server, client) => {
      simpleGitState.calls.length = 0;
      simpleGitState.cloneFailure = "Authentication failed";
      const repoName = `clone-fail-${uuidv4()}`;

      const response = await emitAndWaitResponse<
        RepositoryGitClonePayload,
        RepositoryGitCloneResultPayload
      >(
        client,
        WebSocketRequestEvents.REPOSITORY_GIT_CLONE,
        WebSocketResponseEvents.REPOSITORY_GIT_CLONE_RESULT,
        {
          requestId: uuidv4(),
          repoUrl: `https://github.com/acme/${repoName}.git`,
        },
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual(
        expect.objectContaining({ key: "errors.repoCloneFailed" }),
      );
      await expect(
        fs.stat(path.join(testConfig.repositoriesRoot, repoName)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
