import { describe, it, expect } from "vitest";
import { setupStoreTest } from "@tests/helpers/testSetup";
import { useClipboardStore } from "@/stores/clipboardStore";
import type { CopiedPod, CopiedRepositoryNote, CopiedConnection } from "@/types";

describe("clipboardStore", () => {
  setupStoreTest();

  const mockPod: CopiedPod = {
    id: "pod-1",
    name: "Test Pod",
    x: 100,
    y: 200,
    rotation: 0,
    provider: "claude",
    providerConfig: { model: "opus" },
  };

  const mockRepositoryNote: CopiedRepositoryNote = {
    repositoryId: "repo-1",
    name: "Test Repository",
    x: 200,
    y: 300,
    boundToOriginalPodId: null,
    originalPosition: null,
  };

  const mockConnection: CopiedConnection = {
    sourcePodId: "pod-1",
    sourceAnchor: "bottom",
    targetPodId: "pod-2",
    targetAnchor: "top",
  };

  it("初始狀態為空", () => {
    const store = useClipboardStore();

    expect(store.copiedPods).toEqual([]);
    expect(store.copiedRepositoryNotes).toEqual([]);
    expect(store.copiedConnections).toEqual([]);
    expect(store.isEmpty).toBe(true);
  });

  it("setCopy 會覆寫目前資料", () => {
    const store = useClipboardStore();

    store.setCopy([mockPod], [mockRepositoryNote], [mockConnection]);

    expect(store.copiedPods).toEqual([mockPod]);
    expect(store.copiedRepositoryNotes).toEqual([mockRepositoryNote]);
    expect(store.copiedConnections).toEqual([mockConnection]);
    expect(store.isEmpty).toBe(false);
  });

  it("clear 會清空所有資料", () => {
    const store = useClipboardStore();
    store.setCopy([mockPod], [mockRepositoryNote], [mockConnection]);

    store.clear();

    expect(store.copiedPods).toEqual([]);
    expect(store.copiedRepositoryNotes).toEqual([]);
    expect(store.copiedConnections).toEqual([]);
    expect(store.isEmpty).toBe(true);
  });

  it("getCopiedData 回傳目前快照", () => {
    const store = useClipboardStore();
    store.setCopy([mockPod], [mockRepositoryNote], [mockConnection]);

    expect(store.getCopiedData()).toEqual({
      pods: [mockPod],
      repositoryNotes: [mockRepositoryNote],
      connections: [mockConnection],
    });
  });
});
