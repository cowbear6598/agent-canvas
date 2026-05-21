import { describe, it, expect } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { createMockNote, createMockPod } from "@tests/helpers/factories";
import { useSelectionStore } from "@/stores/pod/selectionStore";

describe("selectionStore canvas selection rules", () => {
  setupStoreTest();

  it("dragging a selection box selects every pod that intersects the canvas area", () => {
    const store = useSelectionStore();
    const podInBox = createMockPod({ id: "pod-in-box", x: 120, y: 120 });
    const secondPodInBox = createMockPod({
      id: "pod-second-in-box",
      x: 260,
      y: 220,
    });
    const podOutside = createMockPod({ id: "pod-outside", x: 900, y: 900 });

    store.startSelection(0, 0);
    store.updateSelection(520, 520);
    store.calculateSelectedElements({
      pods: [podInBox, secondPodInBox, podOutside],
      noteGroups: [],
    });

    expect(store.selectedPodIds).toEqual([
      "pod-in-box",
      "pod-second-in-box",
    ]);
    expect(store.hasSelection).toBe(true);
    expect(store.isElementSelected("pod", "pod-in-box")).toBe(true);
    expect(store.isElementSelected("pod", "pod-outside")).toBe(false);
  });

  it("dragging the selection box backward still uses the same canvas area", () => {
    const store = useSelectionStore();
    const pod = createMockPod({ id: "pod-1", x: 100, y: 100 });

    store.startSelection(500, 500);
    store.updateSelection(0, 0);
    store.calculateSelectedElements({
      pods: [pod],
      noteGroups: [],
    });

    expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
  });

  it("Ctrl-drag toggles selected canvas elements without losing elements outside the new box", () => {
    const store = useSelectionStore();
    const alreadySelectedPod = createMockPod({
      id: "pod-already-selected",
      x: 100,
      y: 100,
    });
    const newlySelectedPod = createMockPod({
      id: "pod-newly-selected",
      x: 260,
      y: 260,
    });
    const preservedPod = createMockPod({
      id: "pod-preserved",
      x: 900,
      y: 900,
    });

    store.setSelectedElements([
      { type: "pod", id: "pod-already-selected" },
      { type: "pod", id: "pod-preserved" },
    ]);
    store.startSelection(0, 0, true);
    store.updateSelection(520, 520);
    store.calculateSelectedElements({
      pods: [alreadySelectedPod, newlySelectedPod, preservedPod],
      noteGroups: [],
    });

    expect(store.selectedElements).toEqual([
      { type: "pod", id: "pod-preserved" },
      { type: "pod", id: "pod-newly-selected" },
    ]);
    expect(store.isElementSelected("pod", "pod-already-selected")).toBe(false);
    expect(store.isElementSelected("pod", "pod-preserved")).toBe(true);
  });

  it("box selection can include free repository notes but excludes notes already bound to a pod", () => {
    const store = useSelectionStore();
    const pod = createMockPod({ id: "pod-1", x: 80, y: 80 });
    const freeNote = createMockNote("repository", {
      id: "note-free",
      x: 220,
      y: 220,
      boundToPodId: null,
    });
    const boundNote = createMockNote("repository", {
      id: "note-bound",
      x: 260,
      y: 260,
      boundToPodId: "pod-1",
    });

    store.startSelection(0, 0);
    store.updateSelection(520, 520);
    store.calculateSelectedElements({
      pods: [pod],
      noteGroups: [
        { notes: [freeNote, boundNote], type: "repositoryNote" },
      ],
    });

    expect(store.selectedElements).toEqual([
      { type: "pod", id: "pod-1" },
      { type: "repositoryNote", id: "note-free" },
    ]);
    expect(store.selectedRepositoryNoteIds).toEqual(["note-free"]);
  });

  it("canceling a selection keeps the existing selection because no new canvas operation completed", () => {
    const store = useSelectionStore();

    store.setSelectedElements([{ type: "pod", id: "pod-1" }]);
    store.startSelection(100, 100, true);
    store.cancelSelection();

    expect(store.selectedElements).toEqual([{ type: "pod", id: "pod-1" }]);
    expect(store.isSelecting).toBe(false);
    expect(store.box).toBeNull();
  });
});
