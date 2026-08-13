import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configStore } from "../../src/services/configStore.js";
import { connectionStore } from "../../src/services/connectionStore.js";
import { podStore } from "../../src/services/podStore.js";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";
import type { Connection, Pod } from "../../src/types/index.js";
import { makeTestWorkflowPod } from "../helpers/workflowSnapshotHelper.js";

const CANVAS_ID = "canvas-snapshot";

function makeConnection(
  id: string,
  sourcePodId: string,
  targetPodId: string,
): Connection {
  return {
    id,
    sourcePodId,
    sourceAnchor: "right",
    targetPodId,
    targetAnchor: "left",
    triggerMode: "auto",
    direct: false,
    summaryModel: "sonnet",
    summaryProvider: "claude",
    summaryThinkingLevel: "high",
    label: "",
    branchProvider: "claude",
    branchModel: "sonnet",
    branchThinkingLevel: "high",
  };
}

describe("RunWorkflowSnapshotStore", () => {
  const sourcePod = makeTestWorkflowPod("pod-source", {
    pluginIds: ["plugin-a"],
    mcpServerNames: ["mcp-a"],
    fastModeEnabled: true,
    memoryEnabled: true,
  });
  const targetPod = makeTestWorkflowPod("pod-target");
  const unrelatedPod = makeTestWorkflowPod("pod-unrelated");
  const reachableConnection = makeConnection(
    "connection-reachable",
    sourcePod.id,
    targetPod.id,
  );
  const unrelatedConnection = makeConnection(
    "connection-unrelated",
    unrelatedPod.id,
    "pod-other",
  );

  beforeEach(() => {
    runWorkflowSnapshotStore.clear();
    vi.spyOn(configStore, "getConnectionLineModelConfig").mockReturnValue({
      connectionLineProvider: "claude",
      connectionLineModel: "sonnet",
      connectionLineThinkingLevel: "high",
    });
    vi.spyOn(connectionStore, "list").mockReturnValue([
      reachableConnection,
      unrelatedConnection,
    ]);
    vi.spyOn(podStore, "getByIds").mockImplementation(
      (_canvasId, podIds) =>
        new Map(
          [sourcePod, targetPod, unrelatedPod]
            .filter((pod) => podIds.includes(pod.id))
            .map((pod) => [pod.id, pod]),
        ) as Map<string, Pod>,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runWorkflowSnapshotStore.clear();
  });

  it("只擷取 source 與建立當下可達的下游子圖", () => {
    const snapshot = runWorkflowSnapshotStore.create(
      "run-1",
      CANVAS_ID,
      sourcePod.id,
    );

    expect([...snapshot.pods.keys()]).toEqual([sourcePod.id, targetPod.id]);
    expect([...snapshot.connections.keys()]).toEqual([
      reachableConnection.id,
    ]);
    expect(snapshot.pods.has(unrelatedPod.id)).toBe(false);
  });

  it("深層凍結 Pod、Connection 與 Connection Line 設定", () => {
    const snapshot = runWorkflowSnapshotStore.create(
      "run-2",
      CANVAS_ID,
      sourcePod.id,
    );
    const capturedSource = snapshot.pods.get(sourcePod.id);

    sourcePod.pluginIds.push("plugin-later");
    reachableConnection.summaryModel = "opus";

    expect(capturedSource?.pluginIds).toEqual(["plugin-a"]);
    expect(snapshot.connections.get(reachableConnection.id)?.summaryModel).toBe(
      "sonnet",
    );
    expect(Object.isFrozen(capturedSource?.pluginIds)).toBe(true);
    expect(Object.isFrozen(snapshot.connectionLineConfig)).toBe(true);
    expect("set" in snapshot.pods).toBe(false);
  });

  it("缺少任一可達 Pod 時拒絕建立且不留下 snapshot", () => {
    vi.mocked(podStore.getByIds).mockReturnValueOnce(
      new Map([[sourcePod.id, sourcePod]]),
    );

    expect(() =>
      runWorkflowSnapshotStore.create("run-incomplete", CANVAS_ID, sourcePod.id),
    ).toThrow("無法建立 Workflow snapshot：找不到 Pod pod-target");
    expect(runWorkflowSnapshotStore.has("run-incomplete")).toBe(false);
  });

  it("刪除 Run execution resource 時同步移除 snapshot", () => {
    runWorkflowSnapshotStore.create("run-delete", CANVAS_ID, sourcePod.id);

    expect(runWorkflowSnapshotStore.delete("run-delete")).toBe(true);
    expect(runWorkflowSnapshotStore.get("run-delete")).toBeUndefined();
  });
});
