/**
 * Gemini Pod Bind / Unbind 整合測試
 *
 * 驗證 GEMINI_CAPABILITIES.command / repository 開啟後，
 * bind / unbind 流程不會被 capability 閘門擋下。
 *
 * Mock 邊界：
 *   - commandService.read / commandService.exists（避免真實磁碟 I/O）
 *   - repositoryService.exists（避免真實目錄存在性檢查）
 *   - repositorySyncService.syncRepositoryResources（避免實際 git 操作）
 *   - podManifestService.deleteManagedFiles（避免實際檔案操作）
 *   - commandService.deleteCommandFromPath（避免磁碟操作）
 *   - socketService（WebSocket boundary）
 *   - logger
 *
 * 不可 mock：
 *   - assertCapability（本次行為驗證核心）
 *   - createBindHandler / createUnbindHandler 工廠（本次行為驗證核心）
 *   - podStore（使用真實 initTestDb，驗證欄位寫入正確性）
 *   - getProvider（使用真實 providerRegistry 驗證 Gemini capabilities）
 */

// ─── hoisted mocks（必須在所有 import 前宣告）─────────────────────────────────

const { mockEmitToCanvas, mockEmitToConnection, mockEmitError } = vi.hoisted(
  () => ({
    mockEmitToCanvas: vi.fn(),
    mockEmitToConnection: vi.fn(),
    mockEmitError: vi.fn(),
  }),
);

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: mockEmitToCanvas,
    emitToConnection: mockEmitToConnection,
    emitToAll: vi.fn(),
  },
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: mockEmitError,
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

// commandService.exists：mock 讓它回傳 true（Command 存在），避免磁碟 I/O
// commandService.read：mock 避免實際讀取 markdown 檔案
// commandService.deleteCommandFromPath：mock 避免磁碟操作
vi.mock("../../src/services/commandService.js", () => ({
  commandService: {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue("# mock command content"),
    deleteCommandFromPath: vi.fn().mockResolvedValue(undefined),
  },
}));

// repositoryService.exists：mock 讓它回傳 true（Repository 存在）
// repositoryService.getRepositoryPath：回傳合理路徑供後續邏輯使用
vi.mock("../../src/services/repositoryService.js", () => ({
  repositoryService: {
    exists: vi.fn().mockResolvedValue(true),
    getRepositoryPath: vi.fn((id: string) => `/test-repos/${id}`),
    getMetadata: vi.fn().mockReturnValue(undefined),
  },
}));

// repositorySyncService：避免真實 git 操作
vi.mock("../../src/services/repositorySyncService.js", () => ({
  repositorySyncService: {
    syncRepositoryResources: vi.fn().mockResolvedValue(undefined),
  },
}));

// podManifestService：避免真實檔案操作
vi.mock("../../src/services/podManifestService.js", () => ({
  podManifestService: {
    deleteManagedFiles: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── imports ──────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initTestDb, closeDb, getDb } from "../../src/database/index.js";
import {
  resetStatements,
  getStatements,
} from "../../src/database/statements.js";
import { podStore } from "../../src/services/podStore.js";
import {
  handlePodBindCommand,
  handlePodUnbindCommand,
} from "../../src/handlers/commandHandlers.js";
import {
  handlePodBindRepository,
  handlePodUnbindRepository,
} from "../../src/handlers/repositoryHandlers.js";

// ─── 常數 ─────────────────────────────────────────────────────────────────────

const CANVAS_ID = "canvas-gemini-bind-test";
const CONNECTION_ID = "conn-gemini-bind-test";
const REQUEST_ID = "req-gemini-bind-test";
const COMMAND_ID = "cmd-test-001";
const REPOSITORY_ID = "repo-test-001";

// ─── 工具函式 ─────────────────────────────────────────────────────────────────

function clearPodStoreCache(): void {
  type PodStoreTestHooks = { stmtCache: Map<string, unknown> };
  (podStore as unknown as PodStoreTestHooks).stmtCache.clear();
}

function setupTestCanvas(): void {
  const stmts = getStatements(getDb());
  stmts.canvas.insert.run({
    $id: CANVAS_ID,
    $name: "Gemini Bind Test Canvas",
    $sortIndex: 0,
  });
}

/**
 * 建立指定 provider 的 Pod，回傳 podId。
 * 使用 podStore.create 真實寫入 DB，確保 validatePod / assertCapability 走真實路徑。
 */
function createTestPod(provider: "gemini" | "claude", name: string): string {
  const modelMap = {
    gemini: "gemini-2.5-pro",
    claude: "sonnet",
  };

  const { pod } = podStore.create(CANVAS_ID, {
    name,
    x: 0,
    y: 0,
    rotation: 0,
    provider,
    providerConfig: { model: modelMap[provider] },
  });

  return pod.id;
}

/**
 * canvasStore.getActiveCanvas 需要 mock，讓 withCanvasId 能取得 CANVAS_ID。
 * 注意：canvasStore 在 handlerHelpers 中以靜態 import 使用，需在測試中覆蓋 mock。
 */
vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => CANVAS_ID),
    getCanvasDir: vi.fn(() => "/test-canvas-dir"),
    getById: vi.fn((id: string) => ({
      id,
      name: "test-canvas",
      sortIndex: 0,
    })),
    list: vi.fn(() => [{ id: CANVAS_ID, name: "test-canvas", sortIndex: 0 }]),
  },
}));

// ─── 測試 setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  initTestDb();
  resetStatements();
  clearPodStoreCache();
  setupTestCanvas();
  vi.clearAllMocks();
});

afterEach(() => {
  closeDb();
});

// ─── Gemini Pod：Command bind / unbind ────────────────────────────────────────

describe("Gemini Pod — Command 綁定與解綁", () => {
  it("bind_command：Gemini Pod 綁定 Command 後，podStore.commandId 寫入正確且不 emit CAPABILITY_NOT_SUPPORTED", async () => {
    const podId = createTestPod("gemini", "gemini-cmd-bind");

    await handlePodBindCommand(
      CONNECTION_ID,
      { podId, commandId: COMMAND_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    // 不應有任何 CAPABILITY_NOT_SUPPORTED 錯誤
    const capabilityErrorCalls = mockEmitError.mock.calls.filter(
      (call) => call[6] === "CAPABILITY_NOT_SUPPORTED",
    );
    expect(capabilityErrorCalls).toHaveLength(0);

    // podStore 的 commandId 應已寫入
    const updatedPod = podStore.getById(CANVAS_ID, podId);
    expect(updatedPod?.commandId).toBe(COMMAND_ID);
  });

  it("unbind_command：Gemini Pod 解綁 Command 後，podStore.commandId 清為 null", async () => {
    const podId = createTestPod("gemini", "gemini-cmd-unbind");

    // 先綁定
    await handlePodBindCommand(
      CONNECTION_ID,
      { podId, commandId: COMMAND_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    // 確認已綁定
    expect(podStore.getById(CANVAS_ID, podId)?.commandId).toBe(COMMAND_ID);

    vi.clearAllMocks();

    // 解綁
    await handlePodUnbindCommand(
      CONNECTION_ID,
      { podId, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    // commandId 應已清除
    const updatedPod = podStore.getById(CANVAS_ID, podId);
    expect(updatedPod?.commandId).toBeNull();
  });
});

// ─── Gemini Pod：Repository bind / unbind ─────────────────────────────────────

describe("Gemini Pod — Repository 綁定與解綁", () => {
  it("bind_repository：Gemini Pod 綁定 Repository 後，podStore.repositoryId 寫入正確且不 emit CAPABILITY_NOT_SUPPORTED", async () => {
    const podId = createTestPod("gemini", "gemini-repo-bind");

    await handlePodBindRepository(
      CONNECTION_ID,
      { podId, repositoryId: REPOSITORY_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    // 不應有任何 CAPABILITY_NOT_SUPPORTED 錯誤
    const capabilityErrorCalls = mockEmitError.mock.calls.filter(
      (call) => call[6] === "CAPABILITY_NOT_SUPPORTED",
    );
    expect(capabilityErrorCalls).toHaveLength(0);

    // podStore 的 repositoryId 應已寫入
    const updatedPod = podStore.getById(CANVAS_ID, podId);
    expect(updatedPod?.repositoryId).toBe(REPOSITORY_ID);
  });

  it("unbind_repository：Gemini Pod 解綁 Repository 後，podStore.repositoryId 清為 null", async () => {
    const podId = createTestPod("gemini", "gemini-repo-unbind");

    // 先綁定
    await handlePodBindRepository(
      CONNECTION_ID,
      { podId, repositoryId: REPOSITORY_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(podStore.getById(CANVAS_ID, podId)?.repositoryId).toBe(
      REPOSITORY_ID,
    );

    vi.clearAllMocks();

    // 解綁
    await handlePodUnbindRepository(
      CONNECTION_ID,
      { podId, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const updatedPod = podStore.getById(CANVAS_ID, podId);
    expect(updatedPod?.repositoryId).toBeNull();
  });
});

// ─── Claude Pod 迴歸測試（regression） ────────────────────────────────────────

describe("Claude Pod 迴歸 — Command / Repository bind / unbind 不受 Gemini 變更影響", () => {
  it("bind_command：Claude Pod 綁定 Command 仍正常通過，commandId 寫入正確", async () => {
    const podId = createTestPod("claude", "claude-cmd-bind-regression");

    await handlePodBindCommand(
      CONNECTION_ID,
      { podId, commandId: COMMAND_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const capabilityErrorCalls = mockEmitError.mock.calls.filter(
      (call) => call[6] === "CAPABILITY_NOT_SUPPORTED",
    );
    expect(capabilityErrorCalls).toHaveLength(0);

    const updatedPod = podStore.getById(CANVAS_ID, podId);
    expect(updatedPod?.commandId).toBe(COMMAND_ID);
  });

  it("unbind_command：Claude Pod 解綁 Command 後 commandId 清為 null", async () => {
    const podId = createTestPod("claude", "claude-cmd-unbind-regression");

    await handlePodBindCommand(
      CONNECTION_ID,
      { podId, commandId: COMMAND_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    vi.clearAllMocks();

    await handlePodUnbindCommand(
      CONNECTION_ID,
      { podId, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(podStore.getById(CANVAS_ID, podId)?.commandId).toBeNull();
  });

  it("bind_repository：Claude Pod 綁定 Repository 仍正常通過，repositoryId 寫入正確", async () => {
    const podId = createTestPod("claude", "claude-repo-bind-regression");

    await handlePodBindRepository(
      CONNECTION_ID,
      { podId, repositoryId: REPOSITORY_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    const capabilityErrorCalls = mockEmitError.mock.calls.filter(
      (call) => call[6] === "CAPABILITY_NOT_SUPPORTED",
    );
    expect(capabilityErrorCalls).toHaveLength(0);

    expect(podStore.getById(CANVAS_ID, podId)?.repositoryId).toBe(
      REPOSITORY_ID,
    );
  });

  it("unbind_repository：Claude Pod 解綁 Repository 後 repositoryId 清為 null", async () => {
    const podId = createTestPod("claude", "claude-repo-unbind-regression");

    await handlePodBindRepository(
      CONNECTION_ID,
      { podId, repositoryId: REPOSITORY_ID, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    vi.clearAllMocks();

    await handlePodUnbindRepository(
      CONNECTION_ID,
      { podId, requestId: REQUEST_ID },
      REQUEST_ID,
    );

    expect(podStore.getById(CANVAS_ID, podId)?.repositoryId).toBeNull();
  });
});
