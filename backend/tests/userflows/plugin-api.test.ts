import fs from "fs/promises";
import path from "path";
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
  type PluginDeletePayload,
  type PluginInstallPayload,
  type PluginListPayload,
  type PluginReorderPayload,
  type PluginUpdatePayload,
} from "../../src/schemas";

type PluginRecord = {
  id: string;
  source: { type: "github" | "upload"; ref: string };
  githubRepo: string;
  displayName: string;
  description: string | null;
  installPath: string;
  sortIndex: number;
};

type PluginListResult = { success: boolean; plugins: PluginRecord[] };
type PluginInstalledResult = { success: boolean; plugin?: PluginRecord };
type PluginUpdatedResult = { success: boolean; plugin?: PluginRecord };
type PluginDeletedResult = { success: boolean; plugins?: PluginRecord[] };
type PluginReorderedResult = { success: boolean; plugins?: PluginRecord[] };

const { simpleGitState } = vi.hoisted(() => ({
  simpleGitState: {
    cloneCount: 0,
    calls: [] as Array<{ basePath?: string; method: string; args: unknown[] }>,
  },
}));

vi.mock("simple-git", async () => {
  const fs = await import("fs/promises");
  const path = await import("path");

  return {
    simpleGit: (basePath?: string) => ({
      async clone(repoUrl: string, installPath: string) {
        simpleGitState.cloneCount += 1;
        simpleGitState.calls.push({
          basePath,
          method: "clone",
          args: [repoUrl, installPath],
        });
        const manifestDir = path.join(installPath, ".codex-plugin");
        await fs.mkdir(manifestDir, { recursive: true });
        await fs.writeFile(
          path.join(manifestDir, "plugin.json"),
          JSON.stringify({
            name:
              simpleGitState.cloneCount === 1
                ? "Installed Plugin"
                : "Updated Plugin",
            description: `clone-${simpleGitState.cloneCount}`,
          }),
          "utf8",
        );
        const skillDir = path.join(installPath, "skills", "plan");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          "---\ndescription: 測試流程 skill\n---\n\n# Plan\n",
          "utf8",
        );
      },
      async fetch() {
        simpleGitState.calls.push({ basePath, method: "fetch", args: [] });
      },
      async revparse(args: string[]) {
        simpleGitState.calls.push({ basePath, method: "revparse", args });
        return "same-head";
      },
      async pull() {
        simpleGitState.calls.push({ basePath, method: "pull", args: [] });
      },
    }),
  };
});

async function withPluginClient<T>(
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

describe("plugin API flow", () => {
  it("installs, lists, reorders, updates, and deletes a managed plugin through the handler registry", async () => {
    await withPluginClient(async (_server, client) => {
      simpleGitState.cloneCount = 0;
      simpleGitState.calls.length = 0;

      const installResponse = await emitAndWaitResponse<
        PluginInstallPayload,
        PluginInstalledResult
      >(
        client,
        WebSocketRequestEvents.PLUGIN_INSTALL,
        WebSocketResponseEvents.PLUGIN_INSTALLED,
        { requestId: "plugin-install", githubRepo: "owner/plugin-flow" },
      );

      expect(installResponse.success).toBe(true);
      expect(installResponse.plugin).toMatchObject({
        id: "owner/plugin-flow",
        displayName: "Installed Plugin",
        description: "clone-1",
        sortIndex: 0,
      });
      expect(installResponse.plugin?.installPath).toContain(
        testConfig.pluginsRoot,
      );
      await expect(
        fs.stat(
          path.join(
            installResponse.plugin!.installPath,
            ".codex-plugin",
            "plugin.json",
          ),
        ),
      ).resolves.toEqual(expect.objectContaining({}));

      await emitAndWaitResponse<PluginInstallPayload, PluginInstalledResult>(
        client,
        WebSocketRequestEvents.PLUGIN_INSTALL,
        WebSocketResponseEvents.PLUGIN_INSTALLED,
        { requestId: "plugin-install-2", githubRepo: "owner/second-plugin" },
      );

      const listResponse = await emitAndWaitResponse<
        PluginListPayload,
        PluginListResult
      >(
        client,
        WebSocketRequestEvents.PLUGIN_LIST,
        WebSocketResponseEvents.PLUGIN_LIST_RESULT,
        { requestId: "plugin-list" },
      );
      expect(listResponse.plugins.map((plugin) => plugin.id)).toEqual([
        "owner/plugin-flow",
        "owner/second-plugin",
      ]);

      const reorderResponse = await emitAndWaitResponse<
        PluginReorderPayload,
        PluginReorderedResult
      >(
        client,
        WebSocketRequestEvents.PLUGIN_REORDER,
        WebSocketResponseEvents.PLUGIN_REORDERED,
        {
          requestId: "plugin-reorder",
          pluginIds: ["owner/second-plugin", "owner/plugin-flow"],
        },
      );
      expect(reorderResponse.success).toBe(true);
      expect(reorderResponse.plugins?.map((plugin) => plugin.id)).toEqual([
        "owner/second-plugin",
        "owner/plugin-flow",
      ]);
      expect(reorderResponse.plugins?.map((plugin) => plugin.sortIndex)).toEqual(
        [0, 1],
      );

      const updateResponse = await emitAndWaitResponse<
        PluginUpdatePayload,
        PluginUpdatedResult
      >(
        client,
        WebSocketRequestEvents.PLUGIN_UPDATE,
        WebSocketResponseEvents.PLUGIN_UPDATED,
        { requestId: "plugin-update", pluginId: "owner/plugin-flow" },
      );
      expect(updateResponse.success).toBe(true);
      expect(updateResponse.plugin).toMatchObject({
        id: "owner/plugin-flow",
        displayName: "Updated Plugin",
      });

      const deleteResponse = await emitAndWaitResponse<
        PluginDeletePayload,
        PluginDeletedResult
      >(
        client,
        WebSocketRequestEvents.PLUGIN_DELETE,
        WebSocketResponseEvents.PLUGIN_DELETED,
        { requestId: "plugin-delete", pluginId: "owner/plugin-flow" },
      );
      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.plugins?.map((plugin) => plugin.id)).toEqual([
        "owner/second-plugin",
      ]);
      await expect(
        fs.stat(path.join(testConfig.pluginsRoot, "owner__plugin-flow")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
