<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import {
  createWebSocketRequest,
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type { ScheduleFiredPayload } from "@/types/websocket";
import type {
  CanvasSwitchPayload,
  CanvasSwitchedPayload,
} from "@/types/canvas";
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
import { useCursorStore } from "@/stores/cursorStore";
import { logger } from "@/utils/logger";

import { useIntegrationStore } from "@/stores/integrationStore";
import { getAllProviders } from "@/integration/providerRegistry";
import { useRunStore } from "@/stores/run/runStore";
import { useConfigStore } from "@/stores/configStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import { useSecurityStore } from "@/stores/securityStore";
import WorkspaceUnlockView from "@/components/security/WorkspaceUnlockView.vue";
import CanvasUnlockDialog from "@/components/security/CanvasUnlockDialog.vue";
import LockedCanvasView from "@/components/security/LockedCanvasView.vue";

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
const opencodeAliasStore = useOpencodeAliasStore();
const securityStore = useSecurityStore();

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

const showLockedCanvasView = computed(() => {
  if (
    !isInitialized.value ||
    securityStore.isBootstrapping ||
    securityStore.requiresWorkspaceUnlock ||
    canvasStore.activeCanvasId ||
    canvasStore.canvases.length === 0
  ) {
    return false;
  }

  return !canvasStore.canvases.some((canvas) =>
    securityStore.isCanvasAccessible(canvas.id),
  );
});

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

  await runStore.loadRuns();
};

const handleCloseChat = (): void => {
  podStore.selectPod(null);
};

const handleScheduleFired = (payload: ScheduleFiredPayload): void => {
  const pod = podStore.getPodById(payload.podId);
  if (pod) {
    podStore.triggerScheduleFiredAnimation(payload.podId);
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

const resetCanvasScopedState = (): void => {
  cursorStore.clearAllCursors();
  runStore.resetOnCanvasSwitch();
  podStore.resetForCanvasSwitch();
  connectionStore.resetForCanvasSwitch();
  repositoryStore.resetForCanvasSwitch();
  commandStore.resetForCanvasSwitch();
  chatStore.resetForCanvasSwitch();
};

const loadAppData = async (): Promise<void> => {
  if (
    isInitialized.value ||
    isLoading.value ||
    securityStore.requiresWorkspaceUnlock ||
    securityStore.isBootstrapping
  ) {
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
  await providerCapabilityStore.loadFromBackend();
  await opencodeAliasStore.loadFromBackend();

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
    await securityStore.ensureInitialCanvasSelection();
  }

  if (!canvasStore.activeCanvasId) {
    isInitialized.value = true;
    logger.log("[App] No accessible canvas selected after initialization");
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
      securityStore.registerSocketListeners();
    }
  },
  { flush: "sync" },
);

watch(
  () => chatStore.connectionStatus,
  (newStatus) => {
    if (newStatus === "connected" && !isInitialized.value) {
      void (async (): Promise<void> => {
        await securityStore.bootstrapAccess();
        if (!securityStore.requiresWorkspaceUnlock && !isInitialized.value) {
          await loadAppData();
        }
      })();
    }

    if (
      newStatus === "connected" &&
      isInitialized.value &&
      canvasStore.activeCanvasId
    ) {
      // 靜默重連（切換瀏覽器分頁觸發 forceReconnect）完成後，後端 activeCanvasMap 的舊紀錄
      // 已隨舊 socket 刪除，新 connectionId 沒有任何 canvas 對應。
      // 主動補送 CANVAS_SWITCH 讓後端重新建立記錄，否則任何走 getCanvasId() 的 handler
      // 都會回傳「找不到使用中的 Canvas」。
      // 注意：首次連線時 isInitialized 為 false，不會走這裡，不影響正常初始化流程。
      const canvasIdToResync = canvasStore.activeCanvasId;
      void (async (): Promise<void> => {
        try {
          await createWebSocketRequest<
            CanvasSwitchPayload,
            CanvasSwitchedPayload
          >({
            requestEvent: WebSocketRequestEvents.CANVAS_SWITCH,
            responseEvent: WebSocketResponseEvents.CANVAS_SWITCHED,
            payload: { canvasId: canvasIdToResync },
          });
        } catch (error) {
          // 補送失敗只記 warn，避免打擾使用者；下次連線恢復時還會再試一次
          logger.warn("[App] 靜默重連後補送 CANVAS_SWITCH 失敗", error);
        }
      })();
    }

    if (newStatus === "disconnected") {
      // 靜默重連（visibilitychange / heartbeat 觸發的 forceReconnect）期間不重置 UI 狀態，
      // 避免 activeCanvasId、isSidebarOpen、HistoryPanel 等使用者狀態被連帶清除。
      // 真正的斷線（連線錯誤、後端關閉）isSilentReconnectInProgress 為 false，仍會走完整 cleanup。
      if (chatStore.isSilentReconnectInProgress) {
        return;
      }

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
    if (newCanvasId === oldCanvasId || !isInitialized.value) {
      return;
    }

    resetCanvasScopedState();

    if (!newCanvasId) {
      return;
    }

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
  securityStore.unregisterSocketListeners();
  websocketClient.off<ScheduleFiredPayload>(
    WebSocketResponseEvents.SCHEDULE_FIRED,
    handleScheduleFired,
  );
  connectionStore.cleanupWorkflowListeners();
  unregisterUnifiedListeners();
});
</script>

<template>
  <WorkspaceUnlockView v-if="securityStore.shouldShowWorkspaceUnlock" />

  <div
    v-else-if="securityStore.isBootstrapping"
    class="flex min-h-screen items-center justify-center bg-background"
  >
    <div class="text-sm text-muted-foreground">
      Loading workspace...
    </div>
  </div>

  <div
    v-else
    class="h-screen bg-background overflow-hidden flex flex-col"
  >
    <AppHeader />

    <CanvasSidebar
      :open="canvasStore.isSidebarOpen"
      @update:open="canvasStore.setSidebarOpen"
    />

    <HistoryPanel
      :open="runStore.isHistoryPanelOpen"
      @update:open="runStore.isHistoryPanelOpen = $event"
    />

    <main class="flex-1 relative overflow-hidden">
      <LockedCanvasView v-if="showLockedCanvasView" />
      <CanvasContainer v-else />
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
    <CanvasUnlockDialog />
  </div>
</template>
