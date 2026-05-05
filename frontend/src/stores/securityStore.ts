import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  getWorkspaceAccessState,
  unlockWorkspace as unlockWorkspaceApi,
  unlockCanvas as unlockCanvasApi,
} from "@/services/securityApi";
import { getConnectionSecurityInfo } from "@/services/connectionSecurity";
import { websocketClient, WebSocketResponseEvents } from "@/services/websocket";
import type {
  AuthCanvasAccessResetPayload,
  AuthSessionResetPayload,
} from "@/types/websocket/responses";
import type { CanvasCreatedPayload } from "@/types/canvas";
import { useCanvasStore } from "@/stores/canvasStore";

type BootStatus =
  | "idle"
  | "bootstrapping"
  | "locked"
  | "ready"
  | "reconnecting";

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export const useSecurityStore = defineStore("security", () => {
  const workspacePasswordEnabled = ref(false);
  const workspaceUnlocked = ref(false);
  const unlockingCanvasId = ref<string | null>(null);
  const unlockedCanvasIds = ref<string[]>([]);
  const bootStatus = ref<BootStatus>("idle");
  const lastUnlockError = ref<string | null>(null);
  const showTransportRiskWarning = ref(false);
  const pendingReconnectGrant = ref<string | null>(null);
  const isUnlockingWorkspace = ref(false);
  const isUnlockingCanvas = ref(false);
  const listenersRegistered = ref(false);

  const requiresWorkspaceUnlock = computed(
    () => workspacePasswordEnabled.value && !workspaceUnlocked.value,
  );
  const shouldShowWorkspaceUnlock = computed(
    () => bootStatus.value === "locked" && requiresWorkspaceUnlock.value,
  );
  const isBootstrapping = computed(
    () =>
      bootStatus.value === "idle" ||
      bootStatus.value === "bootstrapping" ||
      bootStatus.value === "reconnecting",
  );

  const setUnlockedCanvasIds = (canvasIds: string[]): void => {
    unlockedCanvasIds.value = Array.from(new Set(canvasIds));
  };

  const removeUnlockedCanvasId = (canvasId: string): void => {
    unlockedCanvasIds.value = unlockedCanvasIds.value.filter(
      (id) => id !== canvasId,
    );
  };

  const isCanvasUnlocked = (canvasId: string): boolean => {
    return unlockedCanvasIds.value.includes(canvasId);
  };

  const isCanvasAccessible = (canvasId: string): boolean => {
    const canvasStore = useCanvasStore();
    const canvas = canvasStore.canvases.find((item) => item.id === canvasId);
    if (!canvas) {
      return false;
    }

    return !canvas.isProtected || isCanvasUnlocked(canvasId);
  };

  const ensureInitialCanvasSelection = async (): Promise<void> => {
    const canvasStore = useCanvasStore();
    if (canvasStore.activeCanvasId) {
      return;
    }

    const firstAccessibleCanvas = canvasStore.canvases.find(
      (canvas) => !canvas.isProtected || isCanvasUnlocked(canvas.id),
    );
    if (!firstAccessibleCanvas) {
      return;
    }

    await canvasStore.switchCanvas(firstAccessibleCanvas.id);
  };

  const bootstrapAccess = async (): Promise<void> => {
    bootStatus.value = "bootstrapping";
    lastUnlockError.value = null;

    const response = await getWorkspaceAccessState();
    const fallbackTransport = getConnectionSecurityInfo();

    workspacePasswordEnabled.value = response.hasWorkspacePassword ?? false;
    workspaceUnlocked.value =
      response.workspaceUnlocked ?? !workspacePasswordEnabled.value;
    setUnlockedCanvasIds(response.unlockedCanvasIds ?? []);
    showTransportRiskWarning.value =
      response.transportSecurity?.showInsecureTransportWarning ??
      fallbackTransport.showTransportRiskWarning;

    bootStatus.value =
      workspacePasswordEnabled.value && !workspaceUnlocked.value
        ? "locked"
        : "ready";
  };

  const unlockWorkspace = async (password: string): Promise<void> => {
    isUnlockingWorkspace.value = true;
    lastUnlockError.value = null;

    try {
      const response = await unlockWorkspaceApi(password);
      if (!response.reconnectGrant) {
        throw new Error("Missing reconnect grant");
      }

      pendingReconnectGrant.value = response.reconnectGrant;
      bootStatus.value = "reconnecting";
      websocketClient.forceReconnectWithGrant(response.reconnectGrant);
      pendingReconnectGrant.value = null;
    } catch (error) {
      lastUnlockError.value = normalizeError(error);
      bootStatus.value = "locked";
      throw error;
    } finally {
      isUnlockingWorkspace.value = false;
    }
  };

  const requestCanvasAccess = async (canvasId: string): Promise<void> => {
    const canvasStore = useCanvasStore();
    const canvas = canvasStore.canvases.find((item) => item.id === canvasId);
    if (!canvas) {
      return;
    }

    if (!canvas.isProtected || isCanvasUnlocked(canvasId)) {
      await canvasStore.switchCanvas(canvasId);
      return;
    }

    lastUnlockError.value = null;
    unlockingCanvasId.value = canvasId;
  };

  const unlockCanvas = async (password: string): Promise<void> => {
    if (!unlockingCanvasId.value) {
      return;
    }

    isUnlockingCanvas.value = true;
    lastUnlockError.value = null;

    try {
      const response = await unlockCanvasApi(unlockingCanvasId.value, password);
      const canvasId = response.canvasId ?? unlockingCanvasId.value;
      setUnlockedCanvasIds(response.unlockedCanvasIds ?? [canvasId]);
      unlockingCanvasId.value = null;
      await useCanvasStore().switchCanvas(canvasId);
    } catch (error) {
      lastUnlockError.value = normalizeError(error);
      throw error;
    } finally {
      isUnlockingCanvas.value = false;
    }
  };

  const closeCanvasUnlockDialog = (): void => {
    unlockingCanvasId.value = null;
    lastUnlockError.value = null;
  };

  const clearAccessState = (): void => {
    // 無條件重設為鎖定狀態，讓後續 bootstrapAccess() 重新確立正確狀態。
    // 不依賴 workspacePasswordEnabled 當下值，避免 AUTH_SESSION_RESET
    // 在 bootstrapAccess 完成前到達時短暫繞過 workspace 鎖定畫面。
    workspaceUnlocked.value = false;
    unlockingCanvasId.value = null;
    unlockedCanvasIds.value = [];
    lastUnlockError.value = null;
    bootStatus.value = "locked";
  };

  const handleSessionReset = (_payload: AuthSessionResetPayload): void => {
    clearAccessState();
  };

  const handleCanvasAccessReset = async (
    payload: AuthCanvasAccessResetPayload,
  ): Promise<void> => {
    removeUnlockedCanvasId(payload.canvasId);

    const canvasStore = useCanvasStore();
    if (canvasStore.activeCanvasId !== payload.canvasId) {
      return;
    }

    canvasStore.setActiveCanvasId(null);
    await ensureInitialCanvasSelection();
  };

  const handleCanvasSecurityUpdated = (payload: CanvasCreatedPayload): void => {
    if (!payload.canvas) {
      return;
    }

    if (!payload.canvas.isProtected) {
      removeUnlockedCanvasId(payload.canvas.id);
    }
  };

  const registerSocketListeners = (): void => {
    if (listenersRegistered.value) {
      return;
    }

    websocketClient.on(
      WebSocketResponseEvents.AUTH_SESSION_RESET,
      handleSessionReset,
    );
    websocketClient.on(
      WebSocketResponseEvents.AUTH_CANVAS_ACCESS_RESET,
      handleCanvasAccessReset,
    );
    websocketClient.on(
      WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
      handleCanvasSecurityUpdated,
    );
    listenersRegistered.value = true;
  };

  const unregisterSocketListeners = (): void => {
    if (!listenersRegistered.value) {
      return;
    }

    websocketClient.off(
      WebSocketResponseEvents.AUTH_SESSION_RESET,
      handleSessionReset,
    );
    websocketClient.off(
      WebSocketResponseEvents.AUTH_CANVAS_ACCESS_RESET,
      handleCanvasAccessReset,
    );
    websocketClient.off(
      WebSocketResponseEvents.CANVAS_SECURITY_UPDATED,
      handleCanvasSecurityUpdated,
    );
    listenersRegistered.value = false;
  };

  return {
    workspacePasswordEnabled,
    workspaceUnlocked,
    unlockingCanvasId,
    unlockedCanvasIds,
    bootStatus,
    lastUnlockError,
    showTransportRiskWarning,
    pendingReconnectGrant,
    isUnlockingWorkspace,
    isUnlockingCanvas,
    requiresWorkspaceUnlock,
    shouldShowWorkspaceUnlock,
    isBootstrapping,
    bootstrapAccess,
    unlockWorkspace,
    unlockCanvas,
    requestCanvasAccess,
    closeCanvasUnlockDialog,
    clearAccessState,
    ensureInitialCanvasSelection,
    isCanvasUnlocked,
    isCanvasAccessible,
    registerSocketListeners,
    unregisterSocketListeners,
  };
});
