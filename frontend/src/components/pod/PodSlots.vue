<script setup lang="ts">
// 介面採扁平 props/emit 設計，每種 slot 類型獨立傳入與通知；
// 新增 slot 類型需同步更新此元件 props、template、emits 與 CanvasPod 對應 listener。
import { computed, toRef } from "vue";
import { useI18n } from "vue-i18n";
import type { RepositoryNote, CommandNote } from "@/types";
import type { PodProvider } from "@/types/pod";
import PodSingleBindSlot from "@/components/pod/PodSingleBindSlot.vue";
import PodPluginSlot from "@/components/pod/PodPluginSlot.vue";
import PodMcpSlot from "@/components/pod/PodMcpSlot.vue";
import { useRepositoryStore, useCommandStore } from "@/stores/note";
import { usePodCapabilities } from "@/composables/pod/usePodCapabilities";

const props = defineProps<{
  podId: string;
  podRotation: number;
  pluginActiveCount: number;
  mcpActiveCount: number;
  provider: PodProvider;
  boundRepositoryNote: RepositoryNote | undefined;
  boundCommandNote: CommandNote | undefined;
}>();

// 注意：不要解構 props，Vue3 的 defineProps 回傳值是 reactive proxy，
// 解構後的個別變數會失去響應性（reactive proxy 的 getter 不再被追蹤）。
// 所有模板與邏輯一律透過 props.xxx 存取。

const emit = defineEmits<{
  "plugin-clicked": [event: MouseEvent];
  "mcp-clicked": [event: MouseEvent];
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

// 讀取 Pod 對應 Provider 的 capability flags
const { isPluginEnabled, isRepositoryEnabled, isCommandEnabled, isMcpEnabled } =
  usePodCapabilities(toRef(props, "podId"));

/** 不支援功能時顯示的 tooltip 文字（由 i18n 提供） */
const DISABLED_TOOLTIP = computed(() => t("pod.slot.providerDisabled"));

/** Plugin capability 關閉（目前兩個 provider plugin: true，恆為 false，保留以利擴充） */
const pluginCapabilityDisabled = computed(() => !isPluginEnabled.value);

/** MCP capability 關閉：當前 provider 不支援 MCP 才為 true */
const mcpCapabilityDisabled = computed(() => !isMcpEnabled.value);

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

function createRepositorySlotConfig(): SingleSlotConfig {
  return {
    kind: "single",
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
  };
}

function createCommandSlotConfig(): SingleSlotConfig {
  return {
    kind: "single",
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
  };
}

const slotConfigs = computed((): SlotConfig[] => [
  createRepositorySlotConfig(),
  createCommandSlotConfig(),
]);
</script>

<template>
  <PodPluginSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.pluginActiveCount"
    :provider="props.provider"
    :capability-disabled="pluginCapabilityDisabled"
    :disabled-tooltip="DISABLED_TOOLTIP"
    @click="(ev) => emit('plugin-clicked', ev)"
  />
  <PodMcpSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.mcpActiveCount"
    :provider="props.provider"
    :capability-disabled="mcpCapabilityDisabled"
    :disabled-tooltip="DISABLED_TOOLTIP"
    @click="(ev) => emit('mcp-clicked', ev)"
  />
  <template v-for="slot in slotConfigs" :key="slot.slotClass">
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
