<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listMcpServers,
  updatePodMcpServers as updatePodMcpServersApi,
} from "@/services/mcpApi";
import { usePodStore } from "@/stores/pod";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { useOptimisticToggle } from "@/composables/pod/useOptimisticToggle";
import type { McpListItem } from "@/types/mcp";
import type { PodProvider } from "@/types/pod";

const props = defineProps<{
  podId: string;
  anchorRect: DOMRect;
  busy: boolean;
  provider: PodProvider;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const podStore = usePodStore();
const { runToggle } = useOptimisticToggle();

const installedMcpServers = ref<McpListItem[]>([]);
const localMcpServerNames = ref<string[]>([]);
const loading = ref<boolean>(false);
const loadFailed = ref<boolean>(false);

/** 搜尋框輸入字串 */
const searchQuery = ref<string>("");
/** 搜尋框 input 元素 ref，用於自動 focus */
const searchInputRef = ref<HTMLInputElement | null>(null);

/** 依 searchQuery 過濾 MCP server 清單（不分大小寫比對名稱） */
const filteredMcpServers = computed<McpListItem[]>(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return installedMcpServers.value;
  return installedMcpServers.value.filter((server) =>
    server.name.toLowerCase().includes(query),
  );
});

/** Codex provider 唯讀模式：MCP 只展示不可 toggle */
const isCodex = computed(() => props.provider === "codex");

const rootRef = ref<HTMLElement | null>(null);

/** ESC 鍵關閉 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    emit("close");
  }
};

/** 點擊外部關閉（capture 階段攔截，避免內部 click 誤觸）
 *  排除 MCP 觸發按鈕（.pod-mcp-notch-area）：
 *  點觸發按鈕時讓 click 事件走到 handleMcpClick 的 toggle 邏輯，
 *  避免「mousedown 先關、click 再開」的競態導致 popover 無法關閉。
 */
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

  // 載入 MCP server 清單
  loading.value = true;
  try {
    installedMcpServers.value = await listMcpServers(props.provider);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }

  // 載入完成後自動 focus 搜尋框
  await nextTick();
  searchInputRef.value?.focus();

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("mousedown", handleMousedown, true);
});

/** 從例外取得錯誤描述字串；直接顯示後端回傳的 i18n 翻譯訊息，fallback 到 mcpToggleFailed */
const resolveErrorDescription = (err: unknown): string =>
  err instanceof Error && err.message
    ? err.message
    : t("pod.slot.mcpToggleFailed");

const handleToggle = async (name: string, enabled: boolean): Promise<void> => {
  // Codex pod 不支援 toggle，防呆直接 return
  if (isCodex.value) return;

  // 組裝下一個狀態清單
  let nextNames: string[];
  if (enabled) {
    nextNames = localMcpServerNames.value.includes(name)
      ? [...localMcpServerNames.value]
      : [...localMcpServerNames.value, name];
  } else {
    nextNames = localMcpServerNames.value.filter((n) => n !== name);
  }

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
    resolveError: resolveErrorDescription,
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

      <!-- 空狀態（載入失敗或無 MCP server） -->
      <div
        v-else-if="loadFailed || installedMcpServers.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        <p>{{ t("pod.slot.mcpEmpty") }}</p>
        <p class="mt-1">
          {{
            isCodex
              ? t("pod.slot.mcpCodexEmptyHint")
              : t("pod.slot.mcpClaudeEmptyHint")
          }}
        </p>
      </div>

      <!-- 搜尋無結果：有安裝但過濾後無符合項目 -->
      <div
        v-else-if="filteredMcpServers.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        {{ t("pod.slot.mcpSearchEmpty") }}
      </div>

      <!-- MCP server 列表（Claude：可 toggle；Codex：唯讀展示） -->
      <template v-else>
        <!-- Codex 唯讀模式：ScrollArea 包列表，Codex hint 固定在外部 -->
        <div v-if="isCodex">
          <ScrollArea class="pod-popover-scrollable">
            <div class="space-y-1">
              <div
                v-for="server in filteredMcpServers"
                :key="server.name"
                class="flex items-center justify-between gap-3 rounded px-2 py-1"
              >
                <p class="text-xs font-mono">
                  {{ server.name }}
                </p>
                <div class="flex items-center gap-1">
                  <span
                    v-if="server.type"
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono text-muted-foreground bg-secondary"
                  >
                    {{ server.type }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono text-green-600"
                  >
                    ✓
                  </span>
                </div>
              </div>
            </div>
          </ScrollArea>
          <!-- Codex hint 在 ScrollArea 外：固定顯示，不隨列表捲動 -->
          <p class="mt-1 px-2 text-xs font-mono text-muted-foreground">
            {{ t("pod.slot.mcpCodexHint") }}
          </p>
        </div>

        <!-- Claude 模式：ScrollArea 包列表，所有 server 均可 toggle -->
        <ScrollArea
          v-else
          class="pod-popover-scrollable"
        >
          <div class="space-y-1">
            <div
              v-for="server in filteredMcpServers"
              :key="server.name"
              class="group relative flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-secondary"
              :title="busy ? t('pod.slot.mcpBusyTooltip') : undefined"
            >
              <p class="text-xs font-mono">
                {{ server.name }}
              </p>
              <Switch
                :model-value="localMcpServerNames.includes(server.name)"
                :disabled="busy"
                @click.stop
                @update:model-value="
                  (val: boolean) => handleToggle(server.name, val)
                "
              />
            </div>
          </div>
        </ScrollArea>
      </template>
    </div>
  </Teleport>
</template>
