import { beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb, initTestDb } from "../../src/database/index.js";
import { resetStatements } from "../../src/database/statements.js";
import { memoryCleanupService } from "../../src/services/memoryCleanupService.js";
import { memoryStateService } from "../../src/services/memoryStateService.js";

const CANVAS_ID = "memory-cleanup-canvas";
const POD_ID = "memory-cleanup-pod";
const REPOSITORY_ID = "memory-cleanup-repo";

function insertCanvas(): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO canvases (id, name, sort_index) VALUES (?, ?, ?)",
    )
    .run(CANVAS_ID, "memory-cleanup-canvas", 0);
}

function insertPod(): void {
  getDb()
    .prepare(
      `INSERT INTO pods (
        id, canvas_id, name, x, y, rotation, workspace_path, session_id,
        repository_id, schedule_json, provider, provider_config_json
      ) VALUES (?, ?, ?, 0, 0, 0, ?, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      POD_ID,
      CANVAS_ID,
      "Memory Cleanup Pod",
      `/tmp/${POD_ID}`,
      REPOSITORY_ID,
      "claude",
      JSON.stringify({ model: "sonnet" }),
    );
}

describe("memoryCleanupService", () => {
  beforeEach(() => {
    closeDb();
    resetStatements();
    initTestDb();
    insertCanvas();
    insertPod();
  });

  it("只應清理短期 memory 維護資料，不刪正式 pod/repo summary", async () => {
    memoryStateService.setPodMemoryEnabled(POD_ID, true);
    memoryStateService.writePodSummary(POD_ID, "正式 pod 記憶");
    memoryStateService.writeRepoSummary(REPOSITORY_ID, "正式 repo 記憶");

    const job = memoryStateService.createJob({
      scopeType: "pod",
      scopeId: POD_ID,
      sourcePodId: POD_ID,
      repositoryId: REPOSITORY_ID,
    });
    memoryStateService.recordObservation({
      jobId: job.id,
      scopeType: "pod",
      scopeId: POD_ID,
      kind: "candidate",
      summary: "短期 observation",
    });

    const futureNow = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await memoryCleanupService.runOnce(futureNow);

    expect(memoryStateService.listJobsByScope("pod", POD_ID)).toHaveLength(0);
    expect(
      memoryStateService.listObservationsByScope("pod", POD_ID),
    ).toHaveLength(0);
    expect(memoryStateService.getPodState(POD_ID)?.summary).toBe("正式 pod 記憶");
    expect(memoryStateService.getRepoState(REPOSITORY_ID)?.summary).toBe(
      "正式 repo 記憶",
    );
  });
});
