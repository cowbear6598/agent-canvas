import { describe, it, expect } from "vitest";
import {
  collectSelectedNotes,
  collectSelectedPods,
  collectRelatedConnections,
} from "@/composables/canvas/copyPaste/collectCopyData";
import type { SelectableElement } from "@/types";

describe("collectCopyData", () => {
  it("collects selected pods with the provider, repository, plugin, and goal data required for paste", () => {
    const selectedElements: SelectableElement[] = [
      { type: "pod", id: "pod-codex" },
      { type: "pod", id: "pod-claude" },
    ];
    const result = collectSelectedPods(selectedElements, [
      {
        id: "pod-codex",
        name: "Codex Planner",
        x: 100,
        y: 200,
        rotation: 0,
        repositoryId: "repo-1",
        provider: "codex",
        providerConfig: { model: "gpt-5.5" },
        mcpServerNames: ["filesystem"],
        pluginIds: ["jira"],
        goal: { todos: [{ id: "todo-1", text: "Ship" }] },
      },
      {
        id: "pod-claude",
        name: "Claude Reviewer",
        x: 300,
        y: 200,
        rotation: 0,
        repositoryId: null,
        provider: "claude",
        providerConfig: { model: "claude-3-5-sonnet-20241022" },
        mcpServerNames: [],
        pluginIds: [],
        goal: null,
      },
    ] as any);

    expect(result).toEqual([
      expect.objectContaining({
        id: "pod-codex",
        provider: "codex",
        providerConfig: { model: "gpt-5.5" },
        repositoryId: "repo-1",
        mcpServerNames: ["filesystem"],
        pluginIds: ["jira"],
        goal: { todos: [{ id: "todo-1", text: "Ship" }] },
      }),
      expect.objectContaining({
        id: "pod-claude",
        provider: "claude",
        providerConfig: { model: "claude-3-5-sonnet-20241022" },
        goal: null,
      }),
    ]);
  });

  it("collects bound notes for selected pods and ignores bound notes selected independently", () => {
    const result = collectSelectedNotes(
      [
        { type: "pod", id: "pod-1" },
        { type: "repositoryNote", id: "note-free" },
        { type: "repositoryNote", id: "note-bound-to-other-pod" },
      ],
      new Set(["pod-1"]),
      {
        repositoryStore: {
          notes: [
            {
              id: "note-bound",
              repositoryId: "repo-bound",
              name: "Bound repo",
              x: 0,
              y: 0,
              boundToPodId: "pod-1",
              originalPosition: { x: 12, y: 18 },
            },
            {
              id: "note-free",
              repositoryId: "repo-free",
              name: "Free repo",
              x: 100,
              y: 100,
              boundToPodId: null,
              originalPosition: null,
            },
            {
              id: "note-bound-to-other-pod",
              repositoryId: "repo-other",
              name: "Other bound repo",
              x: 200,
              y: 200,
              boundToPodId: "pod-2",
              originalPosition: null,
            },
          ],
        },
      },
    );

    expect(result.repositoryNotes).toEqual([
      expect.objectContaining({
        repositoryId: "repo-bound",
        boundToOriginalPodId: "pod-1",
      }),
      expect.objectContaining({
        repositoryId: "repo-free",
        boundToOriginalPodId: null,
      }),
    ]);
  });

  it("copies only connections where both endpoint pods are part of the selected canvas region", () => {
    const result = collectRelatedConnections(new Set(["pod-1", "pod-2"]), [
      {
        id: "conn-selected",
        sourcePodId: "pod-1",
        targetPodId: "pod-2",
        sourceAnchor: "bottom",
        targetAnchor: "top",
        triggerMode: "branch",
        summaryProvider: "opencode",
        direct: false,
        summaryModel: "openai/gpt-4o",
        summaryThinkingLevel: "high",
        label: "Approved",
        description: "Continue after approval",
      },
      {
        id: "conn-outside",
        sourcePodId: "pod-1",
        targetPodId: "pod-3",
        sourceAnchor: "right",
        targetAnchor: "left",
        triggerMode: "auto",
      },
    ] as any);

    expect(result).toEqual([
      {
        sourcePodId: "pod-1",
        sourceAnchor: "bottom",
        targetPodId: "pod-2",
        targetAnchor: "top",
        triggerMode: "branch",
        direct: false,
        summaryProvider: "opencode",
        summaryModel: "openai/gpt-4o",
        summaryThinkingLevel: "high",
        label: "Approved",
        description: "Continue after approval",
      },
    ]);
  });
});
