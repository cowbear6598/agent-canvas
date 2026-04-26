import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mock 函式 ---
const mockCanvasGetById = vi.fn();
const mockCanvasGetByName = vi.fn();
const mockPodStoreHasName = vi.fn();
const mockCreatePodWithWorkspace = vi.fn();

// --- vi.mock ---

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getById: (...args: unknown[]) => mockCanvasGetById(...args),
    getByName: (...args: unknown[]) => mockCanvasGetByName(...args),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    list: vi.fn().mockReturnValue([]),
    hasName: (...args: unknown[]) => mockPodStoreHasName(...args),
  },
}));

vi.mock("../../src/services/podService.js", () => ({
  createPodWithWorkspace: (...args: unknown[]) =>
    mockCreatePodWithWorkspace(...args),
  deletePodWithCleanup: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToCanvas: vi.fn(),
    emitToAll: vi.fn(),
  },
}));

vi.mock("../../src/schemas/index.js", () => ({
  WebSocketResponseEvents: {
    POD_CREATED: "pod:created",
  },
}));

const { handleCreatePod } = await import("../../src/api/podApi.js");

// 模擬 Canvas 物件
const CANVAS_ID = "canvas-uuid-1";
const mockCanvas = { id: CANVAS_ID, name: "test-canvas" };

// 模擬成功建立的 Pod 物件
function makePodResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "pod-uuid-1",
    name: "Test Pod",
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "opus" },
    status: "idle",
    workspacePath: "/tmp/workspace",
    skillIds: [],

    mcpServerIds: [],
    multiInstance: false,
    ...overrides,
  };
}

// 建立測試用 Request
function makeRequest(body: unknown, contentType = "application/json"): Request {
  return new Request(`http://localhost/api/canvases/${CANVAS_ID}/pods`, {
    method: "POST",
    headers: { "Content-Type": contentType, "Content-Length": "1" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 預設 canvas 存在
  mockCanvasGetById.mockReturnValue(mockCanvas);
  mockCanvasGetByName.mockReturnValue(mockCanvas);
  // 預設 pod 名稱未重複
  mockPodStoreHasName.mockReturnValue(false);
});

describe("POST /api/canvases/:id/pods — provider 支援測試", () => {
  // ================================================================
  // Case 1：建立 Codex Pod
  // ================================================================
  it("帶 provider: codex 與 providerConfig.model 時應成功建立，回傳的 Pod provider === 'codex'", async () => {
    const expectedPod = makePodResult({
      provider: "codex",
      providerConfig: { model: "gpt-5.4" },
    });
    mockCreatePodWithWorkspace.mockResolvedValue({
      success: true,
      data: { pod: expectedPod },
    });

    const req = makeRequest({
      name: "Codex Pod",
      x: 0,
      y: 0,
      provider: "codex",
      providerConfig: { model: "gpt-5.4" },
    });

    const response = await handleCreatePod(req, { id: CANVAS_ID });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.pod).toBeDefined();
    expect(body.pod.provider).toBe("codex");

    // 確認 createPodWithWorkspace 被以正確的 provider 與 providerConfig 呼叫
    expect(mockCreatePodWithWorkspace).toHaveBeenCalledWith(
      CANVAS_ID,
      expect.objectContaining({
        provider: "codex",
        providerConfig: { model: "gpt-5.4" },
      }),
      "system",
    );
  });

  // ================================================================
  // Case 2：建立 Claude Pod 不帶 provider 欄位 → 預設為 'claude'
  // ================================================================
  it("不帶 provider 欄位時應成功建立，createPodWithWorkspace 接收到 provider === undefined（由下游賦予預設值）", async () => {
    const expectedPod = makePodResult({ provider: "claude" });
    mockCreatePodWithWorkspace.mockResolvedValue({
      success: true,
      data: { pod: expectedPod },
    });

    const req = makeRequest({ name: "Claude Pod", x: 10, y: 20 });

    const response = await handleCreatePod(req, { id: CANVAS_ID });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.pod).toBeDefined();

    // provider 未傳入時應為 undefined，由 createPodWithWorkspace 決定預設值
    const callArg = mockCreatePodWithWorkspace.mock.calls[0][1];
    expect(callArg.provider).toBeUndefined();
  });

  // ================================================================
  // Case 3：provider 值非法 → 回 400 validation error
  // ================================================================
  it("provider 值不在 enum 時應回 400 且含 validation error", async () => {
    const req = makeRequest({
      name: "Invalid Provider Pod",
      x: 0,
      y: 0,
      provider: "gpt-claude",
    });

    const response = await handleCreatePod(req, { id: CANVAS_ID });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/無效的 provider/);
    // createPodWithWorkspace 不應被呼叫
    expect(mockCreatePodWithWorkspace).not.toHaveBeenCalled();
  });

  // ================================================================
  // Case 4：providerConfig 含非白名單 key → 回 400 validation error
  // ================================================================
  it("providerConfig 含非白名單 key 時應回 400 且含 validation error", async () => {
    const req = makeRequest({
      name: "Bad Config Pod",
      x: 0,
      y: 0,
      providerConfig: { model: "opus", dangerousKey: "x" },
    });

    const response = await handleCreatePod(req, { id: CANVAS_ID });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/providerConfig 含有不允許的欄位/);
    expect(body.error).toMatch(/dangerousKey/);
    // createPodWithWorkspace 不應被呼叫
    expect(mockCreatePodWithWorkspace).not.toHaveBeenCalled();
  });
});
