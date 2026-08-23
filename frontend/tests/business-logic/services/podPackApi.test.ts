import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportPodPack,
  importPodPack,
  previewPodPack,
} from "@/services/podPackApi";

vi.mock("@/services/utils", () => ({
  getApiBaseUrl: () => "http://localhost:3001",
}));

describe("podPackApi", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("匯出使用 JSON 契約並取得磁碟 transfer", async () => {
    const transfer = {
      id: "11111111-1111-4111-8111-111111111111",
      filename: "topology.podpack",
      size: 123,
      createdAt: new Date().toISOString(),
      kind: "export" as const,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ transfer }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await exportPodPack({ pods: [], connections: [], repositoryNotes: [] });
    expect(result.filename).toBe("topology.podpack");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/pod-packs/export",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("預覽只上傳一次，匯入以 transferId 使用已暫存檔案", async () => {
    const file = new File(["zip"], "topology.podpack");
    const preview = {
      format: "agent-canvas-pod-pack",
      version: 1,
      podCount: 1,
      connectionCount: 0,
      repositories: [],
      plugins: [],
      managedMcps: [],
      omitted: [],
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transferId: "transfer-1", preview }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            preview,
            createdPods: [],
            createdRepositoryNotes: [],
            createdConnections: [],
            podIdMapping: {},
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );

    expect(await previewPodPack(file)).toEqual({ transferId: "transfer-1", preview });
    await importPodPack("transfer-1", "11111111-1111-4111-8111-111111111111", {
      x: 12,
      y: 34,
    });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ body: file }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      transferId: "transfer-1",
      canvasId: "11111111-1111-4111-8111-111111111111",
      targetX: 12,
      targetY: 34,
    });
  });
});
