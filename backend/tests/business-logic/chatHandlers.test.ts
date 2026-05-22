import { vi, describe, it, expect, beforeEach } from "vitest";
import type { StreamingChatExecutorCallbacks } from "../../src/services/claude/streamingChatExecutor.js";
import type { Pod } from "../../src/types";

const CANVAS_ID = "canvas-chat-test";
const POD_ID = "pod-chat-test";
const CONNECTION_ID = "conn-chat-test";
const REQUEST_ID = "req-chat-test";

const state = vi.hoisted(() => ({
  activeCanvasId: "canvas-chat-test",
  testPods: new Map<string, Pod>(),
}));

vi.mock("../../src/services/canvasStore.js", () => ({
  canvasStore: {
    getActiveCanvas: vi.fn(() => state.activeCanvasId),
    getById: vi.fn((id: string) => ({ id, name: "test-canvas", sortIndex: 0 })),
  },
}));

vi.mock("../../src/services/podStore.js", () => ({
  podStore: {
    getById: vi.fn((canvasId: string, podId: string) => {
      const pod = state.testPods.get(podId);
      return pod && canvasId === "canvas-chat-test" ? pod : null;
    }),
    getByIds: vi.fn((canvasId: string, podIds: string[]) => {
      const pods = new Map<string, Pod>();
      if (canvasId !== "canvas-chat-test") return pods;
      for (const podId of podIds) {
        const pod = state.testPods.get(podId);
        if (pod) pods.set(podId, pod);
      }
      return pods;
    }),
    getByIdGlobal: vi.fn((podId: string) => {
      const pod = state.testPods.get(podId);
      return pod ? { canvasId: "canvas-chat-test", pod } : null;
    }),
  },
}));

vi.mock("../../src/services/claude/streamingChatExecutor.js", () => ({
  executeStreamingChat: vi.fn(
    async (_options: unknown, callbacks?: StreamingChatExecutorCallbacks) => {
      await callbacks?.onComplete?.("canvas-chat-test", "pod-chat-test");
      return {
        messageId: "assistant-message",
        content: "assistant response",
        hasContent: true,
        aborted: false,
      };
    },
  ),
}));

vi.mock("../../src/utils/websocketResponse.js", () => ({
  emitError: vi.fn(),
  emitSuccess: vi.fn(),
  emitNotFound: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { handleChatSend } from "../../src/handlers/chatHandlers.js";
import { initTestDb, getDb } from "../../src/database/index.js";
import { runStore } from "../../src/services/runStore.js";
import { emitError } from "../../src/utils/websocketResponse.js";

function createPod(overrides: Partial<Pod> = {}): Pod {
  return {
    id: POD_ID,
    name: "TestPod",
    status: "idle",
    workspacePath: "/tmp/chat-handler-test",
    x: 0,
    y: 0,
    rotation: 0,
    sessionId: null,
    skillIds: [],
    mcpServerNames: [],
    provider: "claude",
    providerConfig: { model: "sonnet" },
    repositoryId: null,
    integrationBindings: [],
    ...overrides,
  } as Pod;
}

async function sendChat(message: string, podId = POD_ID): Promise<void> {
  await handleChatSend(
    CONNECTION_ID,
    {
      podId,
      message,
      requestId: REQUEST_ID,
      canvasId: CANVAS_ID,
    },
    REQUEST_ID,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  initTestDb();
  // 滿足 workflow_runs.canvas_id FK 約束
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "test-canvas", 0);
  state.activeCanvasId = CANVAS_ID;
  state.testPods.clear();
  state.testPods.set(POD_ID, createPod());
});

describe("handleChatSend chat flow business logic", () => {
  it("plain message creates a run, writes the user message, and completes the source pod", async () => {
    await sendChat("Hello World");

    const runs = runStore.getRunsByCanvasId(CANVAS_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(
      expect.objectContaining({
        canvasId: CANVAS_ID,
        sourcePodId: POD_ID,
        triggerMessage: "Hello World",
        status: "completed",
      }),
    );

    const instance = runStore.getPodInstance(runs[0].id, POD_ID);
    expect(instance).toEqual(
      expect.objectContaining({
        podId: POD_ID,
        status: "completed",
        autoPathwaySettled: "settled",
        directPathwaySettled: "not-applicable",
      }),
    );

    expect(runStore.getRunMessages(runs[0].id, POD_ID)).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Hello World",
      }),
    ]);
  });

  it("consecutive chat sends create independent completed runs instead of blocking on pod busy state", async () => {
    await sendChat("first message");
    await sendChat("second message");

    const runs = runStore.getRunsByCanvasId(CANVAS_ID);
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.triggerMessage)).toEqual(
      expect.arrayContaining(["first message", "second message"]),
    );
    expect(new Set(runs.map((run) => run.id)).size).toBe(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
  });

  it("business rule: integration-bound error classification rejects chat and does not create a run", async () => {
    state.testPods.set(
      POD_ID,
      createPod({
        integrationBindings: [
          {
            provider: "slack",
            appId: "slack-app",
            resourceId: "C123",
          },
        ],
      }),
    );

    await sendChat("should not run");

    expect(runStore.getRunsByCanvasId(CANVAS_ID)).toHaveLength(0);
    expect(emitError).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.any(String),
      expect.objectContaining({ key: "errors.podIntegrationBound" }),
      CANVAS_ID,
      REQUEST_ID,
      POD_ID,
      "INTEGRATION_BOUND",
    );
  });
});
