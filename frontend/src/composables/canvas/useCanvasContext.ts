import { usePodStore, useViewportStore, useSelectionStore } from "@/stores/pod";
import {
  useSkillStore,
  useSubAgentStore,
  useRepositoryStore,
  useCommandStore,
  useMcpServerStore,
} from "@/stores/note";
import { useConnectionStore } from "@/stores/connectionStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useChatStore } from "@/stores/chat";
import { useCanvasStore } from "@/stores/canvasStore";
import { useIntegrationStore } from "@/stores/integrationStore";

export function useCanvasContext(): {
  podStore: ReturnType<typeof usePodStore>;
  viewportStore: ReturnType<typeof useViewportStore>;
  selectionStore: ReturnType<typeof useSelectionStore>;
  skillStore: ReturnType<typeof useSkillStore>;
  subAgentStore: ReturnType<typeof useSubAgentStore>;
  repositoryStore: ReturnType<typeof useRepositoryStore>;
  commandStore: ReturnType<typeof useCommandStore>;
  mcpServerStore: ReturnType<typeof useMcpServerStore>;
  connectionStore: ReturnType<typeof useConnectionStore>;
  clipboardStore: ReturnType<typeof useClipboardStore>;
  chatStore: ReturnType<typeof useChatStore>;
  canvasStore: ReturnType<typeof useCanvasStore>;
  integrationStore: ReturnType<typeof useIntegrationStore>;
} {
  const podStore = usePodStore();
  const viewportStore = useViewportStore();
  const selectionStore = useSelectionStore();
  const skillStore = useSkillStore();
  const subAgentStore = useSubAgentStore();
  const repositoryStore = useRepositoryStore();
  const commandStore = useCommandStore();
  const mcpServerStore = useMcpServerStore();
  const connectionStore = useConnectionStore();
  const clipboardStore = useClipboardStore();
  const chatStore = useChatStore();
  const canvasStore = useCanvasStore();
  const integrationStore = useIntegrationStore();

  return {
    podStore,
    viewportStore,
    selectionStore,
    skillStore,
    subAgentStore,
    repositoryStore,
    commandStore,
    mcpServerStore,
    connectionStore,
    clipboardStore,
    chatStore,
    canvasStore,
    integrationStore,
  };
}
