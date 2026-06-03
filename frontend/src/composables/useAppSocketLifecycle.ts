import {
  getCurrentInstance,
  onMounted,
  onUnmounted,
  type Ref,
  watch,
} from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import {
  createWebSocketRequest,
  websocketClient,
  WebSocketRequestEvents,
  WebSocketResponseEvents,
} from "@/services/websocket";
import { useSecurityStore } from "@/stores/securityStore";
import type {
  CanvasSwitchPayload,
  CanvasSwitchedPayload,
} from "@/types/canvas";
import { logger } from "@/utils/logger";

type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

interface AppSocketLifecycleWebSocketClient {
  isConnected: Ref<boolean>;
}

interface AppSocketLifecycleChatStore {
  connectionStatus: ConnectionStatus;
  isSilentReconnectInProgress: boolean;
  initWebSocket: () => void;
  disconnectWebSocket: () => void;
  registerListeners: () => void;
  unregisterListeners: () => void;
}

interface AppSocketLifecycleSecurityStore {
  requiresWorkspaceUnlock: boolean;
  bootstrapAccess: () => Promise<void>;
  registerSocketListeners: () => void;
  unregisterSocketListeners: () => void;
}

interface AppSocketLifecycleCanvasStore {
  activeCanvasId: string | null;
  reset: () => void;
}

interface AppSocketLifecycleCanvasContext {
  chatStore: AppSocketLifecycleChatStore;
  canvasStore: AppSocketLifecycleCanvasStore;
  connectionStore?: {
    cleanupWorkflowListeners?: () => void;
  };
}

interface UseAppSocketLifecycleOptions {
  canvasContext?: AppSocketLifecycleCanvasContext;
  securityStore?: AppSocketLifecycleSecurityStore;
  webSocketClient?: AppSocketLifecycleWebSocketClient;
  isInitialized: Ref<boolean>;
  loadAppData: () => Promise<void>;
  resetInitialization: () => void;
  unregisterAppReadyListeners: () => void;
  requestCanvasSwitch?: (canvasId: string) => Promise<void>;
}

interface UseAppSocketLifecycleReturn {
  initializeSocketLifecycle: () => void;
  cleanupSocketLifecycle: () => void;
  stopSocketLifecycle: () => void;
}

function resolveCanvasContext(
  canvasContext?: AppSocketLifecycleCanvasContext,
): AppSocketLifecycleCanvasContext {
  if (canvasContext) {
    return canvasContext;
  }

  const { chatStore, canvasStore } = useCanvasContext();
  return {
    chatStore,
    canvasStore,
  };
}

function resolveSecurityStore(
  store?: AppSocketLifecycleSecurityStore,
): AppSocketLifecycleSecurityStore {
  return store ?? useSecurityStore();
}

async function requestCanvasSwitch(canvasId: string): Promise<void> {
  await createWebSocketRequest<CanvasSwitchPayload, CanvasSwitchedPayload>({
    requestEvent: WebSocketRequestEvents.CANVAS_SWITCH,
    responseEvent: WebSocketResponseEvents.CANVAS_SWITCHED,
    payload: { canvasId },
  });
}

export function useAppSocketLifecycle(
  options: UseAppSocketLifecycleOptions,
): UseAppSocketLifecycleReturn {
  const {
    chatStore,
    canvasStore,
  } = resolveCanvasContext(options.canvasContext);
  const securityStore = resolveSecurityStore(options.securityStore);
  const client = options.webSocketClient ?? websocketClient;
  const sendCanvasSwitch = options.requestCanvasSwitch ?? requestCanvasSwitch;

  const runGuardedLifecycleTask = (
    label: string,
    task: () => Promise<void>,
    onError?: () => void,
  ): void => {
    void task().catch((error) => {
      logger.warn(`[App] ${label} 失敗`, error);
      onError?.();
    });
  };

  const initializeSocketLifecycle = (): void => {
    chatStore.initWebSocket();
  };

  const cleanupSocketLifecycle = (): void => {
    chatStore.disconnectWebSocket();
    securityStore.unregisterSocketListeners();
    options.unregisterAppReadyListeners();
  };

  const stopConnectedWatch = watch(
    () => client.isConnected.value,
    (connected) => {
      if (!connected) {
        return;
      }

      chatStore.unregisterListeners();
      chatStore.registerListeners();
      securityStore.registerSocketListeners();
    },
    { flush: "sync" },
  );

  const stopConnectionStatusWatch = watch(
    () => chatStore.connectionStatus,
    (newStatus) => {
      if (newStatus === "connected" && !options.isInitialized.value) {
        runGuardedLifecycleTask(
          "Socket 初始化",
          async (): Promise<void> => {
            await securityStore.bootstrapAccess();
            if (
              !securityStore.requiresWorkspaceUnlock &&
              !options.isInitialized.value
            ) {
              await options.loadAppData();
            }
          },
          options.resetInitialization,
        );
      }

      if (
        newStatus === "connected" &&
        options.isInitialized.value &&
        canvasStore.activeCanvasId
      ) {
        const canvasIdToResync = canvasStore.activeCanvasId;
        runGuardedLifecycleTask("靜默重連後補送 CANVAS_SWITCH", async () => {
          await sendCanvasSwitch(canvasIdToResync);
        });
      }

      if (newStatus === "disconnected") {
        if (chatStore.isSilentReconnectInProgress) {
          return;
        }

        options.unregisterAppReadyListeners();
        options.canvasContext?.connectionStore?.cleanupWorkflowListeners?.();
        options.resetInitialization();
        canvasStore.reset();
      }
    },
  );

  const stopSocketLifecycle = (): void => {
    stopConnectedWatch();
    stopConnectionStatusWatch();
  };

  if (getCurrentInstance()) {
    onMounted(initializeSocketLifecycle);
    onUnmounted(() => {
      cleanupSocketLifecycle();
      stopSocketLifecycle();
    });
  }

  return {
    initializeSocketLifecycle,
    cleanupSocketLifecycle,
    stopSocketLifecycle,
  };
}
