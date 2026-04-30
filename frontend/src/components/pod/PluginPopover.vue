<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useEscapeClose } from "@/composables/useEscapeClose";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listPlugins } from "@/services/pluginApi";
import { updatePodPlugins as updatePodPluginsApi } from "@/services/podPluginApi";
import { usePodStore } from "@/stores/pod";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { useOptimisticToggle } from "@/composables/pod/useOptimisticToggle";
import type { InstalledPlugin } from "@/types/plugin";
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

const installedPlugins = ref<InstalledPlugin[]>([]);
const localPluginIds = ref<string[]>([]);
const loading = ref<boolean>(false);
const loadFailed = ref<boolean>(false);

/** 搜尋輸入框的文字內容 */
const searchQuery = ref<string>("");
/** 搜尋輸入框的 template ref，用於自動 focus */
const searchInputRef = ref<HTMLInputElement | null>(null);

/**
 * 依搜尋字串過濾 plugin 清單。
 * 若搜尋字串為空則回傳完整清單；否則對 plugin.name 做大小寫不敏感比對。
 */
const filteredPlugins = computed<InstalledPlugin[]>(() => {
  if (!searchQuery.value) {
    return installedPlugins.value;
  }
  const query = searchQuery.value.toLowerCase();
  return installedPlugins.value.filter((plugin) =>
    plugin.name.toLowerCase().includes(query),
  );
});

/** 將 localPluginIds 轉成 Set，讓 template v-for 中的查找從 O(n) 降為 O(1) */
const localPluginIdsSet = computed(() => new Set(localPluginIds.value));

/**
 * Codex 唯讀模式旗標。
 * 僅在 provider === "codex" 時為 true，**不用於 Gemini**：
 * Gemini 走 `v-else` 可 toggle 分支（name + v{version} + Switch）。
 */
const isCodexReadOnly = computed(() => props.provider === "codex");

const rootRef = ref<HTMLElement | null>(null);

/** 點擊外部關閉（capture 階段攔截，避免內部 click 誤觸）
 *  排除 Plugin 觸發按鈕（.pod-plugin-notch-area）：
 *  點觸發按鈕時讓 click 事件走到 handlePluginClick 的 toggle 邏輯，
 *  避免「mousedown 先關、click 再開」的競態導致 popover 無法關閉。
 */
// 以 className 比對觸發區是一種 trade-off，攻擊者需注入相同 class 才能繞過，目前接受此風險
const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  // 若點擊落在 Plugin 觸發區，略過此次關閉，交由 toggle handler 處理
  if ((event.target as Element).closest(".pod-plugin-notch-area")) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

/** 從 podStore 同步初始化本地 pluginIds（同步操作） */
const initLocalPluginIds = (): void => {
  const pod = podStore.getPodById(props.podId);
  localPluginIds.value = [...(pod?.pluginIds ?? [])];
};

/** 載入已安裝的 plugin 清單（非同步 API + 狀態管理） */
const loadPluginList = async (): Promise<void> => {
  loading.value = true;
  try {
    installedPlugins.value = await listPlugins(props.provider);
  } catch (err) {
    console.warn(
      "[PluginPopover] Failed to load plugins:",
      err instanceof Error ? err.message : String(err),
    );
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }
};

/** 等 DOM 更新後將 focus 移至搜尋輸入框（DOM 副作用） */
const focusSearchInput = async (): Promise<void> => {
  await nextTick();
  searchInputRef.value?.focus();
};

onMounted(async () => {
  initLocalPluginIds();
  await loadPluginList();
  await focusSearchInput();
  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleMousedown, true);
});

// ESC 鍵關閉
useEscapeClose(() => emit("close"));

/** 純函式：依 enabled 組裝下一個 plugin ID 清單 */
const buildNextIds = (
  current: string[],
  pluginId: string,
  enabled: boolean,
): string[] => {
  if (enabled) {
    return current.includes(pluginId) ? [...current] : [...current, pluginId];
  }
  return current.filter((id) => id !== pluginId);
};

/** 依 reason 欄位決定 plugin toggle 的錯誤描述字串 */
// reason 欄位由後端控制；此處僅辨識已知值 pod-busy，其他 reason 一律 fallback
const resolvePluginErrorDescription = (err: unknown): string => {
  const reason =
    err !== null && typeof err === "object" && "reason" in err
      ? (err as Record<string, unknown>).reason
      : undefined;

  return reason === "pod-busy"
    ? t("pod.slot.pluginsBusyTooltip")
    : t("pod.slot.pluginsToggleFailed");
};

const handleToggle = async (
  pluginId: string,
  enabled: boolean,
): Promise<void> => {
  // Codex 唯讀，跳過 toggle；Gemini / Claude 正常往下走
  if (isCodexReadOnly.value) return;

  const nextIds = buildNextIds(localPluginIds.value, pluginId, enabled);

  // 取得 canvasId，取不到直接 return（不進入樂觀更新）
  const canvasId = getActiveCanvasIdOrWarn("PluginPopover");
  if (!canvasId) return;

  await runToggle(nextIds, {
    getCurrent: () => [...localPluginIds.value],
    setLocal: (items) => {
      localPluginIds.value = items;
    },
    setStore: (items) => podStore.updatePodPlugins(props.podId, items),
    callApi: (items) => updatePodPluginsApi(canvasId, props.podId, items),
    resolveError: resolvePluginErrorDescription,
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
      <!-- 搜尋輸入框：常駐顯示，popover 開啟後自動 focus -->
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="pod-popover-search"
        type="text"
        :placeholder="t('pod.slot.searchPlaceholder')"
        @click.stop
      />

      <!-- 載入中 -->
      <div
        v-if="loading"
        class="flex items-center gap-2 px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        <span
          class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        <span>{{ t("pod.slot.pluginsLoading") }}</span>
      </div>

      <!-- 空狀態（載入失敗或尚未安裝任何 plugin） -->
      <div
        v-else-if="loadFailed || installedPlugins.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ t("pod.slot.pluginsEmpty") }}
      </div>

      <!-- 搜尋無結果：有已安裝 plugin 但過濾後為空 -->
      <div
        v-else-if="filteredPlugins.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        {{ t("pod.slot.pluginsSearchEmpty") }}
      </div>

      <!-- Plugin 列表（Claude / Gemini：可 toggle；Codex：唯讀展示） -->
      <template v-else>
        <!-- Codex 唯讀展示分支：顯示 name vX.Y.Z + 已啟用勾勾標籤，不可 toggle -->
        <div v-if="isCodexReadOnly">
          <ScrollArea class="pod-popover-scrollable">
            <div class="space-y-1">
              <div
                v-for="plugin in filteredPlugins"
                :key="plugin.id"
                class="flex items-center justify-between gap-3 rounded px-2 py-1"
              >
                <p class="text-xs font-mono">
                  {{ plugin.name }} v{{ plugin.version }}
                </p>
                <span
                  class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono text-green-600"
                >
                  ✓
                </span>
              </div>
            </div>
          </ScrollArea>
          <!-- Codex hint：在 ScrollArea 外，避免隨列表捲動 -->
          <p class="mt-1 px-2 text-xs font-mono text-muted-foreground">
            {{ t("pod.slot.pluginsCodexHint") }}
          </p>
        </div>

        <!-- Claude / Gemini 可 toggle 分支：name + v{version} + Switch -->
        <ScrollArea v-else class="pod-popover-scrollable">
          <div class="space-y-1">
            <div
              v-for="plugin in filteredPlugins"
              :key="plugin.id"
              class="group relative flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-secondary"
              :title="busy ? t('pod.slot.pluginsBusyTooltip') : undefined"
            >
              <div>
                <p class="text-xs font-mono">
                  {{ plugin.name }}
                </p>
                <p class="text-xs font-mono text-muted-foreground">
                  v{{ plugin.version }}
                </p>
              </div>
              <Switch
                :model-value="localPluginIdsSet.has(plugin.id)"
                :disabled="busy"
                @click.stop
                @update:model-value="
                  (val: boolean) => handleToggle(plugin.id, val)
                "
              />
            </div>
          </div>
        </ScrollArea>
      </template>
    </div>
  </Teleport>
</template>
