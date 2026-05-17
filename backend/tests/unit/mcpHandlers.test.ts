import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/mcp/claudeMcpReader.js", () => ({
  readClaudeMcpServers: vi.fn(() => [{ name: "user-claude-server" }]),
}));

vi.mock("../../src/services/mcp/codexMcpReader.js", () => ({
  readCodexMcpServers: vi.fn(() => [
    { name: "user-codex-server", type: "stdio" },
  ]),
}));

vi.mock("../../src/services/mcp/opencodeMcpReader.js", () => ({
  readOpencodeMcpServers: vi.fn(() => [
    { name: "user-opencode-server", type: "stdio" },
  ]),
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getByIdGlobal: vi.fn(),
    getById: vi.fn(),
    setMcpServerNames: vi.fn(),
  },
}));

vi.mock("../../src/services/runStore.js", () => ({
  runStore: {
    hasActiveRunForPod: vi.fn(() => false),
  },
}));

vi.mock("../../src/services/socketService.js", () => ({
  socketService: {
    emitToConnection: vi.fn(),
    emitToCanvas: vi.fn(),
  },
}));

import { WebSocketResponseEvents } from "../../src/schemas/index.js";
import { handleMcpList } from "../../src/handlers/mcpHandlers.js";
import { GOAL_MCP_SERVER_NAME } from "../../src/services/goalRuntime.js";
import { podStore } from "../../src/services/podStore.js";
import { socketService } from "../../src/services/socketService.js";

function makePod(
  overrides: {
    id?: string;
    name?: string;
    goal?: { todos: Array<{ id: string; text: string }> } | null;
  } = {},
) {
  return {
    id: overrides.id ?? "pod-1",
    name: overrides.name ?? "Pod 1",
    goal: overrides.goal ?? null,
  };
}

describe("handleMcpList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有 Goal 的 Pod 應回傳內建 Goal Runtime 與既有 user MCP", async () => {
    vi.mocked(podStore.getByIdGlobal).mockReturnValue({
      pod: makePod({
        id: "pod-goal",
        goal: {
          todos: [{ id: "todo-1", text: "Inspect current task state" }],
        },
      }),
    } as any);

    await handleMcpList(
      "conn-1",
      { provider: "claude", podId: "pod-goal" },
      "req-1",
    );

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      "conn-1",
      WebSocketResponseEvents.MCP_LIST_RESULT,
      expect.objectContaining({
        requestId: "req-1",
        success: true,
        provider: "claude",
        items: expect.arrayContaining([
          expect.objectContaining({
            name: GOAL_MCP_SERVER_NAME,
            system: true,
            locked: true,
            activeTodoId: "todo-1",
            activeTodoText: "Inspect current task state",
          }),
          expect.objectContaining({ name: "user-claude-server" }),
        ]),
      }),
    );
  });

  it("無 Goal 的 Pod 仍應回傳內建 Goal Runtime 與既有 user MCP", async () => {
    vi.mocked(podStore.getByIdGlobal).mockReturnValue({
      pod: makePod({ id: "pod-no-goal", goal: null }),
    } as any);

    await handleMcpList(
      "conn-1",
      { provider: "claude", podId: "pod-no-goal" },
      "req-2",
    );

    const payload = vi.mocked(socketService.emitToConnection).mock.calls[0]?.[2] as
      | {
          items?: Array<{
            name: string;
            totalCount?: number;
            activeTodoId?: string | null;
          }>;
        }
      | undefined;

    expect(payload?.items).toEqual([
      expect.objectContaining({
        name: GOAL_MCP_SERVER_NAME,
        totalCount: 0,
        activeTodoId: null,
      }),
      { name: "user-claude-server" },
    ]);
  });
});
