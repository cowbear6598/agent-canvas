import { useContextMenu } from "@/composables/canvas/useContextMenu";
import type { TriggerMode } from "@/types";
import type { PodProvider } from "@/types/pod";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";

interface RepositoryContextMenuData {
  repositoryId: string;
  repositoryName: string;
  notePosition: { x: number; y: number };
}

interface ConnectionContextMenuData {
  connectionId: string;
  triggerMode: TriggerMode;
  /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
  summaryModel: string;
  /** 目前 Summary 使用的 AI provider；null 表示尚未設定，undefined 表示舊資料 */
  summaryProvider: PodProvider | null | undefined;
  /** Branch 模式下的連線標籤 */
  label?: string;
  /** Branch 模式下的連線描述 */
  description?: string;
  /** Branch 模式使用的 AI Provider */
  branchProvider?: PodProvider;
  /** Branch 模式使用的模型字串 */
  branchModel?: string;
}

interface PodContextMenuData {
  podId: string;
  memoryEnabled: boolean;
  hasPodMemory: boolean;
}

interface RepositoryStore {
  typedNotes: Array<{ id: string; repositoryId: string; x: number; y: number }>;
  typedAvailableItems: Array<{
    id: string;
    name: string;
  }>;
}

interface ConnectionStore {
  connections: Array<{
    id: string;
    triggerMode: TriggerMode;
    /** summaryModel 接受任意 provider 的模型名稱字串，不限於 Claude ModelType */
    summaryModel?: string;
    /** 目前 Summary 使用的 AI provider */
    summaryProvider?: PodProvider | null;
    /** Branch 模式下的連線標籤 */
    label?: string;
    /** Branch 模式下的連線描述 */
    description?: string;
    /** Branch 模式使用的 AI Provider */
    branchProvider?: PodProvider;
    /** Branch 模式使用的模型字串 */
    branchModel?: string;
  }>;
}

interface PodStore {
  getPodById: (
    id: string,
  ) =>
    | {
        id: string;
        memoryEnabled?: boolean;
        hasPodMemory?: boolean;
      }
    | undefined;
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
  });

  const {
    state: connectionContextMenu,
    open: openConnectionContextMenu,
    close: closeConnectionContextMenu,
  } = useContextMenu<ConnectionContextMenuData>({
    connectionId: "",
    triggerMode: "auto" as TriggerMode,
    summaryModel: DEFAULT_SUMMARY_MODEL,
    summaryProvider: "claude",
  });

  const {
    state: podContextMenu,
    open: openPodContextMenu,
    close: closePodContextMenu,
  } = useContextMenu<PodContextMenuData>({
    podId: "",
    memoryEnabled: false,
    hasPodMemory: false,
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
      summaryProvider: connection.summaryProvider ?? "claude",
      label: connection.label,
      description: connection.description,
      branchProvider: connection.branchProvider,
      branchModel: connection.branchModel,
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
      memoryEnabled: pod.memoryEnabled ?? false,
      hasPodMemory: pod.hasPodMemory ?? false,
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
