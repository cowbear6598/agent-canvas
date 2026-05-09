import { v4 as uuidv4 } from "uuid";
import { emitAndWaitResponse, setupIntegrationTest } from "../setup";
import { createRepository, createCommand, getCanvasId } from "../helpers";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
  type CanvasPastePayload,
  type PastePodItem,
  type PasteConnectionItem,
  type PasteRepositoryNoteItem,
  type PasteCommandNoteItem,
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
      commandNotes: [],
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

    it("成功回報無效項目的錯誤", async () => {
      const client = getClient();
      const validPodId = uuidv4();
      const pods: PastePodItem[] = [
        { originalId: validPodId, name: "Valid", x: 0, y: 0, rotation: 0 },
      ];

      // Connection with nonexistent source should fail silently (no mapping)
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

      expect(response.createdPods).toHaveLength(1);
      // Connection should not be created because source pod is not in the mapping
      expect(response.createdConnections).toHaveLength(0);
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

    it("成功貼上並建立綁定 Pod 的指令註記", async () => {
      const client = getClient();
      const command = await createCommand(
        client,
        `command-${uuidv4()}`,
        "# Test Command",
      );
      const originalPodId = uuidv4();

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Command Pod",
          x: 0,
          y: 0,
          rotation: 0,
        },
      ];

      const commandNotes: PasteCommandNoteItem[] = [
        {
          commandId: command.id,
          name: "Command Note",
          x: 10,
          y: 10,
          boundToOriginalPodId: originalPodId,
          originalPosition: { x: 10, y: 10 },
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
        commandNotes,
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

      expect(response.createdCommandNotes).toHaveLength(1);
      expect(response.createdPods).toHaveLength(1);

      const newPodId = response.podIdMapping[originalPodId];
      expect(response.createdCommandNotes[0].boundToPodId).toBe(newPodId);

      const canvasId = await getCanvasId(client);
      const { podStore } = await import("../../src/services/podStore.js");
      const pod = podStore.getById(canvasId, newPodId);
      expect(pod?.commandId).toBe(command.id);
    });

    it("Command Note 未綁定 Pod 時可獨立貼上，且不建立任何 Pod", async () => {
      const client = getClient();
      const command = await createCommand(
        client,
        `command-unbound-${uuidv4()}`,
        "# Test Command",
      );

      const commandNotes: PasteCommandNoteItem[] = [
        {
          commandId: command.id,
          name: "Unbound Command Note",
          x: 10,
          y: 10,
          boundToOriginalPodId: null,
          originalPosition: { x: 10, y: 10 },
        },
      ];

      const payload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        commandNotes,
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

      expect(response.createdCommandNotes).toHaveLength(1);
      expect(response.createdCommandNotes[0].boundToPodId).toBeNull();
      expect(response.createdPods).toHaveLength(0);
    });

    it("貼上 Command Note 時，若 Pod 已有 commandId，不覆蓋原本的 commandId", async () => {
      const client = getClient();
      const command1 = await createCommand(
        client,
        `command-existing-${uuidv4()}`,
        "# Existing Command",
      );
      const command2 = await createCommand(
        client,
        `command-new-${uuidv4()}`,
        "# New Command",
      );
      const originalPodId = uuidv4();

      // 先貼上一個 Pod，並綁定 command1
      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Command Pod",
          x: 0,
          y: 0,
          rotation: 0,
        },
      ];
      const firstCommandNotes: PasteCommandNoteItem[] = [
        {
          commandId: command1.id,
          name: "Command Note 1",
          x: 10,
          y: 10,
          boundToOriginalPodId: originalPodId,
          originalPosition: { x: 10, y: 10 },
        },
      ];
      const firstPayload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        pods,
        commandNotes: firstCommandNotes,
      };
      const firstResponse = await emitAndWaitResponse<
        CanvasPastePayload,
        CanvasPasteResultPayload
      >(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        firstPayload,
      );

      const newPodId = firstResponse.podIdMapping[originalPodId];
      const canvasId = await getCanvasId(client);
      const { podStore } = await import("../../src/services/podStore.js");

      const podAfterFirst = podStore.getById(canvasId, newPodId);
      expect(podAfterFirst?.commandId).toBe(command1.id);

      // 再貼上一個 commandNote（綁定到已建立的 Pod），commandId 為 command2
      // Pod 已有 commandId（command1），不應被覆蓋
      const secondCommandNotes: PasteCommandNoteItem[] = [
        {
          commandId: command2.id,
          name: "Command Note 2",
          x: 20,
          y: 20,
          boundToOriginalPodId: newPodId,
          originalPosition: { x: 20, y: 20 },
        },
      ];
      const secondPayload: CanvasPastePayload = {
        ...(await emptyPastePayload()),
        commandNotes: secondCommandNotes,
      };

      await emitAndWaitResponse<CanvasPastePayload, CanvasPasteResultPayload>(
        client,
        WebSocketRequestEvents.CANVAS_PASTE,
        WebSocketResponseEvents.CANVAS_PASTE_RESULT,
        secondPayload,
      );

      const podAfterSecond = podStore.getById(canvasId, newPodId);
      expect(podAfterSecond?.commandId).toBe(command1.id);
    });

    it("Pod 帶有 non-UUID 格式的 commandId 可以成功 paste", async () => {
      const client = getClient();
      // non-UUID 格式的 commandId（名稱即為 id）
      const nonUuidCommandId = `my-command-v2-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
      await createCommand(client, nonUuidCommandId, "# Non-UUID Command");
      const originalPodId = uuidv4();

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Non-UUID Command Pod",
          x: 0,
          y: 0,
          rotation: 0,
          commandId: nonUuidCommandId,
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
      expect(pod?.commandId).toBe(nonUuidCommandId);
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

    it("含非法 pluginId 格式（含 '/'）的 paste payload 回傳 VALIDATION_ERROR", async () => {
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
            pluginIds: ["plugin/evil"],
          },
        ],
        repositoryNotes: [],
        commandNotes: [],
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
        commandNotes: [],
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
        commandNotes: [],
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
