import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApiIntegrationHarness,
  type ApiIntegrationHarness,
} from "../helpers/apiIntegrationHarness.js";
import { getDb } from "../../src/database/index.js";

describe("Pod download API user flow", () => {
  let harness: ApiIntegrationHarness;

  beforeAll(async () => {
    harness = await createApiIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("將 pod workspace 封裝成 zip，內容與資料庫 workspace_path 指向的檔案一致", async () => {
    const createPod = await harness.post<{
      pod: { id: string; name: string; workspacePath: string };
    }>(`/api/canvas/${harness.canvasId}/pods`, {
      name: "download-api-pod",
      x: 12,
      y: 34,
    });
    expect(createPod.status).toBe(201);

    const row = getDb()
      .prepare("SELECT workspace_path FROM pods WHERE id = ?")
      .get(createPod.body.pod.id) as { workspace_path: string } | undefined;
    expect(row?.workspace_path).toBe(createPod.body.pod.workspacePath);

    await mkdir(join(row!.workspace_path, "src"), { recursive: true });
    await writeFile(join(row!.workspace_path, "README.md"), "# Pod Export\n");
    await writeFile(
      join(row!.workspace_path, "src", "index.ts"),
      'export const source = "pod";\n',
    );
    await writeFile(
      join(row!.workspace_path, ".gitignore"),
      "node_modules/\n*.log\n",
    );
    await mkdir(join(row!.workspace_path, "node_modules"), {
      recursive: true,
    });
    await writeFile(join(row!.workspace_path, "node_modules", "skip.js"), "");
    await writeFile(join(row!.workspace_path, "debug.log"), "skip");

    const response = await harness.request(
      `/api/canvas/${harness.canvasId}/pods/${createPod.body.pod.id}/download`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain(
      "download-api-pod.zip",
    );

    const zipData = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(new TextDecoder().decode(zipData["README.md"])).toBe(
      "# Pod Export\n",
    );
    expect(new TextDecoder().decode(zipData["src/index.ts"])).toBe(
      'export const source = "pod";\n',
    );
    expect(zipData["node_modules/skip.js"]).toBeUndefined();
    expect(zipData["debug.log"]).toBeUndefined();
  });

  it("workspace 不存在時回傳 404，資料庫仍保留 pod 紀錄供維護者定位", async () => {
    const createPod = await harness.post<{
      pod: { id: string; workspacePath: string };
    }>(`/api/canvas/${harness.canvasId}/pods`, {
      name: "download-missing-workspace-pod",
      x: 0,
      y: 0,
    });
    expect(createPod.status).toBe(201);

    await rm(createPod.body.pod.workspacePath, { recursive: true, force: true });

    const response = await harness.get<{ error: string }>(
      `/api/canvas/${harness.canvasId}/pods/${createPod.body.pod.id}/download`,
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("目標目錄不存在");

    const row = getDb()
      .prepare("SELECT id, workspace_path FROM pods WHERE id = ?")
      .get(createPod.body.pod.id) as
      | { id: string; workspace_path: string }
      | undefined;
    expect(row).toEqual({
      id: createPod.body.pod.id,
      workspace_path: createPod.body.pod.workspacePath,
    });
  });
});
