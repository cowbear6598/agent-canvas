import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupIntegrationTest } from "../setup";
import {
  waitForEvent,
  type TestWebSocketClient,
} from "../setup/socketClient.js";
import { postCanvas, postPod } from "../helpers";
import { createEventCollector, type EventCollector } from "../helpers";
import { createProviderFakeHarness } from "../helpers/providerFakeHarness.js";
import { AGENT_CANVAS_TEST_ROOT } from "../setup/testConfig.js";
import {
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "../../src/schemas/events.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { providerRegistry } from "../../src/services/provider/index.js";
import { runStore } from "../../src/services/runStore.js";
import type { Connection } from "../../src/types/index.js";
import type { WorkflowRun } from "../../src/services/runStore.js";
import type { ProviderName } from "../../src/services/provider/index.js";

vi.mock("../../src/services/disposableChatService.js", () => ({
  executeDisposableChat: vi.fn(async (input: { userMessage: string }) => {
    if (input.userMessage.includes("Ship")) {
      return {
        success: true,
        content: JSON.stringify({ selectedLabel: "Ship" }),
        resolvedModel: "sonnet",
      };
    }
    return {
      success: true,
      content: "summary from fake disposable chat",
      resolvedModel: "sonnet",
    };
  }),
}));

interface CreatedCanvas {
  id: string;
  name: string;
}

interface CreatedPod {
  id: string;
  name: string;
  workspacePath: string;
}

interface ConnectionResponse {
  connection: Connection;
}

const originalClaudeProvider = providerRegistry.claude;

async function createCanvas(
  baseUrl: string,
  name: string,
): Promise<CreatedCanvas> {
  const response = await postCanvas(baseUrl, { name });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { canvas: CreatedCanvas };
  return body.canvas;
}

async function createPod(
  baseUrl: string,
  canvasId: string,
  name: string,
  x: number,
): Promise<CreatedPod> {
  const response = await postPod(baseUrl, canvasId, { name, x, y: 0 });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { pod: CreatedPod };
  return body.pod;
}

async function createConnection(
  baseUrl: string,
  canvasId: string,
  sourcePodId: string,
  targetPodId: string,
): Promise<Connection> {
  const response = await fetch(`${baseUrl}/api/canvas/${canvasId}/connections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourcePodId,
      targetPodId,
      sourceAnchor: "right",
      targetAnchor: "left",
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as ConnectionResponse;
  return body.connection;
}

async function patchConnectionTriggerMode(
  baseUrl: string,
  canvasId: string,
  connectionId: string,
  triggerMode: "auto" | "branch" | "direct",
): Promise<Connection> {
  const response = await fetch(
    `${baseUrl}/api/canvas/${canvasId}/connections/${connectionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerMode }),
    },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as ConnectionResponse;
  return body.connection;
}

async function postWorkflowChat(
  baseUrl: string,
  canvasId: string,
  podId: string,
  message: string,
): Promise<Response> {
  return fetch(
    `${baseUrl}/api/canvas/${canvasId}/workflows/${encodeURIComponent(podId)}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
}

async function switchCanvas(
  client: TestWebSocketClient,
  canvasId: string,
): Promise<void> {
  const switched = waitForEvent<{ success: boolean; canvasId?: string }>(
    client,
    WebSocketResponseEvents.CANVAS_SWITCHED,
  );
  client.emit(WebSocketRequestEvents.CANVAS_SWITCH, {
    requestId: randomUUID(),
    canvasId,
  });
  const payload = await switched;
  expect(payload.success).toBe(true);
  expect(payload.canvasId).toBe(canvasId);
}

async function waitForRunFinished(
  collector: EventCollector,
): Promise<{ runId: string; status: string }> {
  const event = await collector.waitFor<{
    runId: string;
    status: string;
  }>(WebSocketResponseEvents.RUN_STATUS_CHANGED, {
    timeout: 5000,
    predicate: (payload) =>
      payload.status === "completed" || payload.status === "error",
  });
  return event.payload;
}

function expectRunDataWritten(run: WorkflowRun, podIds: string[]): void {
  expect(run.status).toBe("completed");
  for (const podId of podIds) {
    const instance = runStore.getPodInstance(run.id, podId);
    expect(instance).toBeDefined();

    if (typeof instance?.workspacePath === "string") {
      expect(instance.workspacePath).toContain(AGENT_CANVAS_TEST_ROOT);
      expect(instance.workspacePath).toContain("/canvas/");
      expect(instance.workspacePath).not.toContain("/var/folders/");
      expect(existsSync(instance.workspacePath)).toBe(true);
    }
  }
}

describe("Workflow REST API flow", () => {
  const { getServer, getClient } = setupIntegrationTest();
  let collector: EventCollector;

  beforeEach(() => {
    const fakeClaude = createProviderFakeHarness({
      provider: "claude",
      scenario: "success",
      chunks: ["fake assistant response"],
    });
    (providerRegistry as unknown as Record<ProviderName, unknown>).claude =
      fakeClaude.provider;

    collector = createEventCollector(getClient(), [
      WebSocketResponseEvents.RUN_CREATED,
      WebSocketResponseEvents.RUN_STATUS_CHANGED,
      WebSocketResponseEvents.RUN_POD_STATUS_CHANGED,
      WebSocketResponseEvents.RUN_MESSAGE,
    ]);
  });

  afterEach(() => {
    (providerRegistry as unknown as Record<ProviderName, unknown>).claude =
      originalClaudeProvider;
    collector.stop();
  });

  it("direct trigger: manual workflow chat creates a run, transfers the source response, and writes run data", async () => {
    const server = getServer();
    const canvas = await createCanvas(server.baseUrl, "workflow-direct-flow");
    await switchCanvas(getClient(), canvas.id);
    const entry = await createPod(server.baseUrl, canvas.id, "Direct Entry", 0);
    const target = await createPod(
      server.baseUrl,
      canvas.id,
      "Direct Target",
      120,
    );

    const connection = await createConnection(
      server.baseUrl,
      canvas.id,
      entry.id,
      target.id,
    );
    await patchConnectionTriggerMode(
      server.baseUrl,
      canvas.id,
      connection.id,
      "direct",
    );

    const response = await postWorkflowChat(
      server.baseUrl,
      canvas.id,
      entry.id,
      "start direct workflow",
    );
    expect(response.status).toBe(202);

    const finished = await waitForRunFinished(collector);
    const run = runStore.getRun(finished.runId);
    expect(run).toBeDefined();
    expect(run?.sourcePodId).toBe(entry.id);
    expectRunDataWritten(run!, [entry.id, target.id]);

    const targetMessages = runStore.getRunMessages(run!.id, target.id);
    expect(targetMessages.some((message) => message.role === "user")).toBe(
      true,
    );
    expect(targetMessages.some((message) => message.role === "assistant")).toBe(
      true,
    );
  });

  it("branch trigger: API-started run uses branch decision and only executes the selected branch target", async () => {
    const server = getServer();
    const canvas = await createCanvas(server.baseUrl, "workflow-branch-flow");
    await switchCanvas(getClient(), canvas.id);
    const entry = await createPod(server.baseUrl, canvas.id, "Branch Entry", 0);
    const ship = await createPod(server.baseUrl, canvas.id, "Ship Target", 120);
    const hold = await createPod(server.baseUrl, canvas.id, "Hold Target", 240);

    const shipConnection = await createConnection(
      server.baseUrl,
      canvas.id,
      entry.id,
      ship.id,
    );
    const holdConnection = await createConnection(
      server.baseUrl,
      canvas.id,
      entry.id,
      hold.id,
    );
    connectionStore.update(canvas.id, shipConnection.id, {
      triggerMode: "branch",
      label: "Ship",
      description: "Continue when the source response is shippable.",
    });
    connectionStore.update(canvas.id, holdConnection.id, {
      triggerMode: "branch",
      label: "Hold",
      description: "Do not continue yet.",
    });

    const response = await postWorkflowChat(
      server.baseUrl,
      canvas.id,
      entry.id,
      "choose branch workflow",
    );
    expect(response.status).toBe(202);

    const finished = await waitForRunFinished(collector);
    const run = runStore.getRun(finished.runId);
    expect(run).toBeDefined();
    expectRunDataWritten(run!, [entry.id, ship.id]);

    const shipInstance = runStore.getPodInstance(run!.id, ship.id);
    const holdInstance = runStore.getPodInstance(run!.id, hold.id);
    const branchInstances = [shipInstance, holdInstance];
    expect(
      branchInstances.filter((instance) => instance?.status === "completed"),
    ).toHaveLength(1);
    expect(
      branchInstances.filter((instance) => instance?.status === "skipped"),
    ).toHaveLength(1);

    const completedBranch = branchInstances.find(
      (instance) => instance?.status === "completed",
    );
    const skippedBranch = branchInstances.find(
      (instance) => instance?.status === "skipped",
    );
    expect(
      runStore.getRunMessages(run!.id, completedBranch!.podId).length,
    ).toBeGreaterThan(0);
    expect(runStore.getRunMessages(run!.id, skippedBranch!.podId)).toHaveLength(
      0,
    );
  });

  it("auto trigger: API-started run automatically executes downstream pods and records the workflow in DB", async () => {
    const server = getServer();
    const canvas = await createCanvas(server.baseUrl, "workflow-auto-flow");
    await switchCanvas(getClient(), canvas.id);
    const entry = await createPod(server.baseUrl, canvas.id, "Auto Entry", 0);
    const middle = await createPod(
      server.baseUrl,
      canvas.id,
      "Auto Middle",
      120,
    );
    const leaf = await createPod(server.baseUrl, canvas.id, "Auto Leaf", 240);

    await createConnection(server.baseUrl, canvas.id, entry.id, middle.id);
    await createConnection(server.baseUrl, canvas.id, middle.id, leaf.id);

    const response = await postWorkflowChat(
      server.baseUrl,
      canvas.id,
      entry.id,
      "start auto workflow",
    );
    expect(response.status).toBe(202);

    const finished = await waitForRunFinished(collector);
    const run = runStore.getRun(finished.runId);
    expect(run).toBeDefined();
    expectRunDataWritten(run!, [entry.id, middle.id, leaf.id]);

    const instances = runStore.getPodInstancesByRunId(run!.id);
    expect(instances).toHaveLength(3);
    expect(instances.every((instance) => instance.status === "completed")).toBe(
      true,
    );
  });
});
