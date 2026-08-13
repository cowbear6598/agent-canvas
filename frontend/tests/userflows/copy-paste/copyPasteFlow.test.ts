import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
  simulateEvent,
} from "@tests/helpers/mockWebSocket";
import { setupStoreTest, mockToastFactory } from "@tests/helpers/testSetup";
import {
  createMockPod,
  createMockRepositoryNote,
  createMockConnection,
} from "@tests/helpers/factories";
import { useCopyPaste } from "@/composables/canvas/useCopyPaste";
import { usePodStore, useSelectionStore, useViewportStore } from "@/stores/pod";
import { useRepositoryStore } from "@/stores/note";
import { useConnectionStore } from "@/stores/connectionStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  registerUnifiedListeners,
  unregisterUnifiedListeners,
} from "@/composables/useUnifiedEventListeners";
import type { SelectableElement } from "@/types";

vi.mock("@/services/websocket", () => webSocketMockFactory());
vi.mock("@/composables/useToast", () => mockToastFactory());

const CopyPasteHarness = defineComponent({
  name: "CopyPasteHarness",
  setup() {
    useCopyPaste();
    return () => null;
  },
});

function pressShortcut(key: "c" | "v"): boolean {
  return document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function flushCopyPasteFlow(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe("copyPasteFlow", () => {
  let podStore: ReturnType<typeof usePodStore>;
  let selectionStore: ReturnType<typeof useSelectionStore>;
  let repositoryStore: ReturnType<typeof useRepositoryStore>;
  let connectionStore: ReturnType<typeof useConnectionStore>;
  let clipboardStore: ReturnType<typeof useClipboardStore>;
  let canvasStore: ReturnType<typeof useCanvasStore>;
  let viewportStore: ReturnType<typeof useViewportStore>;

  setupStoreTest();

  beforeEach(() => {
    unregisterUnifiedListeners();
    podStore = usePodStore();
    selectionStore = useSelectionStore();
    repositoryStore = useRepositoryStore();
    connectionStore = useConnectionStore();
    clipboardStore = useClipboardStore();
    canvasStore = useCanvasStore();
    viewportStore = useViewportStore();
    canvasStore.activeCanvasId = "canvas-copy-paste";
    viewportStore.setOffset(0, 0);
    viewportStore.zoom = 1;
  });

  function selectCanvasArea(toX: number, toY: number): void {
    selectionStore.startSelection(0, 0);
    selectionStore.updateSelection(toX, toY);
    selectionStore.calculateSelectedElements({
      pods: podStore.pods,
      noteGroups: [
        { notes: repositoryStore.notes, type: "repositoryNote" as const },
      ],
    });
  }

  it("copies the selected pods, notes, and internal connection, then pastes the new canvas elements at the pointer", async () => {
    const wrapper = mount(CopyPasteHarness);
    registerUnifiedListeners();
    const sourcePod = createMockPod({
      id: "pod-source",
      name: "Worker",
      x: 100,
      y: 100,
      provider: "claude",
      providerConfig: { model: "opus" },
    });
    const targetPod = createMockPod({
      id: "pod-target",
      name: "Reviewer",
      x: 280,
      y: 180,
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
    });
    const outsidePod = createMockPod({
      id: "pod-outside",
      name: "Not copied",
      x: 900,
      y: 900,
    });
    const boundNote = createMockRepositoryNote({
      id: "note-bound",
      repositoryId: "repo-bound",
      name: "Bound repo",
      x: 0,
      y: 0,
      boundToPodId: "pod-source",
    });
    const freeNote = createMockRepositoryNote({
      id: "note-free",
      repositoryId: "repo-free",
      name: "Free repo",
      x: 240,
      y: 260,
      boundToPodId: null,
    });
    const selectedConnection = createMockConnection({
      id: "conn-selected",
      sourcePodId: "pod-source",
      targetPodId: "pod-target",
      sourceAnchor: "bottom",
      targetAnchor: "top",
      triggerMode: "branch",
      label: "approved",
      description: "Continue after review",
      direct: true,
    });
    const externalConnection = createMockConnection({
      id: "conn-external",
      sourcePodId: "pod-source",
      targetPodId: "pod-outside",
    });

    podStore.pods = [sourcePod, targetPod, outsidePod];
    repositoryStore.notes = [boundNote, freeNote] as any[];
    connectionStore.connections = [selectedConnection, externalConnection];

    selectCanvasArea(520, 520);
    expect(selectionStore.selectedElements).toEqual(
      expect.arrayContaining([
        { type: "pod", id: "pod-source" },
        { type: "pod", id: "pod-target" },
        { type: "repositoryNote", id: "note-free" },
      ] satisfies SelectableElement[]),
    );
    expect(selectionStore.selectedElements).not.toContainEqual({
      type: "repositoryNote",
      id: "note-bound",
    });

    pressShortcut("c");

    expect(clipboardStore.copiedPods.map((pod) => pod.id)).toEqual([
      "pod-source",
      "pod-target",
    ]);
    expect(clipboardStore.copiedPods[1]).toMatchObject({
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
    });
    expect(clipboardStore.copiedRepositoryNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId: "repo-bound",
          boundToOriginalPodId: "pod-source",
        }),
        expect.objectContaining({
          repositoryId: "repo-free",
          boundToOriginalPodId: null,
        }),
      ]),
    );
    expect(clipboardStore.copiedConnections).toEqual([
      expect.objectContaining({
        sourcePodId: "pod-source",
        targetPodId: "pod-target",
        triggerMode: "branch",
        direct: true,
        label: "approved",
      }),
    ]);

    const pasteResult = {
      success: true,
      requestId: "req-paste",
      podIdMapping: {
        "pod-source": "pod-new-source",
        "pod-target": "pod-new-target",
      },
      errors: [],
      createdPods: [
        { ...sourcePod, id: "pod-new-source", name: "Worker (1)" },
        { ...targetPod, id: "pod-new-target", name: "Reviewer (1)" },
      ],
      createdRepositoryNotes: [
        {
          ...freeNote,
          id: "note-new-free",
          boundToPodId: null,
        },
        {
          ...boundNote,
          id: "note-new-bound",
          boundToPodId: "pod-new-source",
        },
      ],
      createdConnections: [
        {
          ...selectedConnection,
          id: "conn-new",
          sourcePodId: "pod-new-source",
          targetPodId: "pod-new-target",
        },
      ],
    };
    mockCreateWebSocketRequest.mockResolvedValueOnce(pasteResult);

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 640,
        clientY: 500,
        bubbles: true,
      }),
    );
    pressShortcut("v");
    await flushCopyPasteFlow();

    expect(mockCreateWebSocketRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestEvent: "canvas:paste",
        responseEvent: "canvas:paste:result",
        payload: expect.objectContaining({
          canvasId: "canvas-copy-paste",
          pods: [
            expect.objectContaining({
              originalId: "pod-source",
              name: "Worker (1)",
              x: expect.any(Number),
              y: expect.any(Number),
              provider: "claude",
              providerConfig: { model: "opus" },
            }),
            expect.objectContaining({
              originalId: "pod-target",
              name: "Reviewer (1)",
              provider: "codex",
              providerConfig: { model: "gpt-5.5" },
            }),
          ],
          repositoryNotes: expect.arrayContaining([
            expect.objectContaining({
              repositoryId: "repo-bound",
              boundToOriginalPodId: "pod-source",
              x: 0,
              y: 0,
            }),
            expect.objectContaining({
              repositoryId: "repo-free",
              boundToOriginalPodId: null,
              x: expect.any(Number),
              y: expect.any(Number),
            }),
          ]),
          connections: [
            expect.objectContaining({
              originalSourcePodId: "pod-source",
              originalTargetPodId: "pod-target",
              triggerMode: "branch",
              direct: true,
              label: "approved",
            }),
          ],
        }),
      }),
    );
    expect(selectionStore.selectedElements).toEqual([
      { type: "pod", id: "pod-new-source" },
      { type: "pod", id: "pod-new-target" },
      { type: "repositoryNote", id: "note-new-free" },
    ]);

    simulateEvent("canvas:paste:result", {
      ...pasteResult,
      canvasId: "canvas-copy-paste",
    });
    await nextTick();

    expect(podStore.getPodById("pod-new-source")).toMatchObject({
      name: "Worker (1)",
    });
    expect(podStore.getPodById("pod-new-target")).toMatchObject({
      name: "Reviewer (1)",
    });
    expect(connectionStore.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "conn-new",
          sourcePodId: "pod-new-source",
          targetPodId: "pod-new-target",
        }),
      ]),
    );

    wrapper.unmount();
    unregisterUnifiedListeners();
  });
});
