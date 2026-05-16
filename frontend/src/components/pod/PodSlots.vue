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

/** 不支援功能時顯示的 tooltip 文字（由 i18n 提供） */
const DISABLED_TOOLTIP = computed(() => t("pod.slot.providerDisabled"));

// multi-run 模式下,每個 run 啟動時設定已 snapshot 到 run 內,
// 改 pod 上的 notch 只會影響下一個 run,因此不再鎖定 notch。

const pluginDisabled = computed(() => !isPluginEnabled.value);
const pluginDisabledTooltip = computed(() => DISABLED_TOOLTIP.value);

const mcpDisabled = computed(() => !isMcpEnabled.value);
const mcpDisabledTooltip = computed(() => DISABLED_TOOLTIP.value);

const thinkingCapabilityUnsupported = computed(
  () =>
    !providerCapabilityStore.isThinkingSupportedForModel(
      props.provider,
      props.currentModel,
    ),
);
const thinkingDisabled = computed(() => thinkingCapabilityUnsupported.value);
const thinkingDisabledTooltip = computed(() => DISABLED_TOOLTIP.value);

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
    disabled: !isRepositoryEnabled.value,
    disabledTooltip: DISABLED_TOOLTIP.value,
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
    disabled: !isCommandEnabled.value,
    disabledTooltip: DISABLED_TOOLTIP.value,
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
