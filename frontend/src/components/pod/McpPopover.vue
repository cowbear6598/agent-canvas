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
import type { PodMcpAvailabilityItem } from "@/types/mcp";
import type { PodProvider } from "@/types/pod";

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
const localMcpServerNames = ref<string[]>([]);
const loading = ref<boolean>(false);
const loadFailed = ref<boolean>(false);
const GOAL_RUNTIME_SERVER_NAME = "agent_canvas_goal";

/** 搜尋框輸入字串 */
const searchQuery = ref<string>("");
/** 搜尋框 input 元素 ref，用於自動 focus */
const searchInputRef = ref<HTMLInputElement | null>(null);

function isSystemLockedServer(server: PodMcpAvailabilityItem): boolean {
  return Boolean(server.system || server.locked);
}

function isGoalRuntimeServer(server: PodMcpAvailabilityItem): boolean {
  return server.system === true && server.name === GOAL_RUNTIME_SERVER_NAME;
}

function resolveServerLabel(server: PodMcpAvailabilityItem): string {
  return isGoalRuntimeServer(server) ? t("pod.slot.goalMcpLabel") : server.name;
}

const hasGoalRuntime = computed(() =>
  availableMcpServers.value.some((server) => isGoalRuntimeServer(server)),
);

const userMcpServers = computed(() =>
  availableMcpServers.value.filter((server) => !isSystemLockedServer(server)),
);

/** 依 searchQuery 過濾 MCP server 清單（不分大小寫比對名稱） */
const filteredMcpServers = computed<PodMcpAvailabilityItem[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return availableMcpServers.value;
  return availableMcpServers.value.filter((server) =>
    resolveServerLabel(server).toLowerCase().includes(query) ||
    server.name.toLowerCase().includes(query),
  );
});

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

const showUserEmptyHint = computed(
  () =>
    !loading.value &&
    !loadFailed.value &&
    searchQuery.value.trim().length === 0 &&
    hasGoalRuntime.value &&
    userMcpServers.value.length === 0,
);

/** 將 localMcpServerNames 轉成 Set，讓 template v-for 中的查找從 O(n) 降為 O(1) */
const localMcpServerNamesSet = computed(
  () => new Set(localMcpServerNames.value),
);

const rootRef = ref<HTMLElement | null>(null);

/** 點擊外部關閉（capture 階段攔截，避免內部 click 誤觸）
 *  排除 MCP 觸發按鈕（.pod-mcp-notch-area）：
 *  點觸發按鈕時讓 click 事件走到 handleMcpClick 的 toggle 邏輯，
 *  避免「mousedown 先關、click 再開」的競態導致 popover 無法關閉。
 */
// 以 className 比對觸發區是一種 trade-off，攻擊者需注入相同 class 才能繞過，目前接受此風險
const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  // 若點擊落在 MCP 觸發區，略過此次關閉，交由 toggle handler 處理
  if ((event.target as Element).closest(".pod-mcp-notch-area")) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

onMounted(async () => {
  // 同步初始 mcpServerNames
  const pod = podStore.getPodById(props.podId);
  localMcpServerNames.value = [...(pod?.mcpServerNames ?? [])];

  // 載入 pod-scoped MCP availability 清單
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

  // 載入完成後自動 focus 搜尋框
  await nextTick();
  searchInputRef.value?.focus();

  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleMousedown, true);
});

// ESC 鍵關閉
useEscapeClose(() => emit("close"));

/** 純函式：依 enabled 組裝下一個 MCP server 名稱清單 */
const buildNextNames = (
  current: string[],
  name: string,
  enabled: boolean,
): string[] => {
  if (enabled) {
    return current.includes(name) ? [...current] : [...current, name];
  }
  return current.filter((n) => n !== name);
};

/** 從例外取得錯誤描述字串；一律使用 i18n fallback，避免後端 message 未過濾直接洩漏到 UI */
const resolveMcpErrorDescription = (_err: unknown): string =>
  t("pod.slot.mcpToggleFailed");

function isServerChecked(server: PodMcpAvailabilityItem): boolean {
  return (
    isSystemLockedServer(server) ||
    localMcpServerNamesSet.value.has(server.name) ||
    server.selected === true
  );
}

function isServerDisabled(server: PodMcpAvailabilityItem): boolean {
  return server.selectable === false || server.locked === true;
}

const handleToggle = async (name: string, enabled: boolean): Promise<void> => {
  const targetServer = availableMcpServers.value.find(
    (server) => server.name === name,
  );
  if (
    !targetServer ||
    targetServer.selectable === false ||
    isSystemLockedServer(targetServer)
  ) {
    return;
  }

  const nextNames = buildNextNames(localMcpServerNames.value, name, enabled);

  // 取得 canvasId，取不到直接 return（不進入樂觀更新）
  const canvasId = getActiveCanvasIdOrWarn("McpPopover");
  if (!canvasId) return;

  await runToggle(nextNames, {
    getCurrent: () => [...localMcpServerNames.value],
    setLocal: (items) => {
      localMcpServerNames.value = items;
    },
    setStore: (items) => podStore.updatePodMcpServers(props.podId, items),
    callApi: (items) => updatePodMcpServersApi(canvasId, props.podId, items),
    resolveError: resolveMcpErrorDescription,
    failToast: { title: "Pod" },
  });
};
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
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

      <!-- MCP server 列表（built-in Goal + user MCP） -->
      <template v-else>
        <div
          v-if="showUserEmptyHint"
          class="px-2 pb-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
        >
          <p>{{ t("pod.slot.mcpUserEmpty") }}</p>
          <p class="mt-1">
            {{ t("pod.slot.mcpManagedHint") }}
          </p>
        </div>

        <ScrollArea
          class="pod-popover-scrollable"
        >
          <div class="space-y-1">
            <McpServerRow
              v-for="server in filteredMcpServers"
              :key="server.name"
              :name="server.name"
              :label="resolveServerLabel(server)"
              :transport="server.transport"
              :status="server.status"
              :checked="isServerChecked(server)"
              :disabled="isServerDisabled(server)"
              :readonly="isSystemLockedServer(server)"
              :locked="isSystemLockedServer(server)"
              :locked-label="t('pod.slot.builtinBadge')"
              :disabled-reason="server.disabledReason"
              @toggle="handleToggle"
            />
          </div>
        </ScrollArea>
      </template>
    </div>
  </Teleport>
</template>
