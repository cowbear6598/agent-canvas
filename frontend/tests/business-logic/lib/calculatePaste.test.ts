import { describe, it, expect } from "vitest";
import {
  calculatePastePositions,
  generatePasteName,
  transformPods,
} from "@/composables/canvas/copyPaste/calculatePaste";
import { NOTE_HEIGHT, NOTE_WIDTH, POD_HEIGHT, POD_WIDTH } from "@/lib/constants";
import type {
  CopiedConnection,
  CopiedPod,
  CopiedRepositoryNote,
} from "@/types";

function copiedPod(overrides: Partial<CopiedPod>): CopiedPod {
  return {
    id: "pod-1",
    name: "Pod A",
    x: 0,
    y: 0,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "opus" },
    repositoryId: null,
    goal: null,
    ...overrides,
  };
}

describe("generatePasteName", () => {
  it("uses the next available numeric suffix based on the base pod name", () => {
    expect(generatePasteName("Pod A", new Set(["Pod A"]))).toBe("Pod A (1)");
    expect(generatePasteName("Pod A", new Set(["Pod A", "Pod A (1)"]))).toBe(
      "Pod A (2)",
    );
    expect(generatePasteName("Pod A (1)", new Set(["Pod A (1)"]))).toBe(
      "Pod A (2)",
    );
    expect(generatePasteName("Pod (A)", new Set(["Pod (A)"]))).toBe(
      "Pod (A) (1)",
    );
  });

  it("caps generated names so pasted pod names stay within product limits", () => {
    const longName = "A".repeat(50);
    const result = generatePasteName(longName, new Set([longName]));

    expect(result.length).toBeLessThanOrEqual(50);
  });
});

describe("transformPods", () => {
  it("renames duplicated pods independently without mutating the existing canvas names", () => {
    const existingNames = new Set(["Pod A"]);
    const result = transformPods(
      [
        copiedPod({ id: "pod-a", name: "Pod A" }),
        copiedPod({ id: "pod-b", name: "Pod A" }),
      ],
      { offsetX: 10, offsetY: 20 },
      existingNames,
    );

    expect(result.map((pod) => pod.name)).toEqual(["Pod A (1)", "Pod A (2)"]);
    expect(result.map((pod) => ({ x: pod.x, y: pod.y }))).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 20 },
    ]);
    expect(existingNames).toEqual(new Set(["Pod A"]));
  });

  it("preserves provider, repository, plugin, and goal data needed to recreate a pasted pod", () => {
    const result = transformPods(
      [
        copiedPod({
          id: "codex-source",
          name: "Codex Planner",
          provider: "codex",
          providerConfig: { model: "gpt-5.4" },
          repositoryId: "repo-1",
          mcpServerNames: ["filesystem"],
          pluginIds: ["jira"],
          goal: { todos: [{ id: "todo-1", text: "Ship" }] },
        }),
      ],
      { offsetX: 0, offsetY: 0 },
      new Set(),
    );

    expect(result[0]).toMatchObject({
      originalId: "codex-source",
      provider: "codex",
      providerConfig: { model: "gpt-5.4" },
      repositoryId: "repo-1",
      mcpServerNames: ["filesystem"],
      pluginIds: ["jira"],
      goal: { todos: [{ id: "todo-1", text: "Ship" }] },
    });
  });
});

describe("calculatePastePositions", () => {
  it("centers the copied canvas selection on the target point while bound notes stay attached to their pod", () => {
    const pods = [
      copiedPod({ id: "pod-source", name: "Worker", x: 100, y: 80 }),
    ];
    const freeNote: CopiedRepositoryNote = {
      repositoryId: "repo-free",
      name: "Free repo",
      x: 320,
      y: 260,
      boundToOriginalPodId: null,
      originalPosition: null,
    };
    const boundNote: CopiedRepositoryNote = {
      repositoryId: "repo-bound",
      name: "Bound repo",
      x: 12,
      y: 18,
      boundToOriginalPodId: "pod-source",
      originalPosition: { x: 12, y: 18 },
    };
    const targetPosition = { x: 640, y: 480 };

    const selectionCenter = {
      x:
        (Math.min(pods[0]!.x, freeNote.x) +
          Math.max(pods[0]!.x + POD_WIDTH, freeNote.x + NOTE_WIDTH)) /
        2,
      y:
        (Math.min(pods[0]!.y, freeNote.y) +
          Math.max(pods[0]!.y + POD_HEIGHT, freeNote.y + NOTE_HEIGHT)) /
        2,
    };
    const expectedOffset = {
      x: targetPosition.x - selectionCenter.x,
      y: targetPosition.y - selectionCenter.y,
    };

    const result = calculatePastePositions(
      targetPosition,
      {
        pods,
        repositoryNotes: [freeNote, boundNote],
        connections: [],
      },
      new Set(),
    );

    expect(result.pods[0]).toMatchObject({
      originalId: "pod-source",
      x: pods[0]!.x + expectedOffset.x,
      y: pods[0]!.y + expectedOffset.y,
    });
    expect(result.repositoryNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId: "repo-free",
          x: freeNote.x + expectedOffset.x,
          y: freeNote.y + expectedOffset.y,
          boundToOriginalPodId: null,
        }),
        expect.objectContaining({
          repositoryId: "repo-bound",
          x: 0,
          y: 0,
          boundToOriginalPodId: "pod-source",
        }),
      ]),
    );
  });

  it("converts copied connections to backend paste payloads using original pod ids", () => {
    const connections: CopiedConnection[] = [
      {
        sourcePodId: "pod-source",
        sourceAnchor: "bottom",
        targetPodId: "pod-target",
        targetAnchor: "top",
        triggerMode: "branch",
        label: "Approved",
        description: "Continue after approval",
        branchProvider: "codex",
        branchModel: "gpt-5.4",
      },
    ];

    const result = calculatePastePositions(
      { x: 100, y: 100 },
      {
        pods: [
          copiedPod({ id: "pod-source", x: 0, y: 0 }),
          copiedPod({ id: "pod-target", x: 200, y: 0 }),
        ],
        repositoryNotes: [],
        connections,
      },
      new Set(),
    );

    expect(result.connections).toEqual([
      {
        originalSourcePodId: "pod-source",
        sourceAnchor: "bottom",
        originalTargetPodId: "pod-target",
        targetAnchor: "top",
        triggerMode: "branch",
        label: "Approved",
        description: "Continue after approval",
        branchProvider: "codex",
        branchModel: "gpt-5.4",
      },
    ]);
  });
});
