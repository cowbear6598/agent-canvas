<script setup lang="ts">
// 介面採扁平 props/emit 設計，每種 slot 類型獨立傳入與通知；
// 新增 slot 類型需同步更新此元件 props（如 currentModel / currentThinkingLevel）、
// template（新增的 PodThinkingSlot）、emits（如 thinking-clicked）與 CanvasPod 對應 listener。
import { computed, toRef } from "vue";
import { useI18n } from "vue-i18n";
import type { RepositoryNote, CommandNote } from "@/types";
import type { PodProvider } from "@/types/pod";
import PodSingleBindSlot from "@/components/pod/PodSingleBindSlot.vue";
import PodPluginSlot from "@/components/pod/PodPluginSlot.vue";
import PodMcpSlot from "@/components/pod/PodMcpSlot.vue";
import PodThinkingSlot from "@/components/pod/PodThinkingSlot.vue";
import { useRepositoryStore, useCommandStore } from "@/stores/note";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { usePodCapabilities } from "@/composables/pod/usePodCapabilities";
import { usePodHasMessages } from "@/composables/pod/usePodHasMessages";

const props = defineProps<{
  podId: string;
  podRotation: number;
  pluginActiveCount: number;
  mcpActiveCount: number;
  provider: PodProvider;
  currentModel: string;
  currentThinkingLevel: string | undefined;
  boundRepositoryNote: RepositoryNote | undefined;
  boundCommandNote: CommandNote | undefined;
}>();

// 注意：不要解構 props，Vue3 的 defineProps 回傳值是 reactive proxy，
// 解構後的個別變數會失去響應性（reactive proxy 的 getter 不再被追蹤）。
// 所有模板與邏輯一律透過 props.xxx 存取。

const emit = defineEmits<{
  "plugin-clicked": [event: MouseEvent];
  "mcp-clicked": [event: MouseEvent];
  "thinking-clicked": [event: MouseEvent];
  "repository-dropped": [noteId: string];
  "repository-removed": [];
  "command-dropped": [noteId: string];
  "command-removed": [];
}>();

const { t } = useI18n();

// 子元件自行取 store 是有意設計，避免父元件介面爆炸；
// store 為 singleton，重複呼叫無額外成本。
const repositoryStore = useRepositoryStore();
const commandStore = useCommandStore();
const providerCapabilityStore = useProviderCapabilityStore();

// 讀取 Pod 對應 Provider 的 capability flags
const { isPluginEnabled, isRepositoryEnabled, isCommandEnabled, isMcpEnabled } =
  usePodCapabilities(toRef(props, "podId"));

/** 此 Pod 是否已有訊息（用於鎖定 notch 防止啟動對話後再變動設定） */
const hasMessages = usePodHasMessages(toRef(props, "podId"));

/** 不支援功能時顯示的 tooltip 文字（由 i18n 提供） */
const DISABLED_TOOLTIP = computed(() => t("pod.slot.providerDisabled"));

/** 已有對話訊息鎖定時顯示的 tooltip 文字（由 i18n 提供） */
const LOCKED_BY_MESSAGES_TOOLTIP = computed(() =>
  t("pod.slot.lockedByMessages"),
);

// 合併版 disabled / tooltip：
// - capability 不支援是「永久條件」，訊息鎖是「暫時條件」（清空對話後解鎖）
// - 兩者任一成立都應 disable，故用 OR
// - tooltip 顯示優先採用 capability 文案：永久條件對使用者較具資訊性，
//   且 capability 不支援的 slot 即使清空對話也不會解鎖

/** Plugin slot 是否 disable：capability 不支援 或 已有對話訊息 */
const pluginDisabled = computed(
  () => !isPluginEnabled.value || hasMessages.value,
);

/** Plugin slot tooltip：capability 優先 */
const pluginDisabledTooltip = computed(() =>
  !isPluginEnabled.value
    ? DISABLED_TOOLTIP.value
    : LOCKED_BY_MESSAGES_TOOLTIP.value,
);

/** MCP slot 是否 disable：capability 不支援 或 已有對話訊息 */
const mcpDisabled = computed(() => !isMcpEnabled.value || hasMessages.value);

/** MCP slot tooltip：capability 優先 */
const mcpDisabledTooltip = computed(() =>
  !isMcpEnabled.value
    ? DISABLED_TOOLTIP.value
    : LOCKED_BY_MESSAGES_TOOLTIP.value,
);

/** Thinking capability 是否不支援（當前 provider+model 不支援 thinking） */
const thinkingCapabilityUnsupported = computed(
  () =>
    !providerCapabilityStore.isThinkingSupportedForModel(
      props.provider,
      props.currentModel,
    ),
);

/** Thinking slot 是否 disable：capability 不支援 或 已有對話訊息 */
const thinkingDisabled = computed(
  () => thinkingCapabilityUnsupported.value || hasMessages.value,
);

/** Thinking slot tooltip：capability 優先 */
const thinkingDisabledTooltip = computed(() =>
  thinkingCapabilityUnsupported.value
    ? DISABLED_TOOLTIP.value
    : LOCKED_BY_MESSAGES_TOOLTIP.value,
);

// -----------------------------------------------------------------------
// Slot 設定陣列：每筆描述一個 slot 的型態、資料來源與 emit 對應
// 新增 slot 類型只需在此加一筆，並補對應 emit 宣告即可。
// -----------------------------------------------------------------------

type SingleSlotConfig = {
  kind: "single";
  areaClass: string;
  slotClass: string;
  label: string;
  store: typeof repositoryStore | typeof commandStore;
  boundNote: () => RepositoryNote | CommandNote | undefined;
  disabled: boolean;
  disabledTooltip: string;
  onDropped: (noteId: string) => void;
  onRemoved: () => void;
};

type SlotConfig = SingleSlotConfig;

/**
 * 通用 single-bind slot 設定產生器。
 * 封裝 areaClass / slotClass / label / store / boundNote / disabled / disabledTooltip 等共用結構，
 * 兩個既有 helper（createRepositorySlotConfig / createCommandSlotConfig）改為 thin wrapper。
 */
function createSlotConfig(opts: {
  areaClass: string;
  slotClass: string;
  label: string;
  store: typeof repositoryStore | typeof commandStore;
  boundNote: () => RepositoryNote | CommandNote | undefined;
  disabled: boolean;
  disabledTooltip: string;
  onDropped: (noteId: string) => void;
  onRemoved: () => void;
}): SingleSlotConfig {
  return { kind: "single", ...opts };
}

function createRepositorySlotConfig(): SingleSlotConfig {
  return createSlotConfig({
    areaClass: "pod-notch-area-base pod-repository-notch-area",
    slotClass: "pod-repository-slot",
    label: "Repo",
    store: repositoryStore,
    boundNote: () => props.boundRepositoryNote,
    // capability 不支援 或 已有對話訊息 → 鎖定 notch
    disabled: !isRepositoryEnabled.value || hasMessages.value,
    // capability 不支援優先（永久條件），否則顯示訊息鎖文案
    disabledTooltip: !isRepositoryEnabled.value
      ? DISABLED_TOOLTIP.value
      : LOCKED_BY_MESSAGES_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("repository-dropped", noteId);
    },
    onRemoved: () => emit("repository-removed"),
  });
}

function createCommandSlotConfig(): SingleSlotConfig {
  return createSlotConfig({
    areaClass: "pod-notch-area-base pod-command-notch-area",
    slotClass: "pod-command-slot",
    label: "Command",
    store: commandStore,
    boundNote: () => props.boundCommandNote,
    // capability 不支援 或 已有對話訊息 → 鎖定 notch
    disabled: !isCommandEnabled.value || hasMessages.value,
    // capability 不支援優先（永久條件），否則顯示訊息鎖文案
    disabledTooltip: !isCommandEnabled.value
      ? DISABLED_TOOLTIP.value
      : LOCKED_BY_MESSAGES_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("command-dropped", noteId);
    },
    onRemoved: () => emit("command-removed"),
  });
}

const slotConfigs = computed((): SlotConfig[] => [
  createRepositorySlotConfig(),
  createCommandSlotConfig(),
]);
</script>

<template>
  <!-- plugin capability 為 false（如 opencode）時，slot 仍渲染但以 disabled 視覺呈現，與 Repo/Command/Thinking 一致 -->
  <PodPluginSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.pluginActiveCount"
    :provider="props.provider"
    :disabled="pluginDisabled"
    :disabled-tooltip="pluginDisabledTooltip"
    @click="(ev) => emit('plugin-clicked', ev)"
  />
  <!-- mcp capability 為 false 時完全不渲染 slot，避免對不支援 MCP 的 provider（如 codex）顯示無意義的 notch -->
  <PodMcpSlot
    v-if="isMcpEnabled"
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.mcpActiveCount"
    :provider="props.provider"
    :disabled="mcpDisabled"
    :disabled-tooltip="mcpDisabledTooltip"
    @click="(ev) => emit('mcp-clicked', ev)"
  />
  <PodThinkingSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :current-level="props.currentThinkingLevel"
    :current-model="props.currentModel"
    :provider="props.provider"
    :disabled="thinkingDisabled"
    :disabled-tooltip="thinkingDisabledTooltip"
    @click="(ev) => emit('thinking-clicked', ev)"
  />
  <template
    v-for="slot in slotConfigs"
    :key="slot.slotClass"
  >
    <div :class="slot.areaClass">
      <PodSingleBindSlot
        :pod-id="props.podId"
        :bound-note="slot.boundNote()"
        :store="slot.store"
        :label="slot.label"
        :slot-class="slot.slotClass"
        :pod-rotation="props.podRotation"
        :disabled="slot.disabled"
        :disabled-tooltip="slot.disabledTooltip"
        @note-dropped="slot.onDropped"
        @note-removed="slot.onRemoved()"
      />
    </div>
  </template>
</template>
