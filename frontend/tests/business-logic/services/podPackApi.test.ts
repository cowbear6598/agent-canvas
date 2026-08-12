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

  it("匯出使用 JSON 契約並讀取下載檔名", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("zip", {
        headers: {
          "Content-Disposition": 'attachment; filename="topology.podpack"',
        },
      }),
    );
    const result = await exportPodPack({ pods: [], connections: [] });
    expect(result.filename).toBe("topology.podpack");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/pod-packs/export",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("預覽與匯入都以 multipart 傳送同一個 podpack", async () => {
    const file = new File(["zip"], "topology.podpack");
    const preview = {
      format: "agent-canvas-pod-pack",
      version: 1,
      podCount: 1,
      connectionCount: 0,
      plugins: [],
      managedMcps: [],
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ preview }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            preview,
            createdPods: [],
            createdConnections: [],
            podIdMapping: {},
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );

    expect(await previewPodPack(file)).toEqual(preview);
    await importPodPack(file, "11111111-1111-4111-8111-111111111111", {
      x: 12,
      y: 34,
    });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ body: expect.any(FormData) }),
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "canvasId=11111111-1111-4111-8111-111111111111",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("targetX=12");
  });
});
