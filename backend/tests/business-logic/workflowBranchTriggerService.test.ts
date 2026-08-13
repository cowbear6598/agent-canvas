import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { branchDecisionService } from "../../src/services/workflow/branchDecisionService.js";
import { workflowBranchTriggerService } from "../../src/services/workflow/workflowBranchTriggerService.js";
import { workflowPipeline } from "../../src/services/workflow/workflowPipeline.js";
import { workflowMultiInputService } from "../../src/services/workflow/workflowMultiInputService.js";
import { pendingTargetStore } from "../../src/services/pendingTargetStore.js";
import { canvasStore } from "../../src/services/canvasStore.js";
import { runExecutionService } from "../../src/services/workflow/runExecutionService.js";
import { runWorkflowSnapshotStore } from "../../src/services/workflow/runWorkflowSnapshotStore.js";
import { logger } from "../../src/utils/logger.js";
import type { Connection } from "../../src/types/index.js";
import type { RunContext } from "../../src/types/run.js";
import {
  installRunWorkflowSnapshot,
  makeTestWorkflowPod,
} from "../helpers/workflowSnapshotHelper.js";

const CANVAS_ID = "canvas-branch-trigger";
const SOURCE_POD_ID = "pod-source";
const RUN_CONTEXT: RunContext = {
  runId: "run-branch-trigger",
  canvasId: CANVAS_ID,
  sourcePodId: SOURCE_POD_ID,
};

function makeConnection(
  id: string,
  targetPodId: string,
  label: string,
): Connection {
  return {
    id,
    sourcePodId: SOURCE_POD_ID,
    sourceAnchor: "right",
    targetPodId,
    targetAnchor: "left",
    triggerMode: "branch",
    direct: false,
    summaryModel: "sonnet",
    summaryProvider: "claude",
    summaryThinkingLevel: "high",
    label,
    branchProvider: "claude",
    branchModel: "sonnet",
    branchThinkingLevel: "high",
  };
}

describe("WorkflowBranchTriggerService", () => {
  const approvedConnection = makeConnection(
    "connection-approved",
    "pod-approved",
    "Approved",
  );
  const rejectedConnection = makeConnection(
    "connection-rejected",
    "pod-rejected",
    "Rejected",
  );
  const connections = [approvedConnection, rejectedConnection];

  beforeEach(() => {
    runWorkflowSnapshotStore.clear();
    installRunWorkflowSnapshot(RUN_CONTEXT, {
      pods: [
        makeTestWorkflowPod(SOURCE_POD_ID),
        makeTestWorkflowPod(approvedConnection.targetPodId),
        makeTestWorkflowPod(rejectedConnection.targetPodId),
      ],
      connections,
    });
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(canvasStore, "getNameById").mockReturnValue("Branch Canvas");
    vi.spyOn(runExecutionService, "decidingPodInstance").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "settleAndSkipPath").mockImplementation(
      () => {},
    );
    vi.spyOn(runExecutionService, "evaluateRun").mockImplementation(() => {});
    vi.spyOn(workflowPipeline, "execute").mockResolvedValue(undefined);

    workflowBranchTriggerService.init({
      branchDecisionService,
      canvasStore,
      pendingTargetStore,
      pipeline: workflowPipeline,
      multiInputService: workflowMultiInputService,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runWorkflowSnapshotStore.clear();
  });

  it("只觸發 snapshot 中選中的 branch，並結清其餘路徑", async () => {
    vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
      outcome: "selected",
      selectedConnectionId: approvedConnection.id,
      rejectedConnectionIds: [rejectedConnection.id],
    });

    await workflowBranchTriggerService.processBranchConnections(
      CANVAS_ID,
      SOURCE_POD_ID,
      connections,
      RUN_CONTEXT,
    );

    expect(runExecutionService.decidingPodInstance).toHaveBeenCalledTimes(2);
    expect(workflowPipeline.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: approvedConnection,
        runContext: RUN_CONTEXT,
      }),
      workflowBranchTriggerService,
    );
    expect(runExecutionService.settleAndSkipPath).toHaveBeenCalledWith(
      RUN_CONTEXT,
      rejectedConnection.targetPodId,
      "auto",
    );
  });

  it("決策失敗時不啟動 Pipeline，並結清全部 branch 路徑", async () => {
    vi.spyOn(branchDecisionService, "decideBranch").mockResolvedValue({
      outcome: "failed",
      selectedConnectionId: null,
      rejectedConnectionIds: connections.map((connection) => connection.id),
      failure: {
        kind: "provider_error",
        message: "模型連線失敗",
        attempts: [],
      },
    });

    await workflowBranchTriggerService.processBranchConnections(
      CANVAS_ID,
      SOURCE_POD_ID,
      connections,
      RUN_CONTEXT,
    );

    expect(workflowPipeline.execute).not.toHaveBeenCalled();
    expect(runExecutionService.settleAndSkipPath).toHaveBeenCalledTimes(2);
  });
});
