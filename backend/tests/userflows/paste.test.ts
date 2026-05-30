import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import { createRepository, getCanvasId } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type CanvasPastePayload,
  type PastePodItem,
  type PasteConnectionItem,
  type PasteRepositoryNoteItem,
} from "../../src/schemas";
import { type CanvasPasteResultPayload } from "../../src/types";
import { codexProvider } from "../../src/services/provider/codexProvider.js";

const CODEX_DEFAULT_MODEL = codexProvider.metadata.defaultOptions.model;

describe("貼上功能", () => {
  const { getClient } = setupIntegrationTest();

  async function emptyPastePayload(): Promise<CanvasPastePayload> {
    const client = getClient();
    const canvasId = await getCanvasId(client);
    return {
      requestId: uuidv4(),
      canvasId,
      pods: [],
      repositoryNotes: [],
      connections: [],
    };
  }

  describe("Canvas 貼上", () => {
    it("成功貼上並建立 Pod 和連線", async () => {
      const client = getClient();
      const podId1 = uuidv4();
      const podId2 = uuidv4();

      const pods: PastePodItem[] = [
        { originalId: podId1, name: "Paste Pod 1", x: 0, y: 0, rotation: 0 },
        {
          originalId: podId2,
          name: "Paste Pod 2",
          x: 100,
          y: 100,
          rotation: 0,
        },
      ];

      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId: podId1,
          sourceAnchor: "right",
          originalTargetPodId: podId2,
          targetAnchor: "left",
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
        connections,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.createdPods).toHaveLength(2);
      expect(response.createdConnections).toHaveLength(1);
      expect(Object.keys(response.podIdMapping)).toHaveLength(2);
    });

    it("成功貼上空內容", async () => {
      const client = getClient();
      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        await emptyPastePayload(),
      );

      expect(response.createdPods).toHaveLength(0);
      expect(response.createdConnections).toHaveLength(0);
    });

    it("來源或目標 Pod 缺少 mapping 時，connection 會回報錯誤而不是靜默略過", async () => {
      const client = getClient();
      const validPodId = uuidv4();
      const pods: PastePodItem[] = [
        { originalId: validPodId, name: "Valid", x: 0, y: 0, rotation: 0 },
      ];

      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId: uuidv4(),
          sourceAnchor: "right",
          originalTargetPodId: validPodId,
          targetAnchor: "left",
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
        connections,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.success).toBe(false);
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0]).toMatchObject({
        type: "connection",
      });
      expect(response.createdPods).toHaveLength(1);
      expect(response.createdConnections).toHaveLength(0);
    });

    it("connection 建立失敗時回報錯誤並保留已成功建立的其他 connection", async () => {
      const client = getClient();
      const sourcePodId = uuidv4();
      const targetPodId1 = uuidv4();
      const targetPodId2 = uuidv4();

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods: [
          {
            originalId: sourcePodId,
            name: "Source Pod",
            x: 0,
            y: 0,
            rotation: 0,
          },
          {
            originalId: targetPodId1,
            name: "Target Pod 1",
            x: 100,
            y: 0,
            rotation: 0,
          },
          {
            originalId: targetPodId2,
            name: "Target Pod 2",
            x: 200,
            y: 0,
            rotation: 0,
          },
        ],
        connections: [
          {
            originalSourcePodId: sourcePodId,
            sourceAnchor: "right",
            originalTargetPodId: targetPodId1,
            targetAnchor: "left",
            triggerMode: "branch",
            label: "Approved",
          },
          {
            originalSourcePodId: sourcePodId,
            sourceAnchor: "right",
            originalTargetPodId: targetPodId2,
            targetAnchor: "left",
            triggerMode: "branch",
            label: "Approved",
          },
        ],
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.success).toBe(false);
      expect(response.createdConnections).toHaveLength(1);
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0]).toMatchObject({
        type: "connection",
        error: "label 已存在於同一組 branch",
      });
    });

    describe("connection triggerMode 驗證", () => {
      const triggerModes = ["auto", "direct"] as const;

      it.each(triggerModes)(
        "貼上 connection 時帶 triggerMode: %s 能成功",
        async (triggerMode) => {
          const client = getClient();
          const podId1 = uuidv4();
          const podId2 = uuidv4();

          const pods: PastePodItem[] = [
            { originalId: podId1, name: "Pod 1", x: 0, y: 0, rotation: 0 },
            { originalId: podId2, name: "Pod 2", x: 100, y: 100, rotation: 0 },
          ];

          const connections: PasteConnectionItem[] = [
            {
              originalSourcePodId: podId1,
              sourceAnchor: "right",
              originalTargetPodId: podId2,
              targetAnchor: "left",
              triggerMode,
            },
          ];

          const payload: CanvasPastePayload = {
            ...(await emptyPastePayload()),
            pods,
            connections,
          };

          const response = await emitAndWaitResponse<
            CanvasPastePayload,
            CanvasPasteResultPayload
          >(
            client,
            WebSocketRequestEvents.CANVAS_PASTE,
            WebSocketResponseEvents.CANVAS_PASTE_RESULT,
            payload,
          );

          expect(response.createdConnections).toHaveLength(1);
        },
      );

      it("貼上 connection 時帶 triggerMode: branch 與 label 能成功", async () => {
        const client = getClient();
        const podId1 = uuidv4();
        const podId2 = uuidv4();

        const pods: PastePodItem[] = [
          { originalId: podId1, name: "Pod 1", x: 0, y: 0, rotation: 0 },
          { originalId: podId2, name: "Pod 2", x: 100, y: 100, rotation: 0 },
        ];

        const connections: PasteConnectionItem[] = [
          {
            originalSourcePodId: podId1,
            sourceAnchor: "right",
            originalTargetPodId: podId2,
            targetAnchor: "left",
            triggerMode: "branch",
            label: "Checklist",
          },
        ];

        const payload: CanvasPastePayload = {
          ...(await emptyPastePayload()),
          pods,
          connections,
        };

        const response = await emitAndWaitResponse<
          CanvasPastePayload,
          CanvasPasteResultPayload
        >(
          client,
          WebSocketRequestEvents.CANVAS_PASTE,
          WebSocketResponseEvents.CANVAS_PASTE_RESULT,
          payload,
        );

        expect(response.createdConnections).toHaveLength(1);
        expect(response.createdConnections[0].triggerMode).toBe("branch");
        expect(response.createdConnections[0].label).toBe("Checklist");
      });

      it("貼上 connection 時不帶 triggerMode 能成功", async () => {
        const client = getClient();
        const podId1 = uuidv4();
        const podId2 = uuidv4();

        const pods: PastePodItem[] = [
          { originalId: podId1, name: "Pod 1", x: 0, y: 0, rotation: 0 },
          { originalId: podId2, name: "Pod 2", x: 100, y: 100, rotation: 0 },
        ];

        const connections: PasteConnectionItem[] = [
          {
            originalSourcePodId: podId1,
            sourceAnchor: "right",
            originalTargetPodId: podId2,
            targetAnchor: "left",
          },
        ];

        const payload: CanvasPastePayload = {
          ...(await emptyPastePayload()),
          pods,
          connections,
        };

        const response = await emitAndWaitResponse<
          CanvasPastePayload,
          CanvasPasteResultPayload
        >(
          client,
          WebSocketRequestEvents.CANVAS_PASTE,
          WebSocketResponseEvents.CANVAS_PASTE_RESULT,
          payload,
        );

        expect(response.createdConnections).toHaveLength(1);
      });
    });

    it("成功貼上並建立儲存庫註記", async () => {
      const client = getClient();
      const repository = await createRepository(client, `repo-${uuidv4()}`);

      const repositoryNotes: PasteRepositoryNoteItem[] = [
        {
          repositoryId: repository.id,
          name: "Repository Note",
          x: 10,
          y: 10,
          boundToOriginalPodId: null,
          originalPosition: { x: 10, y: 10 },
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        repositoryNotes,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.createdRepositoryNotes).toHaveLength(1);
      expect(response.createdRepositoryNotes[0].repositoryId).toBe(
        repository.id,
      );
    });

    it("Pod 的 repositoryId 指向不存在的 UUID 時，回報錯誤且不建立該 Pod", async () => {
      const client = getClient();
      const nonExistentRepositoryId = uuidv4();
      const originalPodId = uuidv4();

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Invalid Repo Pod",
          x: 0,
          y: 0,
          rotation: 0,
          repositoryId: nonExistentRepositoryId,
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.success).toBe(false);
      expect(response.errors).toHaveLength(1);
      expect(response.createdPods).not.toContainEqual(
        expect.objectContaining({ id: originalPodId }),
      );
    });

    it("Codex Pod 複製貼上後 provider 仍為 codex、model 仍為 CODEX_DEFAULT_MODEL", async () => {
      const client = getClient();
      const originalPodId = uuidv4();

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Codex Pod",
          x: 0,
          y: 0,
          rotation: 0,
          provider: "codex",
          providerConfig: { model: CODEX_DEFAULT_MODEL },
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.createdPods).toHaveLength(1);

      const newPodId = response.podIdMapping[originalPodId];
      const canvasId = await getCanvasId(client);
      const { podStore } = await import("../../src/services/podStore.js");
      const pod = podStore.getById(canvasId, newPodId);

      // 驗證 provider 和 model 沒有被靜默降級
      expect(pod?.provider).toBe("codex");
      expect(pod?.providerConfig?.model).toBe(CODEX_DEFAULT_MODEL);
    });

    it("OpenCode Pod 的 connection 複製貼上後保留 summary provider/model", async () => {
      const client = getClient();
      const sourcePodId = uuidv4();
      const targetPodId = uuidv4();

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods: [
          {
            originalId: sourcePodId,
            name: "OpenCode Source",
            x: 0,
            y: 0,
            rotation: 0,
            provider: "opencode",
            providerConfig: { model: "openai/gpt-4o" },
          },
          {
            originalId: targetPodId,
            name: "OpenCode Target",
            x: 100,
            y: 100,
            rotation: 0,
          },
        ],
        connections: [
          {
            originalSourcePodId: sourcePodId,
            sourceAnchor: "right",
            originalTargetPodId: targetPodId,
            targetAnchor: "left",
            summaryProvider: "opencode",
            summaryModel: "openai/gpt-4o",
          },
        ],
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.createdConnections).toHaveLength(1);
      expect(response.createdConnections[0].summaryProvider).toBe("opencode");
      expect(response.createdConnections[0].summaryModel).toBe("openai/gpt-4o");
    });

    it("Claude Pod 帶非預設 model 複製貼上後 model 沒有被覆寫成預設 opus", async () => {
      const client = getClient();
      const originalPodId = uuidv4();
      // 使用非預設的 Claude model（預設為 opus，這裡改用 sonnet）
      const nonDefaultClaudeModel = "sonnet";

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Claude Sonnet Pod",
          x: 0,
          y: 0,
          rotation: 0,
          provider: "claude",
          providerConfig: { model: nonDefaultClaudeModel },
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.createdPods).toHaveLength(1);

      const newPodId = response.podIdMapping[originalPodId];
      const canvasId = await getCanvasId(client);
      const { podStore } = await import("../../src/services/podStore.js");
      const pod = podStore.getById(canvasId, newPodId);

      // 驗證 provider 和 model 沒有被覆寫成預設值
      expect(pod?.provider).toBe("claude");
      expect(pod?.providerConfig?.model).toBe(nonDefaultClaudeModel);
    });

    it("含非法 pluginId 格式（含空白）的 paste payload 回傳 VALIDATION_ERROR", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);

      const rawPayload = {
        requestId: uuidv4(),
        canvasId,
        pods: [
          {
            originalId: uuidv4(),
            name: "Evil Plugin Pod",
            x: 0,
            y: 0,
            rotation: 0,
            pluginIds: ["plugin evil"],
          },
        ],
        repositoryNotes: [],
        connections: [],
      };

      const response = await emitAndWaitResponse(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        rawPayload,
      );

      // Zod 驗證失敗時，wsMiddleware 回傳 code: "VALIDATION_ERROR"
      expect((response as any).code).toBe("VALIDATION_ERROR");
      expect((response as any).success).toBe(false);
    });

    it("貼上與現有 Pod 同名時後端自動加後綴（resolveUniquePodName）", async () => {
      const client = getClient();
      const canvasId = await getCanvasId(client);

      // 先貼上一個名為 "Pod 1" 的 Pod
      const firstPayload: CanvasPastePayload = {
        requestId: uuidv4(),
        canvasId,
        pods: [
          { originalId: uuidv4(), name: "Pod 1", x: 0, y: 0, rotation: 0 },
        ],
        repositoryNotes: [],
        connections: [],
      };

      await emitAndWaitResponse<CanvasPastePayload, CanvasPasteResultPayload>(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        firstPayload,
      );

      // 再貼上同名 "Pod 1"，後端應自動加後綴
      const secondPayload: CanvasPastePayload = {
        requestId: uuidv4(),
        canvasId,
        pods: [
          { originalId: uuidv4(), name: "Pod 1", x: 50, y: 50, rotation: 0 },
        ],
        repositoryNotes: [],
        connections: [],
      };

      const secondResponse = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        secondPayload,
      );

      expect(secondResponse.createdPods).toHaveLength(1);
      // 驗證 DB 中寫入的名稱帶有隨機後綴（格式：Pod 1-XXXXXX）而非重名
      const { podStore } = await import("../../src/services/podStore.js");
      const allPods = podStore.list(canvasId);
      const podNames = allPods.map((p) => p.name);
      expect(podNames).toContain("Pod 1");
      // 衝突時加 6 碼 hex 隨機後綴
      const dedupedPod = podNames.find((n) => /^Pod 1-[0-9a-f]{6}$/.test(n));
      expect(dedupedPod).toBeDefined();
    });

    it("貼上帶合法 pluginIds 的 Pod 後 DB 正確寫入 pluginIds", async () => {
      const client = getClient();
      const originalPodId = uuidv4();

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Plugin Pod",
          x: 0,
          y: 0,
          rotation: 0,
          pluginIds: ["my-plugin", "another.plugin@1.0"],
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
      };

      const response = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        payload,
      );

      expect(response.createdPods).toHaveLength(1);

      const newPodId = response.podIdMapping[originalPodId];
      const canvasId = await getCanvasId(client);
      const { podStore } = await import("../../src/services/podStore.js");
      const pod = podStore.getById(canvasId, newPodId);

      expect(pod?.pluginIds).toContain("my-plugin");
      expect(pod?.pluginIds).toContain("another.plugin@1.0");
      expect(pod?.pluginIds).toHaveLength(2);
    });
  });
});
