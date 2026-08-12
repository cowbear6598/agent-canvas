import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  createPodPackArchive,
  parsePodPackArchive,
  previewPodPackArchive,
} from "../../src/services/podPack/podPackService.js";

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
  it("建立版本化 ZIP，排除 Repository 並保留 Pod 相對位置與 Branch 設定", async () => {
    const archive = await createPodPackArchive(createExportData());
    const { manifest } = parsePodPackArchive(archive);

    expect(manifest).toMatchObject({
      format: "agent-canvas-pod-pack",
      version: 1,
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
