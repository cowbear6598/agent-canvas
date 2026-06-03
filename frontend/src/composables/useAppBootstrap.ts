import { computed, ref, type ComputedRef, type Ref } from "vue";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { getAllProviders } from "@/integration/providerRegistry";
import { useConfigStore } from "@/stores/configStore";
import { useCursorStore } from "@/stores/cursorStore";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useOpencodeAliasStore } from "@/stores/opencodeAliasStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useRunStore } from "@/stores/run/runStore";
import { useSecurityStore } from "@/stores/securityStore";
import { logger } from "@/utils/logger";

interface CanvasLike {
  id: string;
}

interface AppBootstrapCanvasContext {
  podStore: {
    loadPodsFromBackend: () => Promise<void>;
    resetForCanvasSwitch: () => void;
  };
  viewportStore: {
    resetToCenter: () => void;
  };
  chatStore: {
    resetForCanvasSwitch: () => void;
  };
  repositoryStore: {
    loadRepositories: () => Promise<void>;
    loadNotesFromBackend: () => Promise<void>;
    resetForCanvasSwitch: () => void;
  };
  connectionStore: {
    loadConnectionsFromBackend: () => Promise<void>;
    resetForCanvasSwitch: () => void;
  };
  canvasStore: {
    activeCanvasId: string | null;
    canvases: CanvasLike[];
    loadCanvases: () => Promise<void>;
    createCanvas: (name: string) => Promise<CanvasLike | null>;
  };
}

interface AppBootstrapStores {
  integrationStore: {
    loadApps: (providerName: string) => Promise<void>;
  };
  runStore: {
    loadRuns: () => Promise<void>;
    resetOnCanvasSwitch: () => void;
  };
  configStore: {
    fetchConfig: () => Promise<void>;
  };
  providerCapabilityStore: {
    loadFromBackend: () => Promise<void>;
  };
  opencodeAliasStore: {
    loadFromBackend: () => Promise<void>;
  };
  securityStore: {
    isBootstrapping: boolean;
    requiresWorkspaceUnlock: boolean;
    ensureInitialCanvasSelection: () => Promise<void>;
    isCanvasAccessible: (canvasId: string) => boolean;
  };
  cursorStore: {
    clearAllCursors: () => void;
  };
}

interface IntegrationProviderLike {
  name: string;
}

interface UseAppBootstrapOptions {
  canvasContext?: AppBootstrapCanvasContext;
  stores?: AppBootstrapStores;
  providers?: IntegrationProviderLike[];
  onInitialized?: () => void;
}

interface UseAppBootstrapReturn {
  isInitialized: Ref<boolean>;
  isLoading: Ref<boolean>;
  showLockedCanvasView: ComputedRef<boolean>;
  loadCanvasData: () => Promise<void>;
  loadAppData: () => Promise<void>;
  resetCanvasScopedState: () => void;
  resetInitialization: () => void;
  abortLoading: () => void;
}

function resolveCanvasContext(
  canvasContext?: AppBootstrapCanvasContext,
): AppBootstrapCanvasContext {
  return canvasContext ?? useCanvasContext();
}

function resolveStores(stores?: AppBootstrapStores): AppBootstrapStores {
  return (
    stores ?? {
      integrationStore: useIntegrationStore(),
      runStore: useRunStore(),
      configStore: useConfigStore(),
      providerCapabilityStore: useProviderCapabilityStore(),
      opencodeAliasStore: useOpencodeAliasStore(),
      securityStore: useSecurityStore(),
      cursorStore: useCursorStore(),
    }
  );
}

export function useAppBootstrap(
  options: UseAppBootstrapOptions = {},
): UseAppBootstrapReturn {
  const {
    podStore,
    viewportStore,
    chatStore,
    repositoryStore,
    connectionStore,
    canvasStore,
  } = resolveCanvasContext(options.canvasContext);
  const {
    integrationStore,
    runStore,
    configStore,
    providerCapabilityStore,
    opencodeAliasStore,
    securityStore,
    cursorStore,
  } = resolveStores(options.stores);
  const providers = options.providers ?? getAllProviders();

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

  const checkAbortedAndCleanup = (controller: AbortController): boolean => {
    if (!controller.signal.aborted) return false;

    if (controller === loadingAbortController) {
      isLoading.value = false;
      loadingAbortController = null;
    }
    return true;
  };

  const abortLoading = (): void => {
    if (!loadingAbortController) return;

    loadingAbortController.abort();
    loadingAbortController = null;
    isLoading.value = false;
  };

  const resetInitialization = (): void => {
    isInitialized.value = false;
    isLoading.value = false;
    abortLoading();
  };

  const resetCanvasScopedState = (): void => {
    cursorStore.clearAllCursors();
    runStore.resetOnCanvasSwitch();
    podStore.resetForCanvasSwitch();
    connectionStore.resetForCanvasSwitch();
    repositoryStore.resetForCanvasSwitch();
    chatStore.resetForCanvasSwitch();
  };

  const loadCanvasData = async (): Promise<void> => {
    await podStore.loadPodsFromBackend();

    viewportStore.resetToCenter();

    await Promise.all([
      (async (): Promise<void> => {
        await repositoryStore.loadRepositories();
        await repositoryStore.loadNotesFromBackend();
      })(),
      connectionStore.loadConnectionsFromBackend(),
      ...providers.map((provider) => integrationStore.loadApps(provider.name)),
    ]);

    await runStore.loadRuns();
  };

  const finishLoading = (controller: AbortController): void => {
    if (controller !== loadingAbortController) return;

    isLoading.value = false;
    loadingAbortController = null;
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

    abortLoading();

    loadingAbortController = new AbortController();
    const currentAbortController = loadingAbortController;

    isLoading.value = true;

    if (checkAbortedAndCleanup(currentAbortController)) return;

    logger.log("[App] Loading config...");
    await configStore.fetchConfig().catch(() => {
      logger.warn("[App] 載入全域設定失敗，使用預設值");
    });

    logger.log("[App] Loading canvases and provider metadata...");
    await Promise.all([
      canvasStore.loadCanvases(),
      providerCapabilityStore.loadFromBackend(),
      opencodeAliasStore.loadFromBackend(),
    ]);

    if (checkAbortedAndCleanup(currentAbortController)) return;

    if (canvasStore.canvases.length === 0) {
      logger.log("[App] No canvases found, creating default canvas...");
      const defaultCanvas = await canvasStore.createCanvas("Default");
      if (!defaultCanvas) {
        logger.error("[App] Failed to create default canvas");
        finishLoading(currentAbortController);
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
      finishLoading(currentAbortController);
      return;
    }

    logger.log("[App] Active canvas:", canvasStore.activeCanvasId);
    logger.log("[App] Loading canvas data...");
    await loadCanvasData();

    if (checkAbortedAndCleanup(currentAbortController)) return;

    options.onInitialized?.();
    isInitialized.value = true;
    logger.log("[App] Initialization complete");

    finishLoading(currentAbortController);
  };

  return {
    isInitialized,
    isLoading,
    showLockedCanvasView,
    loadCanvasData,
    loadAppData,
    resetCanvasScopedState,
    resetInitialization,
    abortLoading,
  };
}
