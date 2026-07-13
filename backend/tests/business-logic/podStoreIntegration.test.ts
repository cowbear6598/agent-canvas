import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabaseHarness,
  createTestWorkspaceHarness,
  type TestDatabaseHarness,
  type TestWorkspaceHarness,
} from "../helpers";
import { config } from "../../src/config/index.js";
import { getDb } from "../../src/database/index.js";
import { canvasStore } from "../../src/services/canvasStore.js";
import {
  createPodWithWorkspace,
  deletePodWithCleanup,
} from "../../src/services/podService.js";
import { podStore } from "../../src/services/podStore.js";

type MutableConfig = typeof config;

const originalConfig: Partial<MutableConfig> = {
  appDataRoot: config.appDataRoot,
  canvasRoot: config.canvasRoot,
  repositoriesRoot: config.repositoriesRoot,
  tmpRoot: config.tmpRoot,
  stagingRoot: config.stagingRoot,
  agentsPath: config.agentsPath,
  commandsPath: config.commandsPath,
  getCanvasPath: config.getCanvasPath,
  getCanvasDataPath: config.getCanvasDataPath,
};

function assertWithinRoot(target: string, root: string): void {
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  expect(resolvedTarget.startsWith(resolvedRoot + sep)).toBe(true);
}

function installWorkspaceConfig(rootDir: string): void {
  const canvasRoot = join(rootDir, "canvas");
  Object.assign(config, {
    appDataRoot: rootDir,
    canvasRoot,
    repositoriesRoot: join(rootDir, "repositories"),
    tmpRoot: join(rootDir, "tmp"),
    stagingRoot: join(rootDir, "tmp", "staging"),
    agentsPath: join(rootDir, "agents"),
    commandsPath: join(rootDir, "commands"),
  });

  config.getCanvasPath = (canvasName: string): string => {
    const canvasPath = join(canvasRoot, canvasName);
    assertWithinRoot(canvasPath, canvasRoot);
    return canvasPath;
  };

  config.getCanvasDataPath = (canvasName: string): string => {
    const canvasDataPath = join(canvasRoot, canvasName, "data");
    assertWithinRoot(canvasDataPath, canvasRoot);
    return canvasDataPath;
  };
}

function restoreConfig(): void {
  Object.assign(config, originalConfig);
}

describe("PodStore integration with database and temp filesystem", () => {
  let workspace: TestWorkspaceHarness;
  let database: TestDatabaseHarness;
  let canvasId: string;

  beforeEach(async () => {
    workspace = await createTestWorkspaceHarness("pod-store");
    installWorkspaceConfig(workspace.rootDir);
    database = await createTestDatabaseHarness(workspace.rootDir);
    podStore.__clearCacheForTesting();

    const canvas = await canvasStore.create("pod-store-canvas");
    if (!canvas.success) {
      throw new Error("Failed to create test canvas");
    }
    const testCanvas = canvas.data;
    canvasId = testCanvas.id;
    await mkdir(config.getCanvasPath(testCanvas.name), { recursive: true });
  });

  afterEach(async () => {
    await database.cleanup();
    await workspace.cleanup();
    restoreConfig();
    podStore.__clearCacheForTesting();
  });

  it("createPodWithWorkspace 寫入真 DB 並在 tmp/AgentCanvas 建立 workspace", async () => {
    const result = await createPodWithWorkspace(
      canvasId,
      {
        name: "store-fs-pod",
        x: 10,
        y: 20,
        rotation: 5,
        provider: "claude",
        providerConfig: { model: "opus" },
      },
      "test-request",
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Failed to create pod workspace");
    }
    const pod = result.data.pod;
    expect(pod.workspacePath).toContain(join("tmp", "AgentCanvas"));
    assertWithinRoot(pod.workspacePath, config.canvasRoot);
    expect(existsSync(pod.workspacePath)).toBe(true);

    const markerPath = join(pod.workspacePath, "artifact.txt");
    await writeFile(markerPath, "workspace artifact");
    expect(await readFile(markerPath, "utf8")).toBe("workspace artifact");

    const row = getDb()
      .prepare(
        "SELECT canvas_id, name, x, y, rotation, workspace_path, provider_config_json FROM pods WHERE id = ?",
      )
      .get(pod.id) as
      | {
          canvas_id: string;
          name: string;
          x: number;
          y: number;
          rotation: number;
          workspace_path: string;
          provider_config_json: string;
        }
      | undefined;

    expect(row).toMatchObject({
      canvas_id: canvasId,
      name: "store-fs-pod",
      x: 10,
      y: 20,
      rotation: 5,
      workspace_path: pod.workspacePath,
    });
    expect(JSON.parse(row!.provider_config_json)).toEqual({
      model: "opus",
      thinkingLevel: "high",
    });

    const readBack = podStore.getById(canvasId, pod.id);
    expect(readBack).toMatchObject({
      id: pod.id,
      name: "store-fs-pod",
      workspacePath: pod.workspacePath,
    });
  });

  it("podStore update 與 join tables 會用真 DB 維持 list/getById 一致", async () => {
    const result = await createPodWithWorkspace(
      canvasId,
      {
        name: "store-update-pod",
        x: 0,
        y: 0,
        rotation: 0,
        provider: "codex",
        providerConfig: { model: "gpt-5.5" },
        pluginIds: ["plugin-a"],
        goal: {
          todos: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              text: "ship pod flow",
            },
          ],
        },
      },
      "test-request",
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Failed to create pod workspace");
    }
    const pod = result.data.pod;

    podStore.setMcpServerNames(pod.id, ["filesystem", "database"]);
    const updated = podStore.update(canvasId, pod.id, {
      name: "store-update-pod-renamed",
      x: 100,
      y: -50,
      providerConfig: { model: "gpt-5.5" },
      pluginIds: ["plugin-b", "plugin-c"],
    });

    expect(updated?.pod).toMatchObject({
      id: pod.id,
      name: "store-update-pod-renamed",
      x: 100,
      y: -50,
      providerConfig: { model: "gpt-5.5", thinkingLevel: "medium" },
      pluginIds: ["plugin-b", "plugin-c"],
    });

    const byId = podStore.getById(canvasId, pod.id);
    const listed = podStore.list(canvasId).find((item) => item.id === pod.id);

    expect(byId?.mcpServerNames?.toSorted()).toEqual(["database", "filesystem"]);
    expect(byId?.pluginIds).toEqual(["plugin-b", "plugin-c"]);
    expect(listed).toEqual(byId);

    const row = getDb()
      .prepare("SELECT name, x, y, provider_config_json FROM pods WHERE id = ?")
      .get(pod.id) as {
      name: string;
      x: number;
      y: number;
      provider_config_json: string;
    };
    expect(row).toMatchObject({
      name: "store-update-pod-renamed",
      x: 100,
      y: -50,
    });
    expect(JSON.parse(row.provider_config_json)).toEqual({
      model: "gpt-5.5",
      thinkingLevel: "medium",
    });
  });

  it("integration bindings 與刪除流程使用真外鍵、DB cascade 與 workspace cleanup", async () => {
    const result = await createPodWithWorkspace(
      canvasId,
      {
        name: "store-binding-pod",
        x: 0,
        y: 0,
        rotation: 0,
      },
      "test-request",
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Failed to create pod workspace");
    }
    const pod = result.data.pod;

    getDb()
      .prepare(
        "INSERT INTO integration_apps (id, provider, name, config_json, extra_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run("app-slack-1", "slack", "Slack App", "{}", null);

    podStore.addIntegrationBinding(canvasId, pod.id, {
      provider: "slack",
      appId: "app-slack-1",
      resourceId: "C123",
      extra: { threadTs: "1000.2000" },
    });

    const bound = podStore.getById(canvasId, pod.id);
    expect(bound?.integrationBindings).toEqual([
      {
        provider: "slack",
        appId: "app-slack-1",
        resourceId: "C123",
        extra: { threadTs: "1000.2000" },
      },
    ]);
    expect(podStore.findByIntegrationApp("app-slack-1")[0].pod.id).toBe(
      pod.id,
    );
    expect(
      podStore.findByIntegrationAppAndResource("app-slack-1", "C123")[0].pod
        .id,
    ).toBe(pod.id);

    const deleteResult = await deletePodWithCleanup(
      canvasId,
      pod.id,
      "test-request",
    );

    expect(deleteResult.success).toBe(true);
    expect(existsSync(pod.workspacePath)).toBe(false);
    expect(podStore.getById(canvasId, pod.id)).toBeUndefined();
    const bindingRow = getDb()
      .prepare("SELECT id FROM integration_bindings WHERE pod_id = ?")
      .get(pod.id);
    expect(bindingRow).toBeFalsy();
  });
});
