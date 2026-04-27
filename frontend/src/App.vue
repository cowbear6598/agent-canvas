<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { websocketClient, WebSocketResponseEvents } from "@/services/websocket";
import type {
  PodStatusChangedPayload,
  ScheduleFiredPayload,
} from "@/types/websocket";
import AppHeader from "@/components/layout/AppHeader.vue";
import CanvasContainer from "@/components/canvas/CanvasContainer.vue";
import CanvasSidebar from "@/components/canvas/CanvasSidebar.vue";
import ChatModal from "@/components/chat/ChatModal.vue";
import HistoryPanel from "@/components/run/HistoryPanel.vue";
import RunChatModal from "@/components/run/RunChatModal.vue";
import { Toast } from "@/components/ui/toast";
import DisconnectOverlay from "@/components/ui/DisconnectOverlay.vue";
import { useCopyPaste } from "@/composables/canvas";
import { useUnifiedEventListeners } from "@/composables/useUnifiedEventListeners";
import {
  CONTENT_PREVIEW_LENGTH,
  RESPONSE_PREVIEW_LENGTH,
  OUTPUT_LINES_PREVIEW_COUNT,
} from "@/lib/constants";
import { truncateContent } from "@/stores/chat/chatUtils";
import { useCursorStore } from "@/stores/cursorStore";
import { logger } from "@/utils/logger";

import { useIntegrationStore } from "@/stores/integrationStore";
import { getAllProviders } from "@/integration/providerRegistry";
import { useRunStore } from "@/stores/run/runStore";
import { useConfigStore } from "@/stores/configStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

const {
  podStore,
  viewportStore,
  chatStore,
  repositoryStore,
  commandStore,
  connectionStore,
  canvasStore,
} = useCanvasContext();

const integrationStore = useIntegrationStore();
const runStore = useRunStore();
const configStore = useConfigStore();
const providerCapabilityStore = useProviderCapabilityStore();

const cursorStore = useCursorStore();

const selectedPod = computed(() => podStore.selectedPod);

const activeRunChatPodName = computed(() => {
  if (!runStore.activeRunChatModal) return "";
  const run = runStore.getRunById(runStore.activeRunChatModal.runId);
  if (!run) return "";
  const instance = run.podInstances.find(
    (i) => i.podId === runStore.activeRunChatModal!.podId,
  );
  return instance?.podName ?? "";
});

const activeRunChatRunStatus = computed(() => {
  if (!runStore.activeRunChatModal) return "running" as const;
  const run = runStore.getRunById(runStore.activeRunChatModal.runId);
  return run?.status ?? "running";
});

useCopyPaste();

const { registerUnifiedListeners, unregisterUnifiedListeners } =
  useUnifiedEventListeners();

const isInitialized = ref(false);
const isLoading = ref(false);
let loadingAbortController: AbortController | null = null;

const loadCanvasData = async (): Promise<void> => {
  await podStore.loadPodsFromBackend();

  viewportStore.resetToCenter();

  await Promise.all([
    (async (): Promise<void> => {
      await repositoryStore.loadRepositories();
      await repositoryStore.loadNotesFromBackend();
    })(),
    (async (): Promise<void> => {
      await commandStore.loadCommands();
      await commandStore.loadNotesFromBackend();
    })(),
    connectionStore.loadConnectionsFromBackend(),
    ...getAllProviders().map((provider) =>
      integrationStore.loadApps(provider.name),
    ),
  ]);

  connectionStore.setupWorkflowListeners();

  const podIds = podStore.pods.map((pod) => pod.id);
  if (podIds.length > 0) {
    await chatStore.loadAllPodsHistory(podIds);
    syncHistoryToPodOutput();
  }

  await runStore.loadRuns();
};

const syncHistoryToPodOutput = (): void => {
  for (const pod of podStore.pods) {
    const messages = chatStore.getMessages(pod.id);

    if (messages.length === 0) continue;

    const recentMessages = messages.slice(-OUTPUT_LINES_PREVIEW_COUNT * 2);

    const output: string[] = [];
    for (const message of recentMessages) {
      if (message.role === "user") {
        output.push(
          `> ${truncateContent(message.content, CONTENT_PREVIEW_LENGTH)}`,
        );
      } else if (message.role === "assistant" && !message.isPartial) {
        if (message.subMessages && message.subMessages.length > 0) {
          for (const sub of message.subMessages) {
            if (sub.content) {
              output.push(
                truncateContent(sub.content, RESPONSE_PREVIEW_LENGTH),
              );
            }
          }
        } else {
          output.push(
            truncateContent(message.content, RESPONSE_PREVIEW_LENGTH),
          );
        }
      }
    }

    if (output.length > 0) {
      const previewOutput = output.slice(-OUTPUT_LINES_PREVIEW_COUNT);
      podStore.updatePod({
        ...pod,
        output: previewOutput,
      });
    }
  }
};

const handleCloseChat = (): void => {
  podStore.selectPod(null);
};

const handlePodStatusChanged = (payload: PodStatusChangedPayload): void => {
  podStore.updatePodStatus(payload.podId, payload.status);
};

const handleScheduleFired = (payload: ScheduleFiredPayload): void => {
  const pod = podStore.getPodById(payload.podId);
  if (pod) {
    podStore.triggerScheduleFiredAnimation(payload.podId);

    // multi-instance pod 不需要在 canvas mini screen 顯示訊息
    if (pod.multiInstance === true) {
      return;
    }
  }
};

const checkAbortedAndCleanup = (controller: AbortController): boolean => {
  if (!controller.signal.aborted) return false;

  if (controller === loadingAbortController) {
    isLoading.value = false;
    loadingAbortController = null;
  }
  return true;
};

const loadAppData = async (): Promise<void> => {
  if (isInitialized.value || isLoading.value) {
    return;
  }

  if (loadingAbortController) {
    loadingAbortController.abort();
  }

  loadingAbortController = new AbortController();
  const currentAbortController = loadingAbortController;

  isLoading.value = true;

  if (checkAbortedAndCleanup(currentAbortController)) return;

  logger.log("[App] Loading config...");
  await configStore.fetchConfig().catch(() => {
    logger.warn("[App] 載入全域設定失敗，使用預設值");
  });

  logger.log("[App] Loading canvases...");
  await canvasStore.loadCanvases();

  if (checkAbortedAndCleanup(currentAbortController)) return;

  if (canvasStore.canvases.length === 0) {
    logger.log("[App] No canvases found, creating default canvas...");
    const defaultCanvas = await canvasStore.createCanvas("Default");
    if (!defaultCanvas) {
      logger.error("[App] Failed to create default canvas");
      if (currentAbortController === loadingAbortController) {
        isLoading.value = false;
        loadingAbortController = null;
      }
      return;
    }
  }

  if (checkAbortedAndCleanup(currentAbortController)) return;

  if (!canvasStore.activeCanvasId) {
    logger.error("[App] No active canvas after initialization");
    logger.error("[App] Available canvases:", canvasStore.canvases);
    if (currentAbortController === loadingAbortController) {
      isLoading.value = false;
      loadingAbortController = null;
    }
    return;
  }

  logger.log("[App] Active canvas:", canvasStore.activeCanvasId);
  logger.log("[App] Loading canvas data...");
  await loadCanvasData();

  if (checkAbortedAndCleanup(currentAbortController)) return;

  websocketClient.on<PodStatusChangedPayload>(
    WebSocketResponseEvents.POD_STATUS_CHANGED,
    handlePodStatusChanged,
  );
  websocketClient.on<ScheduleFiredPayload>(
    WebSocketResponseEvents.SCHEDULE_FIRED,
    handleScheduleFired,
  );
  registerUnifiedListeners();

  isInitialized.value = true;
  logger.log("[App] Initialization complete");

  if (currentAbortController === loadingAbortController) {
    isLoading.value = false;
    loadingAbortController = null;
  }
};

const initializeApp = async (): Promise<void> => {
  chatStore.initWebSocket();
};

watch(
  () => websocketClient.isConnected.value,
  (connected) => {
    if (connected) {
      chatStore.unregisterListeners();
      chatStore.registerListeners();

      // 連線就緒後（含 reconnect）立即拉一次 provider capabilities
      providerCapabilityStore.loadFromBackend();
    }
  },
  { flush: "sync" },
);

watch(
  () => chatStore.connectionStatus,
  (newStatus) => {
    if (
      newStatus === "connected" &&
      !chatStore.allHistoryLoaded &&
      !isInitialized.value
    ) {
      loadAppData();
    }

    if (newStatus === "disconnected") {
      websocketClient.off<PodStatusChangedPayload>(
        WebSocketResponseEvents.POD_STATUS_CHANGED,
        handlePodStatusChanged,
      );
      websocketClient.off<ScheduleFiredPayload>(
        WebSocketResponseEvents.SCHEDULE_FIRED,
        handleScheduleFired,
      );
      connectionStore.cleanupWorkflowListeners();
      unregisterUnifiedListeners();
      isInitialized.value = false;
      isLoading.value = false;
      canvasStore.reset();

      if (loadingAbortController) {
        loadingAbortController.abort();
        loadingAbortController = null;
      }
    }
  },
);

watch(
  () => canvasStore.activeCanvasId,
  async (newCanvasId, oldCanvasId) => {
    if (!newCanvasId || newCanvasId === oldCanvasId || !isInitialized.value) {
      return;
    }

    cursorStore.clearAllCursors();
    runStore.resetOnCanvasSwitch();

    podStore.resetForCanvasSwitch();
    connectionStore.resetForCanvasSwitch();
    repositoryStore.resetForCanvasSwitch();
    commandStore.resetForCanvasSwitch();
    chatStore.resetForCanvasSwitch();

    await loadCanvasData();
  },
);

onMounted(() => {
  initializeApp();
});

onUnmounted(() => {
  if (loadingAbortController) {
    loadingAbortController.abort();
    loadingAbortController = null;
  }

  chatStore.disconnectWebSocket();
  websocketClient.off<PodStatusChangedPayload>(
    WebSocketResponseEvents.POD_STATUS_CHANGED,
    handlePodStatusChanged,
  );
  websocketClient.off<ScheduleFiredPayload>(
    WebSocketResponseEvents.SCHEDULE_FIRED,
    handleScheduleFired,
  );
  connectionStore.cleanupWorkflowListeners();
  unregisterUnifiedListeners();
});
</script>

<template>
  <div class="h-screen bg-background overflow-hidden flex flex-col">
    <AppHeader />

    <CanvasSidebar
      :open="canvasStore.isSidebarOpen"
      @update:open="canvasStore.setSidebarOpen"
    />

    <HistoryPanel
      :open="runStore.isHistoryPanelOpen"
      @update:open="runStore.isHistoryPanelOpen = $event"
    />

    <main class="flex-1 relative">
      <CanvasContainer />
    </main>

    <ChatModal
      v-if="selectedPod"
      :pod="selectedPod"
      @close="handleCloseChat"
    />

    <RunChatModal
      v-if="runStore.activeRunChatModal"
      :run-id="runStore.activeRunChatModal.runId"
      :pod-id="runStore.activeRunChatModal.podId"
      :pod-name="activeRunChatPodName"
      :run-status="activeRunChatRunStatus"
      @close="runStore.closeRunChatModal()"
    />

    <Toast />

    <DisconnectOverlay />
  </div>
</template>
