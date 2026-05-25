import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { useAppBootstrap } from "@/composables/useAppBootstrap";

vi.mock("@/utils/logger", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createDeferred(): {
  promise: Promise<undefined>;
  resolve: () => void;
} {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<undefined>((resolve) => {
    resolvePromise = () => resolve(undefined);
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

function createBootstrapOptions() {
  const canvasStore = reactive({
    activeCanvasId: null as string | null,
    canvases: [{ id: "canvas-1" }],
    loadCanvases: vi.fn(async () => undefined),
    createCanvas: vi.fn(async (name: string) => ({ id: name })),
  });
  const securityStore = reactive({
    isBootstrapping: false,
    requiresWorkspaceUnlock: false,
    ensureInitialCanvasSelection: vi.fn(async () => {
      canvasStore.activeCanvasId = "canvas-1";
    }),
    isCanvasAccessible: vi.fn(() => true),
  });
  const onInitialized = vi.fn();

  return {
    canvasContext: {
      podStore: {
        loadPodsFromBackend: vi.fn(async () => undefined),
        resetForCanvasSwitch: vi.fn(),
      },
      viewportStore: {
        resetToCenter: vi.fn(),
      },
      chatStore: {
        resetForCanvasSwitch: vi.fn(),
      },
      repositoryStore: {
        loadRepositories: vi.fn(async () => undefined),
        loadNotesFromBackend: vi.fn(async () => undefined),
        resetForCanvasSwitch: vi.fn(),
      },
      connectionStore: {
        loadConnectionsFromBackend: vi.fn(async () => undefined),
        setupWorkflowListeners: vi.fn(),
        resetForCanvasSwitch: vi.fn(),
      },
      canvasStore,
    },
    stores: {
      integrationStore: {
        loadApps: vi.fn(async () => undefined),
      },
      runStore: {
        loadRuns: vi.fn(async () => undefined),
        resetOnCanvasSwitch: vi.fn(),
      },
      configStore: {
        fetchConfig: vi.fn(async () => undefined),
      },
      providerCapabilityStore: {
        loadFromBackend: vi.fn(async () => undefined),
      },
      opencodeAliasStore: {
        loadFromBackend: vi.fn(async () => undefined),
      },
      securityStore,
      cursorStore: {
        clearAllCursors: vi.fn(),
      },
    },
    providers: [{ name: "slack" }, { name: "jira" }],
    onInitialized,
  };
}

describe("useAppBootstrap", () => {
  it("loadAppData 成功時應載入全域設定、canvas 與目前 canvas 資料", async () => {
    const options = createBootstrapOptions();
    const bootstrap = useAppBootstrap(options);

    await bootstrap.loadAppData();

    expect(options.stores.configStore.fetchConfig).toHaveBeenCalledOnce();
    expect(options.canvasContext.canvasStore.loadCanvases).toHaveBeenCalledOnce();
    expect(
      options.stores.providerCapabilityStore.loadFromBackend,
    ).toHaveBeenCalledOnce();
    expect(options.stores.opencodeAliasStore.loadFromBackend).toHaveBeenCalledOnce();
    expect(
      options.stores.securityStore.ensureInitialCanvasSelection,
    ).toHaveBeenCalledOnce();
    expect(options.canvasContext.podStore.loadPodsFromBackend).toHaveBeenCalledOnce();
    expect(options.canvasContext.viewportStore.resetToCenter).toHaveBeenCalledOnce();
    expect(
      options.canvasContext.repositoryStore.loadRepositories,
    ).toHaveBeenCalledOnce();
    expect(
      options.canvasContext.repositoryStore.loadNotesFromBackend,
    ).toHaveBeenCalledOnce();
    expect(
      options.canvasContext.connectionStore.loadConnectionsFromBackend,
    ).toHaveBeenCalledOnce();
    expect(options.stores.integrationStore.loadApps).toHaveBeenCalledWith("slack");
    expect(options.stores.integrationStore.loadApps).toHaveBeenCalledWith("jira");
    expect(options.canvasContext.connectionStore.setupWorkflowListeners).toHaveBeenCalledOnce();
    expect(options.stores.runStore.loadRuns).toHaveBeenCalledOnce();
    expect(options.onInitialized).toHaveBeenCalledOnce();
    expect(bootstrap.isInitialized.value).toBe(true);
    expect(bootstrap.isLoading.value).toBe(false);
  });

  it("loadAppData 進行中應維持載入中狀態，完成後才標記初始化", async () => {
    const options = createBootstrapOptions();
    const fetchConfigDeferred = createDeferred();
    const loadCanvasesDeferred = createDeferred();
    options.stores.configStore.fetchConfig.mockImplementationOnce(
      () => fetchConfigDeferred.promise,
    );
    options.canvasContext.canvasStore.loadCanvases.mockImplementationOnce(
      () => loadCanvasesDeferred.promise,
    );
    const bootstrap = useAppBootstrap(options);

    const loadingPromise = bootstrap.loadAppData();
    await nextTick();

    expect(bootstrap.isLoading.value).toBe(true);
    expect(bootstrap.isInitialized.value).toBe(false);
    expect(
      options.stores.providerCapabilityStore.loadFromBackend,
    ).not.toHaveBeenCalled();
    expect(options.stores.opencodeAliasStore.loadFromBackend).not.toHaveBeenCalled();

    fetchConfigDeferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(
      options.stores.providerCapabilityStore.loadFromBackend,
    ).toHaveBeenCalledOnce();
    expect(options.stores.opencodeAliasStore.loadFromBackend).toHaveBeenCalledOnce();

    loadCanvasesDeferred.resolve();
    await loadingPromise;

    expect(bootstrap.isLoading.value).toBe(false);
    expect(bootstrap.isInitialized.value).toBe(true);
  });
});
