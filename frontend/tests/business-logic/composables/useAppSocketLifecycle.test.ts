import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import { useAppSocketLifecycle } from "@/composables/useAppSocketLifecycle";
import { logger } from "@/utils/logger";

vi.mock("@/utils/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const flushAsyncWatchers = async (): Promise<void> => {
  await nextTick();
  await Promise.resolve();
};

function createSocketLifecycleOptions() {
  const chatStore = reactive({
    connectionStatus: "disconnected" as
      | "connected"
      | "connecting"
      | "disconnected"
      | "error",
    isSilentReconnectInProgress: false,
    initWebSocket: vi.fn(),
    disconnectWebSocket: vi.fn(),
    registerListeners: vi.fn(),
    unregisterListeners: vi.fn(),
  });
  const canvasStore = reactive({
    activeCanvasId: "canvas-1" as string | null,
    reset: vi.fn(),
  });

  return {
    canvasContext: {
      chatStore,
      canvasStore,
    },
    securityStore: reactive({
      requiresWorkspaceUnlock: false,
      bootstrapAccess: vi.fn(async () => undefined),
      registerSocketListeners: vi.fn(),
      unregisterSocketListeners: vi.fn(),
    }),
    webSocketClient: {
      isConnected: ref(false),
    },
    isInitialized: ref(false),
    loadAppData: vi.fn(async () => undefined),
    resetInitialization: vi.fn(),
    unregisterAppReadyListeners: vi.fn(),
    requestCanvasSwitch: vi.fn(async () => undefined),
  };
}

describe("useAppSocketLifecycle", () => {
  it("WebSocket 連線恢復時應重新註冊 socket listeners", () => {
    const options = createSocketLifecycleOptions();
    const lifecycle = useAppSocketLifecycle(options);

    options.webSocketClient.isConnected.value = true;

    expect(options.canvasContext.chatStore.unregisterListeners).toHaveBeenCalledOnce();
    expect(options.canvasContext.chatStore.registerListeners).toHaveBeenCalledOnce();
    expect(options.securityStore.registerSocketListeners).toHaveBeenCalledOnce();

    lifecycle.stopSocketLifecycle();
  });

  it("初始化後重連成功時應補送目前 canvas switch", async () => {
    const options = createSocketLifecycleOptions();
    options.isInitialized.value = true;
    options.canvasContext.canvasStore.activeCanvasId = "canvas-2";
    const lifecycle = useAppSocketLifecycle(options);

    options.canvasContext.chatStore.connectionStatus = "connected";
    await flushAsyncWatchers();

    expect(options.requestCanvasSwitch).toHaveBeenCalledWith("canvas-2");

    lifecycle.stopSocketLifecycle();
  });

  it("非靜默斷線時應清理 listener 並重置初始化與 canvas", async () => {
    const options = createSocketLifecycleOptions();
    options.canvasContext.chatStore.connectionStatus = "connected";
    const lifecycle = useAppSocketLifecycle(options);

    options.canvasContext.chatStore.connectionStatus = "disconnected";
    await nextTick();

    expect(options.unregisterAppReadyListeners).toHaveBeenCalledOnce();
    expect(options.resetInitialization).toHaveBeenCalledOnce();
    expect(options.canvasContext.canvasStore.reset).toHaveBeenCalledOnce();

    lifecycle.stopSocketLifecycle();
  });

  it("bootstrapAccess 失敗時應記錄錯誤並重置初始化狀態", async () => {
    const options = createSocketLifecycleOptions();
    options.securityStore.bootstrapAccess = vi.fn(async () => {
      throw new Error("bootstrap failed");
    });
    const lifecycle = useAppSocketLifecycle(options);

    options.canvasContext.chatStore.connectionStatus = "connected";
    await flushAsyncWatchers();

    expect(logger.warn).toHaveBeenCalledWith(
      "[App] Socket 初始化 失敗",
      expect.any(Error),
    );
    expect(options.resetInitialization).toHaveBeenCalledOnce();

    lifecycle.stopSocketLifecycle();
  });
});
