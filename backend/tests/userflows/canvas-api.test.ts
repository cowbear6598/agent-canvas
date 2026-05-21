import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiIntegrationHarness } from "../helpers/apiIntegrationHarness.js";
import type { ApiIntegrationHarness } from "../helpers/apiIntegrationHarness.js";
import { getDb } from "../../src/database/index.js";

describe("Canvas REST user flow", () => {
  let harness: ApiIntegrationHarness;

  beforeAll(async () => {
    harness = await createApiIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("建立 canvas 後建立並更新 pod，API 讀回內容與資料庫一致", async () => {
    const createCanvas = await harness.post<{
      canvas: { id: string; name: string; sortIndex: number };
    }>("/api/canvas", { name: "api-userflow-canvas" });

    expect(createCanvas.status).toBe(201);
    expect(createCanvas.body.canvas.name).toBe("api-userflow-canvas");

    const canvasRow = getDb()
      .prepare("SELECT id, name, sort_index FROM canvases WHERE id = ?")
      .get(createCanvas.body.canvas.id) as
      | { id: string; name: string; sort_index: number }
      | undefined;
    expect(canvasRow).toEqual({
      id: createCanvas.body.canvas.id,
      name: "api-userflow-canvas",
      sort_index: createCanvas.body.canvas.sortIndex,
    });

    const createPod = await harness.post<{
      pod: {
        id: string;
        name: string;
        workspacePath: string;
        x: number;
        y: number;
        providerConfig: { model: string; thinkingLevel?: string };
      };
    }>(`/api/canvas/${createCanvas.body.canvas.id}/pods`, {
      name: "api-flow-pod",
      x: 120,
      y: -40,
      providerConfig: { model: "sonnet" },
    });

    expect(createPod.status).toBe(201);
    expect(createPod.body.pod).toMatchObject({
      name: "api-flow-pod",
      x: 120,
      y: -40,
      providerConfig: { model: "sonnet", thinkingLevel: "high" },
    });
    expect(existsSync(createPod.body.pod.workspacePath)).toBe(true);

    const renamePod = await harness.patch<{
      pod: { id: string; name: string; x: number; y: number };
    }>(
      `/api/canvas/${createCanvas.body.canvas.id}/pods/${createPod.body.pod.id}`,
      { name: "api-flow-pod-renamed" },
    );
    expect(renamePod.status).toBe(200);
    expect(renamePod.body.pod.name).toBe("api-flow-pod-renamed");

    const listPods = await harness.get<{
      pods: Array<{
        id: string;
        name: string;
        workspacePath: string;
        x: number;
        y: number;
        providerConfig: { model: string; thinkingLevel?: string };
      }>;
    }>(`/api/canvas/${createCanvas.body.canvas.id}/pods`);
    expect(listPods.status).toBe(200);

    const readBackPod = listPods.body.pods.find(
      (pod) => pod.id === createPod.body.pod.id,
    );
    expect(readBackPod).toMatchObject({
      id: createPod.body.pod.id,
      name: "api-flow-pod-renamed",
      workspacePath: createPod.body.pod.workspacePath,
      x: 120,
      y: -40,
      providerConfig: { model: "sonnet", thinkingLevel: "high" },
    });

    const podRow = getDb()
      .prepare(
        "SELECT canvas_id, name, x, y, workspace_path, provider_config_json FROM pods WHERE id = ?",
      )
      .get(createPod.body.pod.id) as
      | {
          canvas_id: string;
          name: string;
          x: number;
          y: number;
          workspace_path: string;
          provider_config_json: string;
        }
      | undefined;

    expect(podRow).toBeDefined();
    expect(podRow).toMatchObject({
      canvas_id: createCanvas.body.canvas.id,
      name: "api-flow-pod-renamed",
      x: 120,
      y: -40,
      workspace_path: createPod.body.pod.workspacePath,
    });
    expect(JSON.parse(podRow!.provider_config_json)).toEqual({
      model: "sonnet",
      thinkingLevel: "high",
    });
    expect(createPod.body.pod.workspacePath).toContain(
      join("tmp", "AgentCanvas"),
    );
  });
});
