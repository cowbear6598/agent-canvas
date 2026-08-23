import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePodPack } from "@/composables/canvas/usePodPack";

const mocks = vi.hoisted(() => ({
  exportPodPack: vi.fn(),
  downloadPodPack: vi.fn(),
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

vi.mock("@/composables/canvas/useCanvasContext", () => ({
  useCanvasContext: () => ({
    podStore: { pods: [] },
    viewportStore: { screenToCanvas: vi.fn() },
    selectionStore: {
      selectedPodIds: ["pod-1"],
      selectedElements: [{ type: "pod", id: "pod-1" }],
      setSelectedElements: vi.fn(),
    },
    repositoryStore: { notes: [], addNoteFromEvent: vi.fn() },
    connectionStore: { connections: [], addConnectionFromEvent: vi.fn() },
  }),
}));

vi.mock("@/composables/canvas/copyPaste/collectCopyData", () => ({
  collectSelectedPods: () => [{ id: "pod-1", name: "Pod 1" }],
  collectRelatedConnections: () => [],
  collectAttachedRepositoryNotes: () => [],
}));

vi.mock("@/services/podPackApi", () => ({
  cancelPodPackTransfer: vi.fn(),
  downloadPodPack: mocks.downloadPodPack,
  exportPodPack: mocks.exportPodPack,
  importPodPack: vi.fn(),
  previewPodPack: vi.fn(),
}));

vi.mock("@/composables/useToast", () => ({
  useToast: () => ({
    showErrorToast: mocks.showErrorToast,
    showSuccessToast: mocks.showSuccessToast,
  }),
}));

vi.mock("@/i18n", () => ({ t: (key: string) => key }));

describe("usePodPack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("crypto.randomUUID 不存在時仍可完成匯出並清除 busy 狀態", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        array.fill(1);
        return array;
      },
    });
    const transfer = {
      id: "transfer-1",
      filename: "workflow.podpack",
      size: 123,
      createdAt: new Date().toISOString(),
      kind: "export" as const,
    };
    mocks.exportPodPack.mockResolvedValue(transfer);

    const podPack = usePodPack();
    await podPack.exportSelection();

    expect(mocks.exportPodPack).toHaveBeenCalledWith(
      expect.objectContaining({
        pods: [expect.objectContaining({ originalId: "pod-1" })],
      }),
      expect.objectContaining({
        transferId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      }),
    );
    expect(mocks.downloadPodPack).toHaveBeenCalledWith(transfer);
    expect(podPack.isExporting.value).toBe(false);
    expect(podPack.transferTask.value).toBeNull();
  });
});
