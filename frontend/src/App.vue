<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onUnmounted,
} from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useAppBootstrap } from "@/composables/useAppBootstrap";
import { useAppSocketLifecycle } from "@/composables/useAppSocketLifecycle";
import { useCanvasSessionLifecycle } from "@/composables/useCanvasSessionLifecycle";
import {
  websocketClient,
  WebSocketResponseEvents,
} from "@/services/websocket";
import type { ScheduleFiredPayload } from "@/types/websocket";
import type { PodGoal } from "@/types";
import AppHeader from "@/components/layout/AppHeader.vue";
import CanvasContainer from "@/components/canvas/CanvasContainer.vue";
import { Toast } from "@/components/ui/toast";
import { useCopyPaste } from "@/composables/canvas";
import { useUnifiedEventListeners } from "@/composables/useUnifiedEventListeners";

import { useRunStore } from "@/stores/run/runStore";
import { useSecurityStore } from "@/stores/securityStore";

const CanvasSidebar = defineAsyncComponent(
  () => import("@/components/canvas/CanvasSidebar.vue"),
);
const ChatModal = defineAsyncComponent(
  () => import("@/components/chat/ChatModal.vue"),
);
const GoalEditorModal = defineAsyncComponent(
  () => import("@/components/pod/GoalEditorModal.vue"),
);
const HistoryPanel = defineAsyncComponent(
  () => import("@/components/run/HistoryPanel.vue"),
);
const RunChatModal = defineAsyncComponent(
  () => import("@/components/run/RunChatModal.vue"),
);
const DisconnectOverlay = defineAsyncComponent(
  () => import("@/components/ui/DisconnectOverlay.vue"),
);
const WorkspaceUnlockView = defineAsyncComponent(
  () => import("@/components/security/WorkspaceUnlockView.vue"),
);
const CanvasUnlockDialog = defineAsyncComponent(
  () => import("@/components/security/CanvasUnlockDialog.vue"),
);
const LockedCanvasView = defineAsyncComponent(
  () => import("@/components/security/LockedCanvasView.vue"),
);

const {
  podStore,
  canvasStore,
} = useCanvasContext();

const runStore = useRunStore();
const securityStore = useSecurityStore();

const selectedPod = computed(() => podStore.selectedPod);
const goalEditorPod = computed(() => podStore.goalEditorPod);

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

const handleCloseChat = (): void => {
  podStore.selectPod(null);
};

const handleGoalEditorSubmit = async (goal: PodGoal | null): Promise<void> => {
  const pod = goalEditorPod.value;
  if (!pod) return;

  const updatedPod = await podStore.setGoalWithBackend(pod.id, goal);
  if (!updatedPod) return;

  podStore.closeGoalEditor();
};

const handleScheduleFired = (payload: ScheduleFiredPayload): void => {
  const pod = podStore.getPodById(payload.podId);
  if (pod) {
    podStore.triggerScheduleFiredAnimation(payload.podId);
  }
};

const registerAppReadyListeners = (): void => {
  websocketClient.on<ScheduleFiredPayload>(
    WebSocketResponseEvents.SCHEDULE_FIRED,
    handleScheduleFired,
  );
  registerUnifiedListeners();
};

const unregisterAppReadyListeners = (): void => {
  websocketClient.off<ScheduleFiredPayload>(
    WebSocketResponseEvents.SCHEDULE_FIRED,
    handleScheduleFired,
  );
  unregisterUnifiedListeners();
};

const {
  isInitialized,
  showLockedCanvasView,
  loadCanvasData,
  loadAppData,
  resetCanvasScopedState,
  resetInitialization,
  abortLoading,
} = useAppBootstrap({
  onInitialized: registerAppReadyListeners,
});

useAppSocketLifecycle({
  isInitialized,
  loadAppData,
  resetInitialization,
  unregisterAppReadyListeners,
});

useCanvasSessionLifecycle({
  isInitialized,
  resetCanvasScopedState,
  loadCanvasData,
});

onUnmounted(() => {
  abortLoading();
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

    <GoalEditorModal
      v-if="goalEditorPod"
      :open="true"
      :pod="goalEditorPod"
      @update:open="podStore.closeGoalEditor()"
      @submit="handleGoalEditorSubmit"
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
