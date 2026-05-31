import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApiIntegrationHarness,
  type ApiIntegrationHarness,
} from "../helpers/apiIntegrationHarness.js";
import { getDb } from "../../src/database/index.js";
import { createPodWithWorkspace } from "../../src/services/podService.js";

async function createDownloadPod(
  canvasId: string,
  name: string,
): Promise<{ id: string; name: string; workspacePath: string }> {
  const result = await createPodWithWorkspace(
    canvasId,
    {
      name,
      x: 12,
      y: 34,
      rotation: 0,
    },
    "test",
  );

  if (!result.success) {
    throw new Error(`建立下載測試 Pod 失敗：${String(result.error)}`);
  }

  return result.data.pod;
}

describe("Pod download API user flow", () => {
  let harness: ApiIntegrationHarness;

  beforeAll(async () => {
    harness = await createApiIntegrationHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it("將 pod workspace 封裝成 zip，內容與資料庫 workspace_path 指向的檔案一致", async () => {
    const pod = await createDownloadPod(harness.canvasId, "download-api-pod");

    const row = getDb()
      .prepare("SELECT workspace_path FROM pods WHERE id = ?")
      .get(pod.id) as { workspace_path: string } | undefined;
    expect(row?.workspace_path).toBe(pod.workspacePath);

    await mkdir(join(pod.workspacePath, "src"), { recursive: true });
    await writeFile(join(pod.workspacePath, "README.md"), "# Pod Export\n");
    await writeFile(
      join(pod.workspacePath, "src", "index.ts"),
      'export const source = "pod";\n',
    );
    await writeFile(
      join(pod.workspacePath, ".gitignore"),
      "node_modules/\n*.log\n",
    );
    await mkdir(join(pod.workspacePath, "node_modules"), {
      recursive: true,
    });
    await writeFile(join(pod.workspacePath, "node_modules", "skip.js"), "");
    await writeFile(join(pod.workspacePath, "debug.log"), "skip");

    const response = await harness.request(
      `/api/canvas/${harness.canvasId}/pods/${pod.id}/download`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain(
      `${pod.name}.zip`,
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
    const pod = await createDownloadPod(
      harness.canvasId,
      "download-missing-workspace-pod",
    );

    await rm(pod.workspacePath, { recursive: true, force: true });

    const response = await harness.get<{ error: string }>(
      `/api/canvas/${harness.canvasId}/pods/${pod.id}/download`,
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("目標目錄不存在");

    const row = getDb()
      .prepare("SELECT id, workspace_path FROM pods WHERE id = ?")
      .get(pod.id) as
      | { id: string; workspace_path: string }
      | undefined;
    expect(row).toEqual({
      id: pod.id,
      workspace_path: pod.workspacePath,
    });
  });
});
