import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApiIntegrationHarness,
  type ApiIntegrationHarness,
} from "../helpers/apiIntegrationHarness.js";
import { getDb } from "../../src/database/index.js";

describe("Pod REST API user flow", () => {
  let harness: ApiIntegrationHarness;

  beforeAll(async () => {
    harness = await createApiIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("建立 pod 會落地 workspace，API 讀回與資料庫主表一致", async () => {
    const createPod = await harness.post<{
      pod: {
        id: string;
        name: string;
        workspacePath: string;
        x: number;
        y: number;
        rotation: number;
        provider: string;
        providerConfig: { model: string; thinkingLevel?: string };
        mcpServerNames: string[];
      };
    }>(`/api/canvas/${harness.canvasId}/pods`, {
      name: "rest-api-pod",
      x: 88,
      y: 144,
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
    });

    expect(createPod.status).toBe(201);
    expect(createPod.body.pod).toMatchObject({
      name: "rest-api-pod",
      x: 88,
      y: 144,
      rotation: 0,
      provider: "codex",
      providerConfig: { model: "gpt-5.5", thinkingLevel: "medium" },
      mcpServerNames: [],
    });
    expect(createPod.body.pod.workspacePath).toContain(
      join("tmp", "AgentCanvas"),
    );
    expect(existsSync(createPod.body.pod.workspacePath)).toBe(true);

    const markerPath = join(createPod.body.pod.workspacePath, "notes.txt");
    await writeFile(markerPath, "persisted in pod workspace");
    expect(existsSync(markerPath)).toBe(true);

    const listPods = await harness.get<{
      pods: Array<{
        id: string;
        name: string;
        workspacePath: string;
        provider: string;
        providerConfig: { model: string; thinkingLevel?: string };
      }>;
    }>(`/api/canvas/${harness.canvasId}/pods`);

    expect(listPods.status).toBe(200);
    const readBack = listPods.body.pods.find(
      (pod) => pod.id === createPod.body.pod.id,
    );
    expect(readBack).toMatchObject({
      id: createPod.body.pod.id,
      name: "rest-api-pod",
      workspacePath: createPod.body.pod.workspacePath,
      provider: "codex",
      providerConfig: { model: "gpt-5.5", thinkingLevel: "medium" },
    });

    const row = getDb()
      .prepare(
        "SELECT canvas_id, name, x, y, workspace_path, provider, provider_config_json FROM pods WHERE id = ?",
      )
      .get(createPod.body.pod.id) as
      | {
          canvas_id: string;
          name: string;
          x: number;
          y: number;
          workspace_path: string;
          provider: string;
          provider_config_json: string;
        }
      | undefined;

    expect(row).toMatchObject({
      canvas_id: harness.canvasId,
      name: "rest-api-pod",
      x: 88,
      y: 144,
      workspace_path: createPod.body.pod.workspacePath,
      provider: "codex",
    });
    expect(JSON.parse(row!.provider_config_json)).toEqual({
      model: "gpt-5.5",
      thinkingLevel: "medium",
    });
  });

  it("重新命名與刪除 pod 會同步更新 API 列表與資料庫紀錄", async () => {
    const createPod = await harness.post<{
      pod: { id: string; name: string; workspacePath: string };
    }>(`/api/canvas/${harness.canvasId}/pods`, {
      name: "rest-api-pod-to-rename",
      x: 0,
      y: 0,
    });
    expect(createPod.status).toBe(201);

    const renamePod = await harness.patch<{
      pod: { id: string; name: string };
    }>(
      `/api/canvas/${harness.canvasId}/pods/${createPod.body.pod.id}`,
      { name: "rest-api-pod-renamed" },
    );
    expect(renamePod.status).toBe(200);
    expect(renamePod.body.pod.name).toBe("rest-api-pod-renamed");

    const renamedRow = getDb()
      .prepare("SELECT name FROM pods WHERE id = ?")
      .get(createPod.body.pod.id) as { name: string } | undefined;
    expect(renamedRow).toEqual({ name: "rest-api-pod-renamed" });

    const deletePod = await harness.delete(
      `/api/canvas/${harness.canvasId}/pods/${createPod.body.pod.id}`,
    );
    expect(deletePod.status).toBe(200);
    expect(existsSync(createPod.body.pod.workspacePath)).toBe(false);

    const deletedRow = getDb()
      .prepare("SELECT id FROM pods WHERE id = ?")
      .get(createPod.body.pod.id);
    expect(deletedRow).toBeFalsy();
  });
});
