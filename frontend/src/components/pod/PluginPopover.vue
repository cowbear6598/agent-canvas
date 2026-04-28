<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
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

/** Codex provider 唯讀模式：plugin 只展示不可 toggle */
const isCodex = computed(() => props.provider === "codex");

const rootRef = ref<HTMLElement | null>(null);

/** ESC 鍵關閉 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    emit("close");
  }
};

/** 點擊外部關閉（capture 階段攔截，避免內部 click 誤觸）
 *  排除 Plugin 觸發按鈕（.pod-plugin-notch-area）：
 *  點觸發按鈕時讓 click 事件走到 handlePluginClick 的 toggle 邏輯，
 *  避免「mousedown 先關、click 再開」的競態導致 popover 無法關閉。
 */
const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  // 若點擊落在 Plugin 觸發區，略過此次關閉，交由 toggle handler 處理
  if ((event.target as Element).closest(".pod-plugin-notch-area")) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

onMounted(async () => {
  // 同步初始 pluginIds
  const pod = podStore.getPodById(props.podId);
  localPluginIds.value = [...(pod?.pluginIds ?? [])];

  // 載入 plugin 清單
  loading.value = true;
  try {
    installedPlugins.value = await listPlugins(props.provider);
  } catch {
    loadFailed.value = true;
  } finally {
    loading.value = false;
  }

  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("mousedown", handleMousedown, true);
});

/** 依 reason 欄位決定 plugin toggle 的錯誤描述字串 */
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
  // Codex pod 不支援 toggle，防呆直接 return
  if (isCodex.value) return;

  // 組裝下一個狀態清單
  let nextIds: string[];
  if (enabled) {
    nextIds = localPluginIds.value.includes(pluginId)
      ? [...localPluginIds.value]
      : [...localPluginIds.value, pluginId];
  } else {
    nextIds = localPluginIds.value.filter((id) => id !== pluginId);
  }

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
      class="fixed z-50 min-w-52 rounded-md border border-doodle-ink bg-card p-2 shadow-md"
      :style="{
        left: `${anchorRect.left - 8}px`,
        top: `${anchorRect.top}px`,
        transform: 'translateX(-100%)',
      }"
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
        <span>{{ t("pod.slot.pluginsLoading") }}</span>
      </div>

      <!-- 空狀態（載入失敗或無 plugin） -->
      <div
        v-else-if="loadFailed || installedPlugins.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ t("pod.slot.pluginsEmpty") }}
      </div>

      <!-- Plugin 列表（Claude：可 toggle；Codex：唯讀展示） -->
      <div
        v-else
        class="space-y-1"
      >
        <!-- Codex 唯讀模式：顯示 name vX.Y.Z + 已啟用勾勾標籤 -->
        <template v-if="isCodex">
          <div
            v-for="plugin in installedPlugins"
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
          <!-- Codex hint：全域管理說明 -->
          <p class="mt-1 px-2 text-xs font-mono text-muted-foreground">
            {{ t("pod.slot.pluginsCodexHint") }}
          </p>
        </template>

        <!-- Claude 模式：可 toggle -->
        <template v-else>
          <div
            v-for="plugin in installedPlugins"
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
              :model-value="localPluginIds.includes(plugin.id)"
              :disabled="busy"
              @click.stop
              @update:model-value="
                (val: boolean) => handleToggle(plugin.id, val)
              "
            />
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
