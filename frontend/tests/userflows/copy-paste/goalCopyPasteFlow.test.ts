import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import {
  webSocketMockFactory,
  mockCreateWebSocketRequest,
} from "@tests/helpers/mockWebSocket";
import { setupStoreTest, mockToastFactory } from "@tests/helpers/testSetup";
import { createMockPod, createMockConnection } from "@tests/helpers/factories";
import { useCopyPaste } from "@/composables/canvas/useCopyPaste";
import { useCanvasStore } from "@/stores/canvasStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { usePodStore, useSelectionStore, useViewportStore } from "@/stores/pod";
import type { PodGoal } from "@/types";

vi.mock("@/services/websocket", () => webSocketMockFactory());
vi.mock("@/composables/useToast", () => mockToastFactory());

const CopyPasteHarness = defineComponent({
  name: "GoalCopyPasteHarness",
  setup() {
    useCopyPaste();
    return () => null;
  },
});

function pressShortcut(key: "c" | "v"): void {
  document.dispatchEvent(
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

describe("goalCopyPasteFlow", () => {
  let podStore: ReturnType<typeof usePodStore>;
  let selectionStore: ReturnType<typeof useSelectionStore>;
  let connectionStore: ReturnType<typeof useConnectionStore>;
  let clipboardStore: ReturnType<typeof useClipboardStore>;
  let canvasStore: ReturnType<typeof useCanvasStore>;
  let viewportStore: ReturnType<typeof useViewportStore>;

  setupStoreTest();

  beforeEach(() => {
    podStore = usePodStore();
    selectionStore = useSelectionStore();
    connectionStore = useConnectionStore();
    clipboardStore = useClipboardStore();
    canvasStore = useCanvasStore();
    viewportStore = useViewportStore();
    canvasStore.activeCanvasId = "canvas-goal-copy-paste";
    viewportStore.setOffset(0, 0);
    viewportStore.zoom = 1;
  });

  it("copies and pastes a pod with its goal so the backend receives the goal and the new pod becomes selected", async () => {
    const wrapper = mount(CopyPasteHarness);
    const sourceGoal: PodGoal = {
      todos: [
        { id: "goal-todo-1", text: "Define rollout" },
        { id: "goal-todo-2", text: "Verify copied pod" },
      ],
    };
    const sourcePod = createMockPod({
      id: "pod-with-goal",
      name: "Planner",
      x: 120,
      y: 160,
      repositoryId: "repo-planner",
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
      goal: sourceGoal,
    });
    const downstreamPod = createMockPod({
      id: "pod-downstream",
      name: "Downstream",
      x: 320,
      y: 160,
    });
    const connection = createMockConnection({
      id: "conn-goal-flow",
      sourcePodId: "pod-with-goal",
      targetPodId: "pod-downstream",
      triggerMode: "auto",
    });

    podStore.pods = [sourcePod, downstreamPod];
    connectionStore.connections = [connection];
    selectionStore.setSelectedElements([
      { type: "pod", id: "pod-with-goal" },
      { type: "pod", id: "pod-downstream" },
    ]);

    pressShortcut("c");

    expect(clipboardStore.copiedPods).toHaveLength(2);
    expect(clipboardStore.copiedPods[0]).toMatchObject({
      id: "pod-with-goal",
      repositoryId: "repo-planner",
      provider: "codex",
      providerConfig: { model: "gpt-5.5" },
      goal: sourceGoal,
    });
    expect(clipboardStore.copiedConnections).toEqual([
      expect.objectContaining({
        sourcePodId: "pod-with-goal",
        targetPodId: "pod-downstream",
      }),
    ]);

    const pastedGoal: PodGoal = {
      todos: [
        { id: "new-goal-todo-1", text: "Define rollout" },
        { id: "new-goal-todo-2", text: "Verify copied pod" },
      ],
    };
    mockCreateWebSocketRequest.mockResolvedValueOnce({
      success: true,
      requestId: "req-goal-paste",
      podIdMapping: {
        "pod-with-goal": "pod-with-goal-copy",
        "pod-downstream": "pod-downstream-copy",
      },
      errors: [],
      createdPods: [
        {
          ...sourcePod,
          id: "pod-with-goal-copy",
          name: "Planner (1)",
          goal: pastedGoal,
        },
        {
          ...downstreamPod,
          id: "pod-downstream-copy",
          name: "Downstream (1)",
        },
      ],
      createdRepositoryNotes: [],
      createdConnections: [
        {
          ...connection,
          id: "conn-goal-flow-copy",
          sourcePodId: "pod-with-goal-copy",
          targetPodId: "pod-downstream-copy",
        },
      ],
    });

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: 600,
        clientY: 360,
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
          canvasId: "canvas-goal-copy-paste",
          pods: [
            expect.objectContaining({
              originalId: "pod-with-goal",
              name: "Planner (1)",
              repositoryId: "repo-planner",
              provider: "codex",
              providerConfig: { model: "gpt-5.5" },
              goal: sourceGoal,
            }),
            expect.objectContaining({
              originalId: "pod-downstream",
              name: "Downstream (1)",
              goal: null,
            }),
          ],
          connections: [
            expect.objectContaining({
              originalSourcePodId: "pod-with-goal",
              originalTargetPodId: "pod-downstream",
            }),
          ],
        }),
      }),
    );
    expect(selectionStore.selectedElements).toEqual([
      { type: "pod", id: "pod-with-goal-copy" },
      { type: "pod", id: "pod-downstream-copy" },
    ]);
    expect(pastedGoal.todos.map((todo) => todo.text)).toEqual(
      sourceGoal.todos.map((todo) => todo.text),
    );
    expect(pastedGoal.todos.map((todo) => todo.id)).not.toEqual(
      sourceGoal.todos.map((todo) => todo.id),
    );

    wrapper.unmount();
  });
});
