import { useContextMenu } from "@/composables/canvas/useContextMenu";
import type { TriggerMode } from "@/types";
import type { ModelType, PodProvider } from "@/types/pod";
import { DEFAULT_SUMMARY_MODEL, DEFAULT_AI_DECIDE_MODEL } from "@/types/config";

interface RepositoryContextMenuData {
  repositoryId: string;
  repositoryName: string;
  notePosition: { x: number; y: number };
  isWorktree: boolean;
}

interface ConnectionContextMenuData {
  connectionId: string;
  triggerMode: TriggerMode;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel: string;
  aiDecideModel: ModelType;
  /** 目前 Summary 使用的 AI provider；null 表示尚未設定，undefined 表示舊資料 */
  summaryProvider: PodProvider | null | undefined;
}

interface PodContextMenuData {
  podId: string;
}

interface RepositoryStore {
  typedNotes: Array<{ id: string; repositoryId: string; x: number; y: number }>;
  typedAvailableItems: Array<{
    id: string;
    name: string;
    parentRepoId?: string | null;
  }>;
}

interface ConnectionStore {
  connections: Array<{
    id: string;
    triggerMode: TriggerMode;
    /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
    summaryModel?: string;
    aiDecideModel?: ModelType;
    /** 目前 Summary 使用的 AI provider */
    summaryProvider?: PodProvider | null;
  }>;
}

interface PodStore {
  getPodById: (id: string) => { id: string } | undefined;
}

interface UseCanvasContextMenusOptions {
  repositoryStore: RepositoryStore;
  connectionStore: ConnectionStore;
  podStore: PodStore;
}

export function useCanvasContextMenus(options: UseCanvasContextMenusOptions): {
  repositoryContextMenu: ReturnType<
    typeof useContextMenu<RepositoryContextMenuData>
  >["state"];
  connectionContextMenu: ReturnType<
    typeof useContextMenu<ConnectionContextMenuData>
  >["state"];
  podContextMenu: ReturnType<
    typeof useContextMenu<PodContextMenuData>
  >["state"];
  closeRepositoryContextMenu: () => void;
  closeConnectionContextMenu: () => void;
  closePodContextMenu: () => void;
  handleRepositoryContextMenu: (data: {
    noteId: string;
    event: MouseEvent;
  }) => void;
  handleConnectionContextMenu: (data: {
    connectionId: string;
    event: MouseEvent;
  }) => void;
  handlePodContextMenu: (data: { podId: string; event: MouseEvent }) => void;
} {
  const { repositoryStore, connectionStore, podStore } = options;

  const {
    state: repositoryContextMenu,
    open: openRepositoryContextMenu,
    close: closeRepositoryContextMenu,
  } = useContextMenu<RepositoryContextMenuData>({
    repositoryId: "",
    repositoryName: "",
    notePosition: { x: 0, y: 0 },
    isWorktree: false,
  });

  const {
    state: connectionContextMenu,
    open: openConnectionContextMenu,
    close: closeConnectionContextMenu,
  } = useContextMenu<ConnectionContextMenuData>({
    connectionId: "",
    triggerMode: "auto" as TriggerMode,
    summaryModel: DEFAULT_SUMMARY_MODEL,
    aiDecideModel: DEFAULT_AI_DECIDE_MODEL,
    summaryProvider: undefined,
  });

  const {
    state: podContextMenu,
    open: openPodContextMenu,
    close: closePodContextMenu,
  } = useContextMenu<PodContextMenuData>({
    podId: "",
  });

  const handleRepositoryContextMenu = (data: {
    noteId: string;
    event: MouseEvent;
  }): void => {
    const note = repositoryStore.typedNotes.find((n) => n.id === data.noteId);
    if (!note) return;

    const repository = repositoryStore.typedAvailableItems.find(
      (r) => r.id === note.repositoryId,
    );
    if (!repository) return;

    openRepositoryContextMenu(data.event, {
      repositoryId: repository.id,
      repositoryName: repository.name,
      notePosition: { x: note.x, y: note.y },
      isWorktree:
        repository.parentRepoId !== undefined &&
        repository.parentRepoId !== null,
    });
  };

  const handleConnectionContextMenu = (data: {
    connectionId: string;
    event: MouseEvent;
  }): void => {
    const connection = connectionStore.connections.find(
      (c) => c.id === data.connectionId,
    );
    if (!connection) return;

    openConnectionContextMenu(data.event, {
      connectionId: connection.id,
      triggerMode: connection.triggerMode,
      summaryModel: connection.summaryModel ?? DEFAULT_SUMMARY_MODEL,
      aiDecideModel: connection.aiDecideModel ?? DEFAULT_AI_DECIDE_MODEL,
      // 直接帶入 summaryProvider，UI 層自行處理 null/undefined 顯示邏輯
      summaryProvider: connection.summaryProvider,
    });
  };

  const handlePodContextMenu = (data: {
    podId: string;
    event: MouseEvent;
  }): void => {
    const pod = podStore.getPodById(data.podId);
    if (!pod) return;

    openPodContextMenu(data.event, {
      podId: pod.id,
    });
  };

  return {
    repositoryContextMenu,
    connectionContextMenu,
    podContextMenu,
    closeRepositoryContextMenu,
    closeConnectionContextMenu,
    closePodContextMenu,
    handleRepositoryContextMenu,
    handleConnectionContextMenu,
    handlePodContextMenu,
  };
}
