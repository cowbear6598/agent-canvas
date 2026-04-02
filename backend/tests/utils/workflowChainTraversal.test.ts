import type { Mock } from "vitest";

vi.mock("../../src/services/connectionStore.js", () => ({
  connectionStore: {
    findBySourcePodId: vi.fn(() => []),
    findByTargetPodId: vi.fn(() => []),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getById: vi.fn(() => undefined),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import {
  traverseWorkflowChain,
  isWorkflowChainBusy,
} from "../../src/utils/workflowChainTraversal.js";

const mockFindBySourcePodId = connectionStore.findBySourcePodId as Mock;
const mockFindByTargetPodId = connectionStore.findByTargetPodId as Mock;
const mockGetById = podStore.getById as Mock;

// 建立連線資料輔助函式
function makeDownstream(sourcePodId: string, targetPodId: string) {
  return { sourcePodId, targetPodId };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 預設回傳空陣列
  mockFindBySourcePodId.mockReturnValue([]);
  mockFindByTargetPodId.mockReturnValue([]);
  mockGetById.mockReturnValue(undefined);
});

describe("traverseWorkflowChain", () => {
  it("BFS 正確遍歷直接下游節點：A→B→C，從 A 出發，predicate 匹配 C，應回傳 true", () => {
    const canvasId = "canvas-1";

    // A 的下游是 B，無上游
    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      if (podId === "B") return [makeDownstream("B", "C")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    // predicate 匹配 C
    const result = traverseWorkflowChain(
      "Workflow",
      canvasId,
      "A",
      (id) => id === "C",
    );
    expect(result).toBe(true);
  });

  it("BFS 正確遍歷：predicate 不匹配任何節點時應回傳 false", () => {
    const canvasId = "canvas-1";

    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    const result = traverseWorkflowChain(
      "Workflow",
      canvasId,
      "A",
      (id) => id === "Z",
    );
    expect(result).toBe(false);
  });

  it("環狀拓撲不會無限迴圈：A→B→A，函式應正常回傳", () => {
    const canvasId = "canvas-1";

    // A 下游 B，B 下游 A（形成環）
    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      if (podId === "B") return [makeDownstream("B", "A")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    // 不應該無限迴圈，應正常回傳
    expect(() => {
      traverseWorkflowChain("Workflow", canvasId, "A", () => false);
    }).not.toThrow();
  });

  it("BFS 正確遍歷上游節點：A→B→C，從 C 出發，predicate 匹配 A（上游），應回傳 true", () => {
    const canvasId = "canvas-1";

    // C 的上游是 B，B 的上游是 A
    mockFindBySourcePodId.mockReturnValue([]);
    mockFindByTargetPodId.mockImplementation((cid, podId) => {
      if (podId === "C") return [makeDownstream("B", "C")];
      if (podId === "B") return [makeDownstream("A", "B")];
      return [];
    });

    // predicate 匹配上游的 A
    const result = traverseWorkflowChain(
      "Workflow",
      canvasId,
      "C",
      (id) => id === "A",
    );
    expect(result).toBe(true);
  });

  it("雙向遍歷都匹配：A→B→C→D，從 B 出發，predicate 匹配 A（上游）或 D（下游），兩者都應回傳 true", () => {
    const canvasId = "canvas-1";

    // 下游：B→C→D
    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "B") return [makeDownstream("B", "C")];
      if (podId === "C") return [makeDownstream("C", "D")];
      return [];
    });
    // 上游：B←A
    mockFindByTargetPodId.mockImplementation((cid, podId) => {
      if (podId === "B") return [makeDownstream("A", "B")];
      return [];
    });

    // predicate 匹配上游 A
    const resultUpstream = traverseWorkflowChain(
      "Workflow",
      canvasId,
      "B",
      (id) => id === "A",
    );
    expect(resultUpstream).toBe(true);

    // predicate 匹配下游 D
    const resultDownstream = traverseWorkflowChain(
      "Workflow",
      canvasId,
      "B",
      (id) => id === "D",
    );
    expect(resultDownstream).toBe(true);
  });

  it("超過 50 個節點時停止並回傳 false：51 個節點的線性鏈應回傳 false", () => {
    const canvasId = "canvas-1";
    const nodeCount = 51;

    // 建立 node-0 → node-1 → ... → node-50 的線性鏈
    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      const match = podId.match(/^node-(\d+)$/);
      if (!match) return [];
      const idx = parseInt(match[1], 10);
      if (idx < nodeCount - 1) {
        return [makeDownstream(podId, `node-${idx + 1}`)];
      }
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    // predicate 永遠不匹配，期望因超過 50 個節點而回傳 false
    const result = traverseWorkflowChain(
      "Workflow",
      canvasId,
      "node-0",
      () => false,
    );
    expect(result).toBe(false);
  });
});

describe("isWorkflowChainBusy", () => {
  it("鏈中存在 status 為 chatting 的 Pod 時應回傳 true", () => {
    const canvasId = "canvas-1";

    // A 下游 B
    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    // B 的狀態為 chatting
    mockGetById.mockImplementation((cid, podId) => {
      if (podId === "B") return { id: "B", status: "chatting" };
      return undefined;
    });

    const result = isWorkflowChainBusy(canvasId, "A");
    expect(result).toBe(true);
  });

  it("鏈中存在 status 為 summarizing 的 Pod 時應回傳 true", () => {
    const canvasId = "canvas-1";

    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    mockGetById.mockImplementation((cid, podId) => {
      if (podId === "B") return { id: "B", status: "summarizing" };
      return undefined;
    });

    const result = isWorkflowChainBusy(canvasId, "A");
    expect(result).toBe(true);
  });

  it("所有 Pod 為 idle 時 isWorkflowChainBusy 應回傳 false", () => {
    const canvasId = "canvas-1";

    // A 下游 B
    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    // B 的狀態為 idle
    mockGetById.mockImplementation((cid, podId) => {
      if (podId === "B") return { id: "B", status: "idle" };
      return undefined;
    });

    const result = isWorkflowChainBusy(canvasId, "A");
    expect(result).toBe(false);
  });

  it("鏈中 Pod 不存在時 isWorkflowChainBusy 應回傳 false", () => {
    const canvasId = "canvas-1";

    mockFindBySourcePodId.mockImplementation((cid, podId) => {
      if (podId === "A") return [makeDownstream("A", "B")];
      return [];
    });
    mockFindByTargetPodId.mockReturnValue([]);

    // getById 回傳 undefined（Pod 不存在）
    mockGetById.mockReturnValue(undefined);

    const result = isWorkflowChainBusy(canvasId, "A");
    expect(result).toBe(false);
  });
});
