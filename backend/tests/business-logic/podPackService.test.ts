import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import { simpleGit } from "simple-git";
import {
  createPodPackArchive,
  createPodPackArchiveFile,
  importPreparedPodPack,
  parsePodPackArchive,
  preparePodPackArchive,
  previewPodPackArchive,
} from "../../src/services/podPack/podPackService.js";
import { repositoryService } from "../../src/services/repositoryService.js";
import { config } from "../../src/config/index.js";
import { canvasStore } from "../../src/services/canvasStore.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function createExportData() {
  return {
    pods: [
      {
        originalId: SOURCE_ID,
        name: "Planner",
        x: 10,
        y: 20,
        rotation: 0,
        provider: "claude" as const,
        providerConfig: { model: "opus" },
        repositoryId: "33333333-3333-4333-8333-333333333333",
      },
      {
        originalId: TARGET_ID,
        name: "Reviewer",
        x: 300,
        y: 80,
        rotation: 1,
        provider: "claude" as const,
        providerConfig: { model: "sonnet" },
      },
    ],
    connections: [
      {
        originalSourcePodId: SOURCE_ID,
        sourceAnchor: "right" as const,
        originalTargetPodId: TARGET_ID,
        targetAnchor: "left" as const,
        triggerMode: "branch" as const,
        label: "approve",
        description: "Review the plan",
        branchProvider: "claude" as const,
        branchModel: "opus",
        branchThinkingLevel: "high",
      },
    ],
  };
}

describe("podPackService", () => {
  it("建立 v2 ZIP；不存在的 Repository 會明確省略並保留拓撲設定", async () => {
    const archive = await createPodPackArchive(createExportData());
    const { manifest } = parsePodPackArchive(archive);

    expect(manifest).toMatchObject({
      format: "agent-canvas-pod-pack",
      version: 2,
    });
    expect(manifest.pods.map((pod) => [pod.x, pod.y])).toEqual([
      [10, 20],
      [300, 80],
    ]);
    expect(manifest.pods.every((pod) => pod.repositoryId === null)).toBe(true);
    expect(manifest.connections[0]).toMatchObject({
      triggerMode: "branch",
      branchProvider: "claude",
      branchModel: "opus",
      branchThinkingLevel: "high",
    });
  });

  it("預覽會回報拓撲數量", async () => {
    const preview = await previewPodPackArchive(
      await createPodPackArchive(createExportData()),
    );
    expect(preview).toMatchObject({ podCount: 2, connectionCount: 1 });
  });

  it("仍可解析 v1 Pod pack", () => {
    const data = createExportData();
    const archive = zipSync({
      "manifest.json": Buffer.from(JSON.stringify({
        format: "agent-canvas-pod-pack",
        version: 1,
        exportedAt: new Date().toISOString(),
        pods: data.pods.map((pod) => ({ ...pod, repositoryId: null })),
        connections: data.connections,
        plugins: [],
        managedMcps: [],
      })),
    });

    expect(parsePodPackArchive(archive).manifest.version).toBe(1);
  });

  it("PodPack 磁碟串流會保留 Git metadata、多 Pod note 綁定與非忽略的 working tree", async () => {
    const repositoryId = `podpack-${randomUUID().slice(0, 8)}`;
    await repositoryService.create(repositoryId);
    const repositoryPath = repositoryService.getRepositoryPath(repositoryId);
    await fs.writeFile(path.join(repositoryPath, ".gitignore"), "ignored.txt\n");
    await fs.writeFile(path.join(repositoryPath, "keep.txt"), "keep");
    await fs.writeFile(path.join(repositoryPath, "ignored.txt"), "ignored");
    await simpleGit({ baseDir: repositoryPath }).init();
    await simpleGit({ baseDir: repositoryPath }).add([".gitignore", "keep.txt"]);

    await fs.mkdir(config.tmpRoot, { recursive: true });
    const transferRoot = await fs.mkdtemp(path.join(config.tmpRoot, "podpack-test-"));
    const archivePath = path.join(transferRoot, "source.podpack");
    let importedRepositoryId: string | null = null;
    let canvasId: string | null = null;
    try {
      const data = createExportData();
      data.pods[0]!.repositoryId = repositoryId;
      data.pods[1]!.repositoryId = repositoryId;
      await createPodPackArchiveFile({
        ...data,
        repositoryNotes: [
          {
            repositoryId,
            name: "Repository note",
            x: 40,
            y: 50,
            boundToOriginalPodId: SOURCE_ID,
            originalPosition: null,
          },
          {
            repositoryId,
            name: "Reviewer repository note",
            x: 300,
            y: 80,
            boundToOriginalPodId: TARGET_ID,
            originalPosition: null,
          },
        ],
      }, archivePath);
      const prepared = await preparePodPackArchive(archivePath, transferRoot);

      expect(prepared.manifest.version).toBe(2);
      if (prepared.manifest.version !== 2) throw new Error("預期為 v2 manifest");
      const repository = prepared.manifest.repositories[0]!;
      expect(repository).toMatchObject({
        originalId: repositoryId,
        source: "git",
        note: { name: "Repository note", boundToOriginalPodId: SOURCE_ID },
        notes: [
          { name: "Repository note", boundToOriginalPodId: SOURCE_ID },
          {
            name: "Reviewer repository note",
            boundToOriginalPodId: TARGET_ID,
          },
        ],
      });
      const restored = prepared.repositoryDirectories.get(repositoryId)!;
      await expect(fs.stat(path.join(restored, ".git"))).resolves.toBeDefined();
      await expect(fs.readFile(path.join(restored, "keep.txt"), "utf-8")).resolves.toBe("keep");
      await expect(fs.stat(path.join(restored, "ignored.txt"))).rejects.toMatchObject({ code: "ENOENT" });

      // 即使封包只帶部分 note，也直接依 Pod 的 Repository 關聯補齊綁定。
      repository.notes = repository.notes?.slice(0, 1);

      const canvas = await canvasStore.create(`podpack-${randomUUID().slice(0, 8)}`);
      if (!canvas.success) throw new Error("建立測試 Canvas 失敗");
      canvasId = canvas.data.id;
      await fs.mkdir(config.getCanvasPath(canvas.data.name), { recursive: true });
      const imported = await importPreparedPodPack(prepared, {
        canvasId,
        targetX: 500,
        targetY: 400,
      });
      importedRepositoryId = imported.createdPods[0]?.repositoryId ?? null;
      expect(importedRepositoryId).toBe(`${repositoryId}-imported`);
      expect(imported.createdPods.every(
        (pod) => pod.repositoryId === importedRepositoryId,
      )).toBe(true);
      expect(imported.createdRepositoryNotes).toEqual([
        expect.objectContaining({
          repositoryId: importedRepositoryId,
          boundToPodId: imported.createdPods[0]?.id,
        }),
        expect.objectContaining({
          repositoryId: importedRepositoryId,
          boundToPodId: imported.createdPods[1]?.id,
        }),
      ]);
      await expect(fs.readFile(
        path.join(repositoryService.getRepositoryPath(importedRepositoryId!), "keep.txt"),
        "utf-8",
      )).resolves.toBe("keep");
    } finally {
      if (canvasId) await canvasStore.delete(canvasId);
      if (importedRepositoryId) await repositoryService.delete(importedRepositoryId);
      await repositoryService.delete(repositoryId);
      await fs.rm(transferRoot, { recursive: true, force: true });
    }
  });

  it("拒絕不支援的 manifest 版本", () => {
    const archive = zipSync({
      "manifest.json": Buffer.from(
        JSON.stringify({
          format: "agent-canvas-pod-pack",
          version: 99,
          exportedAt: new Date().toISOString(),
          pods: [],
          connections: [],
          plugins: [],
          managedMcps: [],
        }),
      ),
    });
    expect(() => parsePodPackArchive(archive)).toThrow(
      "POD_PACK_MANIFEST_INVALID",
    );
  });
});
