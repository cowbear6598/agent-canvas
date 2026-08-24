<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useEscapeClose } from "@/composables/useEscapeClose";
import { useI18n } from "vue-i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { updatePodMcpServers as updatePodMcpServersApi } from "@/services/mcpApi";
import { listPodMcpAvailability } from "@/services/managedMcpApi";
import McpServerRow from "@/components/pod/McpServerRow.vue";
import { logger } from "@/utils/logger";
import { usePodStore } from "@/stores/pod";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { useOptimisticToggle } from "@/composables/pod/useOptimisticToggle";
import type { McpSource, PodMcpAvailabilityItem } from "@/types/mcp";
import type { PodProvider } from "@/types/pod";
import { shouldPreservePodResourceMenu } from "@/lib/podResourceMenu";

const props = defineProps<{
  podId: string;
  anchorRect: DOMRect;
  provider: PodProvider;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const podStore = usePodStore();
const { runToggle } = useOptimisticToggle();

const availableMcpServers = ref<PodMcpAvailabilityItem[]>([]);
const loading = ref<boolean>(false);
const loadFailed = ref<boolean>(false);
const GOAL_RUNTIME_SERVER_NAME = "agent_canvas_goal";
const PLUGIN_MCP_SERVER_NAME = "agent_canvas_plugin";
const AGENT_CANVAS_MCP_SERVER_NAME = "agent_canvas";

/**
 * 取得 pod 目前選定的 MCP server 名稱清單。
 *
 * 為什麼用 podStore 作為唯一來源：
 * - availability fetch 是一次性的，server.selected 為 fetch 時的快照，後續 toggle 不會更新；
 * - 過去額外維護 localMcpServerNames 與 server.selected 一起 OR 判斷，
 *   會在 toggle off 後仍因 server.selected=true 而顯示為勾選。
 * 改為一律從 podStore 衍生狀態，optimistic update 透過 podStore.updatePodMcpServers 流入。
 */
const pod = computed(() => podStore.getPodById(props.podId));
const podMcpServerNames = computed<string[]>(() => pod.value?.mcpServerNames ?? []);
const podCodexMcpServerKeys = computed<string[]>(
  () => pod.value?.codexMcpServerKeys ?? [],
);

/** 搜尋框輸入字串 */
const searchQuery = ref<string>("");
/** 搜尋框 input 元素 ref，用於自動 focus */
const searchInputRef = ref<HTMLInputElement | null>(null);

function isSystemLockedServer(server: PodMcpAvailabilityItem): boolean {
  return server.locked === true;
}

function isGoalRuntimeServer(server: PodMcpAvailabilityItem): boolean {
  return server.system === true && server.name === GOAL_RUNTIME_SERVER_NAME;
}

function isPluginMcpServer(server: PodMcpAvailabilityItem): boolean {
  return server.system === true && server.name === PLUGIN_MCP_SERVER_NAME;
}

function isAgentCanvasMcpServer(server: PodMcpAvailabilityItem): boolean {
  return server.system === true && server.name === AGENT_CANVAS_MCP_SERVER_NAME;
}

function resolveServerLabel(server: PodMcpAvailabilityItem): string {
  if (isGoalRuntimeServer(server)) return t("pod.slot.goalMcpLabel");
  if (isPluginMcpServer(server)) return t("pod.slot.pluginMcpLabel");
  if (isAgentCanvasMcpServer(server)) return t("pod.slot.agentCanvasMcpLabel");
  return server.name;
}

/** 依 searchQuery 過濾 MCP server 清單（不分大小寫比對名稱） */
const filteredMcpServers = computed<PodMcpAvailabilityItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return availableMcpServers.value;
  return availableMcpServers.value.filter(
    (server) =>
      resolveServerLabel(server).toLowerCase().includes(query) ||
      server.name.toLowerCase().includes(query),
  );
});

const MCP_SOURCE_ORDER: McpSource[] = ["canvas", "official", "user"];
const mcpGroups = computed(() =>
  MCP_SOURCE_ORDER.map((source) => ({
    source,
    items: filteredMcpServers.value.filter((server) => server.source === source),
  })).filter((group) => group.items.length > 0),
);

const showSearchEmpty = computed(
  () =>
    !loading.value &&
    !loadFailed.value &&
    searchQuery.value.trim().length > 0 &&
    filteredMcpServers.value.length === 0,
);

const showEmptyState = computed(
  () =>
    !loading.value &&
    !loadFailed.value &&
    searchQuery.value.trim().length === 0 &&
    availableMcpServers.value.length === 0,
);

/** podStore 的 mcpServerNames 轉成 Set，讓 v-for 中的查找從 O(n) 降為 O(1) */
const mcpServerNamesSet = computed(() => new Set(podMcpServerNames.value));
const codexMcpServerKeysSet = computed(
  () => new Set(podCodexMcpServerKeys.value),
);

const rootRef = ref<HTMLElement | null>(null);

const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  if (shouldPreservePodResourceMenu(event, props.podId)) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

onMounted(async () => {
  // 載入 pod-scoped MCP availability 清單；勾選狀態由 podStore 衍生，不再 copy 一份到 local。
  loading.value = true;
  try {
    availableMcpServers.value = await listPodMcpAvailability(
      props.podId,
      props.provider,
    );
  } catch (err) {
    logger.warn(
      "[McpPopover] Failed to load MCP availability:",
      err instanceof Error ? err.message : String(err),
    );
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }

  await nextTick();
  searchInputRef.value?.focus();

  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleMousedown, true);
});

useEscapeClose(() => emit("close"));

const buildNextSelection = (
  current: string[],
  value: string,
  enabled: boolean,
): string[] => {
  if (enabled) {
    return current.includes(value) ? [...current] : [...current, value];
  }
  return current.filter((item) => item !== value);
};

/** 從例外取得錯誤描述字串；一律使用 i18n fallback，避免後端 message 未過濾直接洩漏到 UI */
const resolveMcpErrorDescription = (_err: unknown): string =>
  t("pod.slot.mcpToggleFailed");

function isServerChecked(server: PodMcpAvailabilityItem): boolean {
  if (isAgentCanvasMcpServer(server)) {
    return pod.value?.agentCanvasMcpEnabled === true;
  }
  if (server.source !== "canvas") {
    return server.selectable && codexMcpServerKeysSet.value.has(server.key);
  }
  return (
    isSystemLockedServer(server) || mcpServerNamesSet.value.has(server.name)
  );
}

function resolveDisabledReason(server: PodMcpAvailabilityItem): string | null {
  if (server.disabledReasonKey === "codexGloballyDisabled") {
    return t("pod.slot.mcpCodexGloballyDisabled");
  }
  return server.disabledReason;
}

function isServerDisabled(server: PodMcpAvailabilityItem): boolean {
  return server.selectable === false || server.locked === true;
}

const handleToggle = async (key: string, enabled: boolean): Promise<void> => {
  const targetServer = availableMcpServers.value.find(
    (server) => server.key === key,
  );
  if (
    !targetServer ||
    targetServer.selectable === false ||
    isSystemLockedServer(targetServer)
  ) {
    return;
  }

  // 取得 canvasId，取不到直接 return（不進入樂觀更新）
  const canvasId = getActiveCanvasIdOrWarn("McpPopover");
  if (!canvasId) return;

  if (isAgentCanvasMcpServer(targetServer)) {
    const previous = pod.value?.agentCanvasMcpEnabled === true;
    podStore.updatePodAgentCanvasMcpEnabled(props.podId, enabled);
    try {
      await updatePodMcpServersApi(
        canvasId,
        props.podId,
        podMcpServerNames.value,
        enabled,
        podCodexMcpServerKeys.value,
      );
    } catch (error) {
      podStore.updatePodAgentCanvasMcpEnabled(props.podId, previous);
      logger.warn(
        "[McpPopover] Agent Canvas MCP update failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  if (targetServer.source !== "canvas") {
    const previous = [...podCodexMcpServerKeys.value];
    const nextKeys = buildNextSelection(previous, key, enabled);
    podStore.updatePodCodexMcpServers(props.podId, nextKeys);
    try {
      await updatePodMcpServersApi(
        canvasId,
        props.podId,
        podMcpServerNames.value,
        undefined,
        nextKeys,
      );
    } catch (error) {
      podStore.updatePodCodexMcpServers(props.podId, previous);
      logger.warn(
        "[McpPopover] Codex MCP update failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  const nextNames = buildNextSelection(
    podMcpServerNames.value,
    targetServer.name,
    enabled,
  );

  await runToggle(nextNames, {
    getCurrent: () => [...podMcpServerNames.value],
    // 唯一來源是 podStore，本元件不再持有 local 狀態，setLocal 為 no-op
    setLocal: () => {},
    setStore: (items) => podStore.updatePodMcpServers(props.podId, items),
    callApi: (items) =>
      updatePodMcpServersApi(
        canvasId,
        props.podId,
        items,
        undefined,
        podCodexMcpServerKeys.value,
      ),
    resolveError: resolveMcpErrorDescription,
    failToast: { title: "Pod" },
  });
};
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      :data-resource-menu-pod-id="podId"
      class="fixed z-50 min-w-60 rounded-md border border-doodle-ink bg-card p-2 shadow-md"
      :style="{
        left: `${anchorRect.left - 8}px`,
        top: `${anchorRect.top}px`,
        transform: 'translateX(-100%)',
      }"
      @click.stop
    >
      <!-- 搜尋框：永遠顯示於頂部（載入中時也顯示，等待中可先輸入） -->
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="pod-popover-search"
        type="text"
        :placeholder="t('pod.slot.searchPlaceholder')"
        @click.stop
      >

      <!-- 載入中 -->
      <div
        v-if="loading"
        class="flex items-center gap-2 px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        <span
          class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        <span>{{ t("pod.slot.mcpLoading") }}</span>
      </div>

      <!-- 載入失敗 -->
      <div
        v-else-if="loadFailed"
        class="px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        {{ t("pod.slot.mcpLoadFailed") }}
      </div>

      <!-- 搜尋無結果：有安裝但過濾後無符合項目 -->
      <div
        v-else-if="showSearchEmpty"
        class="px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        {{ t("pod.slot.mcpSearchEmpty") }}
      </div>

      <div
        v-else-if="showEmptyState"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        <p>{{ t("pod.slot.mcpEmpty") }}</p>
        <p class="mt-1">
          {{ t("pod.slot.mcpManagedHint") }}
        </p>
      </div>

      <ScrollArea
        v-else
        class="pod-popover-scrollable"
      >
        <div class="space-y-1 pr-3">
          <section
            v-for="(group, groupIndex) in mcpGroups"
            :key="group.source"
            :data-testid="`mcp-source-${group.source}`"
          >
            <div
              v-if="groupIndex > 0"
              data-testid="mcp-group-divider"
              class="my-1 border-t border-dashed border-doodle-ink/40"
            />
            <p class="px-2 py-1 text-[10px] font-mono text-muted-foreground">
              {{ t(`pod.slot.mcpSource.${group.source}`) }}
            </p>
            <McpServerRow
              v-for="server in group.items"
              :key="server.key"
              :resource-key="server.key"
              :name="server.name"
              :label="resolveServerLabel(server)"
              :transport="server.transport"
              :checked="isServerChecked(server)"
              :disabled="isServerDisabled(server)"
              :readonly="isSystemLockedServer(server)"
              :locked="isSystemLockedServer(server)"
              :locked-label="t('pod.slot.builtinBadge')"
              :disabled-reason="resolveDisabledReason(server)"
              @toggle="handleToggle"
            />
          </section>
        </div>
      </ScrollArea>
    </div>
  </Teleport>
</template>
