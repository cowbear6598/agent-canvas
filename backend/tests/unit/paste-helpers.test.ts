import { v4 as uuidv4 } from "uuid";
import type { PastePodItem, PasteConnectionItem } from "../../src/schemas";
import type { PasteError } from "../../src/types";
import { codexProvider } from "../../src/services/provider/codexProvider.js";

const CODEX_DEFAULT_MODEL = codexProvider.metadata.defaultOptions.model;

describe("Paste Helpers", () => {
  let canvasId: string;

  beforeEach(() => {
    canvasId = uuidv4();
  });

  afterEach(() => {
    // 每個 test 後必須清除所有 mock，避免 spy 狀態污染後續 test
    vi.restoreAllMocks();
  });

  // ── mock Pod 工廠 ──────────────────────────────────────────────────────────

  function makeMockPod(
    overrides: Partial<ReturnType<typeof baseMockPod>> = {},
  ) {
    return {
      ...baseMockPod(),
      ...overrides,
    };
  }

  function baseMockPod() {
    return {
      id: uuidv4(),
      name: "Test Pod",
      x: 100,
      y: 100,
      rotation: 0,
      workspacePath: "/test/workspace",
      repositoryId: null,
      outputStyleId: null,
      skillIds: [] as string[],
      subAgentIds: [] as string[],
      mcpServerIds: [] as string[],
      pluginIds: [] as string[],
      commandId: null,
      provider: "claude" as const,
      providerConfig: { model: "sonnet" },
      status: "idle" as const,
      schedule: undefined,
      sessionId: null,
      multiInstance: false,
      integrationBindings: [] as never[],
    };
  }

  /**
   * 統一設定 podStore.create mock，回傳指定 mockPod。
   * 使用 vi.spyOn 取代手動保存/還原 originalCreate，afterEach 的 vi.restoreAllMocks() 統一清除。
   */
  async function setupPodStoreMock(mockPod: ReturnType<typeof baseMockPod>) {
    const { podStore } = await import("../../src/services/podStore.js");
    vi.spyOn(podStore, "create").mockImplementation(() => ({
      pod: mockPod,
      persisted: Promise.resolve(),
    }));
    return podStore;
  }

  // ── createPastedPods ───────────────────────────────────────────────────────

  describe("createPastedPods - Repository 驗證", () => {
    it("當 repository 存在時應正常建立 Pod", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");

      const repositoryId = "test-repo-id";
      const originalPodId = uuidv4();
      const mockPod = makeMockPod({ repositoryId });

      vi.spyOn(repositoryService, "exists").mockResolvedValue(true);
      vi.spyOn(repositoryService, "getRepositoryPath").mockReturnValue(
        "/test/repo/path",
      );

      const podStore = await setupPodStoreMock(mockPod);
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Test Pod",
          x: 100,
          y: 100,
          rotation: 0,
          repositoryId,
        },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      const createdPods = await createPastedPods(
        canvasId,
        pods,
        podIdMapping,
        errors,
      );

      expect(createdPods).toHaveLength(1);
      expect(createdPods[0].id).toBe(mockPod.id);
      expect(podIdMapping[originalPodId]).toBe(mockPod.id);
      expect(errors).toHaveLength(0);
      expect(repositoryService.exists).toHaveBeenCalledWith(repositoryId);
    });

    it("當 repository 不存在時應記錄錯誤並繼續", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const nonExistentRepoId = "non-existent-repo";
      const originalPodId = uuidv4();

      vi.spyOn(repositoryService, "exists").mockResolvedValue(false);
      vi.spyOn(podStore, "list").mockReturnValue([]);

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Test Pod with Invalid Repo",
          x: 100,
          y: 100,
          rotation: 0,
          repositoryId: nonExistentRepoId,
        },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      const createdPods = await createPastedPods(
        canvasId,
        pods,
        podIdMapping,
        errors,
      );

      expect(createdPods).toHaveLength(0);
      expect(podIdMapping[originalPodId]).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        type: "pod",
        originalId: originalPodId,
        error: expect.objectContaining({ key: expect.any(String) }),
      });
      expect(repositoryService.exists).toHaveBeenCalledWith(nonExistentRepoId);
    });

    it("當 repository 為 null 時應正常建立 Pod（不驗證 repository）", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");

      const originalPodId = uuidv4();
      const mockPod = makeMockPod({ repositoryId: null });

      const existsSpy = vi
        .spyOn(repositoryService, "exists")
        .mockResolvedValue(true);

      const podStore = await setupPodStoreMock(mockPod);
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Test Pod",
          x: 100,
          y: 100,
          rotation: 0,
          repositoryId: null,
        },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      const createdPods = await createPastedPods(
        canvasId,
        pods,
        podIdMapping,
        errors,
      );

      expect(createdPods).toHaveLength(1);
      expect(createdPods[0].id).toBe(mockPod.id);
      expect(podIdMapping[originalPodId]).toBe(mockPod.id);
      expect(errors).toHaveLength(0);
      expect(existsSpy).not.toHaveBeenCalled();
    });

    it("應繼續處理其他 Pod 即使其中一個失敗", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { repositoryService } =
        await import("../../src/services/repositoryService.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");

      const failingPodId = uuidv4();
      const successPodId = uuidv4();
      const mockPod = makeMockPod({
        name: "Success Pod",
        x: 200,
        y: 200,
        repositoryId: "valid-repo",
      });

      // 預查 invalid-repo → false，valid-repo → true；mockImplementation 按參數決定
      vi.spyOn(repositoryService, "exists").mockImplementation(
        async (repoId: string) => repoId === "valid-repo",
      );
      vi.spyOn(repositoryService, "getRepositoryPath").mockReturnValue(
        "/test/repo/path",
      );

      const podStore = await setupPodStoreMock(mockPod);
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

      const pods: PastePodItem[] = [
        {
          originalId: failingPodId,
          name: "Failing Pod",
          x: 100,
          y: 100,
          rotation: 0,
          repositoryId: "invalid-repo",
        },
        {
          originalId: successPodId,
          name: "Success Pod",
          x: 200,
          y: 200,
          rotation: 0,
          repositoryId: "valid-repo",
        },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      const createdPods = await createPastedPods(
        canvasId,
        pods,
        podIdMapping,
        errors,
      );

      expect(createdPods).toHaveLength(1);
      expect(createdPods[0].id).toBe(mockPod.id);
      expect(podIdMapping[successPodId]).toBe(mockPod.id);
      expect(podIdMapping[failingPodId]).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe("pod");
      expect(errors[0].originalId).toBe(failingPodId);
    });

    it("Codex Pod 的 provider 和 providerConfig 應被原樣傳給 podStore.create", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const originalPodId = uuidv4();
      const mockPod = makeMockPod({
        provider: "codex",
        providerConfig: { model: CODEX_DEFAULT_MODEL },
      });

      let capturedCreateArgs: Parameters<typeof podStore.create>[1] | undefined;
      vi.spyOn(podStore, "create").mockImplementation(
        (_cid: string, args: Parameters<typeof podStore.create>[1]) => {
          capturedCreateArgs = args;
          return { pod: mockPod, persisted: Promise.resolve() };
        },
      );
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

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

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      const createdPods = await createPastedPods(
        canvasId,
        pods,
        podIdMapping,
        errors,
      );

      expect(createdPods).toHaveLength(1);
      expect(errors).toHaveLength(0);
      // 驗證 createSinglePod 有將 provider / providerConfig 透傳給 podStore.create
      expect(capturedCreateArgs?.provider).toBe("codex");
      expect((capturedCreateArgs?.providerConfig as any)?.model).toBe(
        CODEX_DEFAULT_MODEL,
      );
    });

    it("Claude 非預設 model 的 providerConfig 應被原樣傳給 podStore.create，不被覆寫成 opus", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const originalPodId = uuidv4();
      const nonDefaultClaudeModel = "sonnet";
      const mockPod = makeMockPod({
        provider: "claude",
        providerConfig: { model: nonDefaultClaudeModel },
      });

      let capturedCreateArgs: Parameters<typeof podStore.create>[1] | undefined;
      vi.spyOn(podStore, "create").mockImplementation(
        (_cid: string, args: Parameters<typeof podStore.create>[1]) => {
          capturedCreateArgs = args;
          return { pod: mockPod, persisted: Promise.resolve() };
        },
      );
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

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

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      const createdPods = await createPastedPods(
        canvasId,
        pods,
        podIdMapping,
        errors,
      );

      expect(createdPods).toHaveLength(1);
      expect(errors).toHaveLength(0);
      // 驗證 provider 和 非預設 model 沒有被靜默覆寫
      expect(capturedCreateArgs?.provider).toBe("claude");
      expect((capturedCreateArgs?.providerConfig as any)?.model).toBe(
        nonDefaultClaudeModel,
      );
    });
  });

  // ── resolveUniquePodName ────────────────────────────────────────────────────

  describe("resolveUniquePodName - 名稱衝突自動加後綴", () => {
    it("名稱不衝突時直接回傳原名稱", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const originalPodId = uuidv4();
      const mockPod = makeMockPod({ name: "Unique Pod" });

      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(podStore, "create").mockReturnValue({
        pod: mockPod,
        persisted: Promise.resolve(),
      });
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Unique Pod",
          x: 0,
          y: 0,
          rotation: 0,
        },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      await createPastedPods(canvasId, pods, podIdMapping, errors);

      // 驗證 create 被呼叫時帶的名稱沒有被加後綴
      const createCall = (podStore.create as ReturnType<typeof vi.spyOn>).mock
        .calls[0];
      expect(createCall?.[1]?.name).toBe("Unique Pod");
    });

    it("名稱衝突時自動加後綴 (2)", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const originalPodId = uuidv4();
      const existingPod = makeMockPod({ name: "Pod 1" });
      const mockPod = makeMockPod({ name: "Pod 1 (2)" });

      vi.spyOn(podStore, "list").mockReturnValue([existingPod] as any);
      vi.spyOn(podStore, "create").mockReturnValue({
        pod: mockPod,
        persisted: Promise.resolve(),
      });
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

      const pods: PastePodItem[] = [
        { originalId: originalPodId, name: "Pod 1", x: 0, y: 0, rotation: 0 },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      await createPastedPods(canvasId, pods, podIdMapping, errors);

      // 驗證 create 被呼叫時帶的名稱帶有後綴
      const createCall = (podStore.create as ReturnType<typeof vi.spyOn>).mock
        .calls[0];
      expect(createCall?.[1]?.name).toBe("Pod 1 (2)");
    });

    it("多個衝突時依序加後綴 (2)、(3)…", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const originalPodId = uuidv4();
      const existingPod1 = makeMockPod({ name: "Pod 1" });
      const existingPod2 = makeMockPod({ name: "Pod 1 (2)" });
      const mockPod = makeMockPod({ name: "Pod 1 (3)" });

      vi.spyOn(podStore, "list").mockReturnValue([
        existingPod1,
        existingPod2,
      ] as any);
      vi.spyOn(podStore, "create").mockReturnValue({
        pod: mockPod,
        persisted: Promise.resolve(),
      });
      vi.spyOn(podStore, "getById").mockReturnValue(undefined);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: "/test/workspace",
      });

      const pods: PastePodItem[] = [
        { originalId: originalPodId, name: "Pod 1", x: 0, y: 0, rotation: 0 },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      await createPastedPods(canvasId, pods, podIdMapping, errors);

      const createCall = (podStore.create as ReturnType<typeof vi.spyOn>).mock
        .calls[0];
      expect(createCall?.[1]?.name).toBe("Pod 1 (3)");
    });
  });

  // ── copyClaudeDir ──────────────────────────────────────────────────────────

  describe("copyClaudeDir - 觸發複製路徑", () => {
    it("originalPod 存在時 createPastedPods 不應拋例外（即使 .claude 目錄不存在）", async () => {
      const { createPastedPods } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { workspaceService } =
        await import("../../src/services/workspace/index.js");
      const { podStore } = await import("../../src/services/podStore.js");

      const originalPodId = uuidv4();
      const originalPod = makeMockPod({ id: originalPodId });
      const mockPod = makeMockPod();

      vi.spyOn(podStore, "list").mockReturnValue([]);
      vi.spyOn(podStore, "create").mockReturnValue({
        pod: mockPod,
        persisted: Promise.resolve(),
      });
      // 模擬 getById 找到 originalPod（觸發 copyClaudeDir 路徑）
      vi.spyOn(podStore, "getById").mockReturnValue(originalPod as any);
      vi.spyOn(workspaceService, "createWorkspace").mockResolvedValue({
        success: true,
        data: mockPod.workspacePath,
      });

      const pods: PastePodItem[] = [
        {
          originalId: originalPodId,
          name: "Test Pod",
          x: 0,
          y: 0,
          rotation: 0,
        },
      ];

      const podIdMapping: Record<string, string> = {};
      const errors: PasteError[] = [];

      // copyClaudeDir 內部 directoryExists 會回傳 false（路徑不存在），應靜默跳過而非拋例外
      await expect(
        createPastedPods(canvasId, pods, podIdMapping, errors),
      ).resolves.not.toThrow();
      // Pod 仍應建立成功
      expect(errors).toHaveLength(0);
    });
  });

  // ── createPastedNotesByType 失敗路徑 ──────────────────────────────────────

  describe("createPastedNotesByType - noteStore.create 失敗路徑", () => {
    it("noteStore.create 拋例外後錯誤被 recordError 捕捉，不影響其他 note", async () => {
      const { createPastedNotesByType } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { noteStore } = await import("../../src/services/noteStores.js");

      vi.spyOn(noteStore, "create").mockImplementation(() => {
        throw new Error("DB 寫入失敗");
      });

      const noteItems = [
        {
          outputStyleId: uuidv4(),
          name: "Broken Note",
          x: 0,
          y: 0,
          boundToOriginalPodId: null,
          originalPosition: null,
        },
      ];

      const result = createPastedNotesByType(
        "outputStyle",
        canvasId,
        noteItems,
        {},
      );

      expect(result.notes).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe("outputStyleNote");
    });
  });

  // ── createPastedConnections ────────────────────────────────────────────────

  describe("createPastedConnections - Connection 重建邏輯", () => {
    it("應使用 podIdMapping 正確重建 connection", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { connectionStore } =
        await import("../../src/services/connectionStore.js");

      const originalSourcePodId = uuidv4();
      const originalTargetPodId = uuidv4();
      const newSourcePodId = uuidv4();
      const newTargetPodId = uuidv4();

      const podIdMapping: Record<string, string> = {
        [originalSourcePodId]: newSourcePodId,
        [originalTargetPodId]: newTargetPodId,
      };

      const mockConnection = {
        id: uuidv4(),
        sourcePodId: newSourcePodId,
        sourceAnchor: "right" as const,
        targetPodId: newTargetPodId,
        targetAnchor: "left" as const,
        triggerMode: "auto" as const,
        decideStatus: "none" as const,
        decideReason: null,
        connectionStatus: "idle" as const,
      };

      vi.spyOn(connectionStore, "create").mockReturnValue(mockConnection);

      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId,
          sourceAnchor: "right",
          originalTargetPodId,
          targetAnchor: "left",
          triggerMode: "auto",
        },
      ];

      const createdConnections = createPastedConnections(
        canvasId,
        connections,
        podIdMapping,
      );

      expect(createdConnections).toHaveLength(1);
      expect(createdConnections[0]).toBe(mockConnection);
      expect(connectionStore.create).toHaveBeenCalledWith(canvasId, {
        sourcePodId: newSourcePodId,
        sourceAnchor: "right",
        targetPodId: newTargetPodId,
        targetAnchor: "left",
        triggerMode: "auto",
      });
    });

    it("當 source pod 不在 mapping 中時應跳過 connection", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");

      const nonExistentSourcePodId = uuidv4();
      const originalTargetPodId = uuidv4();
      const newTargetPodId = uuidv4();

      const podIdMapping: Record<string, string> = {
        [originalTargetPodId]: newTargetPodId,
      };

      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId: nonExistentSourcePodId,
          sourceAnchor: "right",
          originalTargetPodId,
          targetAnchor: "left",
        },
      ];

      const createdConnections = createPastedConnections(
        canvasId,
        connections,
        podIdMapping,
      );

      expect(createdConnections).toHaveLength(0);
    });

    it("當 target pod 不在 mapping 中時應跳過 connection", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");

      const originalSourcePodId = uuidv4();
      const nonExistentTargetPodId = uuidv4();
      const newSourcePodId = uuidv4();

      const podIdMapping: Record<string, string> = {
        [originalSourcePodId]: newSourcePodId,
      };

      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId,
          sourceAnchor: "right",
          originalTargetPodId: nonExistentTargetPodId,
          targetAnchor: "left",
        },
      ];

      const createdConnections = createPastedConnections(
        canvasId,
        connections,
        podIdMapping,
      );

      expect(createdConnections).toHaveLength(0);
    });

    it("當 source 和 target 都不在 mapping 中時應跳過 connection", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");

      const podIdMapping: Record<string, string> = {};
      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId: uuidv4(),
          sourceAnchor: "right",
          originalTargetPodId: uuidv4(),
          targetAnchor: "left",
        },
      ];

      const createdConnections = createPastedConnections(
        canvasId,
        connections,
        podIdMapping,
      );

      expect(createdConnections).toHaveLength(0);
    });

    it("應處理多個 connections 並跳過無效的", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { connectionStore } =
        await import("../../src/services/connectionStore.js");

      const validSource1 = uuidv4();
      const validTarget1 = uuidv4();
      const validSource2 = uuidv4();
      const validTarget2 = uuidv4();
      const invalidSource = uuidv4();
      const invalidTarget = uuidv4();

      const newSource1 = uuidv4();
      const newTarget1 = uuidv4();
      const newSource2 = uuidv4();
      const newTarget2 = uuidv4();

      const podIdMapping: Record<string, string> = {
        [validSource1]: newSource1,
        [validTarget1]: newTarget1,
        [validSource2]: newSource2,
        [validTarget2]: newTarget2,
      };

      const mockConnection1 = {
        id: uuidv4(),
        sourcePodId: newSource1,
        sourceAnchor: "right" as const,
        targetPodId: newTarget1,
        targetAnchor: "left" as const,
        triggerMode: "auto" as const,
        decideStatus: "none" as const,
        decideReason: null,
        connectionStatus: "idle" as const,
      };

      const mockConnection2 = {
        id: uuidv4(),
        sourcePodId: newSource2,
        sourceAnchor: "bottom" as const,
        targetPodId: newTarget2,
        targetAnchor: "top" as const,
        triggerMode: "auto" as const,
        decideStatus: "none" as const,
        decideReason: null,
        connectionStatus: "idle" as const,
      };

      vi.spyOn(connectionStore, "create")
        .mockReturnValueOnce(mockConnection1)
        .mockReturnValueOnce(mockConnection2);

      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId: validSource1,
          sourceAnchor: "right",
          originalTargetPodId: validTarget1,
          targetAnchor: "left",
          triggerMode: "auto",
        },
        {
          originalSourcePodId: invalidSource,
          sourceAnchor: "right",
          originalTargetPodId: validTarget1,
          targetAnchor: "left",
        },
        {
          originalSourcePodId: validSource2,
          sourceAnchor: "bottom",
          originalTargetPodId: validTarget2,
          targetAnchor: "top",
          triggerMode: "auto",
        },
        {
          originalSourcePodId: validSource1,
          sourceAnchor: "right",
          originalTargetPodId: invalidTarget,
          targetAnchor: "left",
        },
      ];

      const createdConnections = createPastedConnections(
        canvasId,
        connections,
        podIdMapping,
      );

      expect(createdConnections).toHaveLength(2);
      expect(createdConnections[0]).toBe(mockConnection1);
      expect(createdConnections[1]).toBe(mockConnection2);
    });

    it("應正確處理 triggerMode 預設值", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");
      const { connectionStore } =
        await import("../../src/services/connectionStore.js");

      const originalSourcePodId = uuidv4();
      const originalTargetPodId = uuidv4();
      const newSourcePodId = uuidv4();
      const newTargetPodId = uuidv4();

      const podIdMapping: Record<string, string> = {
        [originalSourcePodId]: newSourcePodId,
        [originalTargetPodId]: newTargetPodId,
      };

      const mockConnection = {
        id: uuidv4(),
        sourcePodId: newSourcePodId,
        sourceAnchor: "right" as const,
        targetPodId: newTargetPodId,
        targetAnchor: "left" as const,
        triggerMode: "auto" as const,
        decideStatus: "none" as const,
        decideReason: null,
        connectionStatus: "idle" as const,
      };

      vi.spyOn(connectionStore, "create").mockReturnValue(mockConnection);

      // 未提供 triggerMode
      const connections: PasteConnectionItem[] = [
        {
          originalSourcePodId,
          sourceAnchor: "right",
          originalTargetPodId,
          targetAnchor: "left",
        },
      ];

      createPastedConnections(canvasId, connections, podIdMapping);

      expect(connectionStore.create).toHaveBeenCalledWith(canvasId, {
        sourcePodId: newSourcePodId,
        sourceAnchor: "right",
        targetPodId: newTargetPodId,
        targetAnchor: "left",
        triggerMode: "auto",
      });
    });

    it("當 connections 為 undefined 時應回傳空陣列", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");

      const createdConnections = createPastedConnections(
        canvasId,
        undefined,
        {},
      );

      expect(createdConnections).toHaveLength(0);
    });

    it("當 connections 為空陣列時應回傳空陣列", async () => {
      const { createPastedConnections } =
        await import("../../src/handlers/paste/pasteHelpers.js");

      const createdConnections = createPastedConnections(canvasId, [], {});

      expect(createdConnections).toHaveLength(0);
    });
  });
});
