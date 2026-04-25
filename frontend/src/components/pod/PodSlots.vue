<script setup lang="ts">
// 介面採扁平 props/emit 設計，每種 slot 類型獨立傳入與通知；
// 新增 slot 類型需同步更新此元件 props、template、emits 與 CanvasPod 對應 listener。
import { computed, toRef } from "vue";
import { useI18n } from "vue-i18n";
import type {
  SkillNote,
  SubAgentNote,
  RepositoryNote,
  CommandNote,
  McpServerNote,
} from "@/types";
import PodMultiBindSlot from "@/components/pod/PodMultiBindSlot.vue";
import PodSingleBindSlot from "@/components/pod/PodSingleBindSlot.vue";
import {
  useSkillStore,
  useSubAgentStore,
  useMcpServerStore,
  useRepositoryStore,
  useCommandStore,
} from "@/stores/note";
import { usePodCapabilities } from "@/composables/pod/usePodCapabilities";

const props = defineProps<{
  podId: string;
  podRotation: number;
  boundSkillNotes: SkillNote[];
  boundSubAgentNotes: SubAgentNote[];
  boundRepositoryNote: RepositoryNote | undefined;
  boundCommandNote: CommandNote | undefined;
  boundMcpServerNotes: McpServerNote[];
}>();

// 注意：不要解構 props，Vue3 的 defineProps 回傳值是 reactive proxy，
// 解構後的個別變數會失去響應性（reactive proxy 的 getter 不再被追蹤）。
// 所有模板與邏輯一律透過 props.xxx 存取。

const emit = defineEmits<{
  "skill-dropped": [noteId: string];
  "subagent-dropped": [noteId: string];
  "repository-dropped": [noteId: string];
  "repository-removed": [];
  "command-dropped": [noteId: string];
  "command-removed": [];
  "mcp-server-dropped": [noteId: string];
}>();

const { t } = useI18n();

// 子元件自行取 store 是有意設計，避免父元件介面爆炸；
// store 為 singleton，重複呼叫無額外成本。
const skillStore = useSkillStore();
const subAgentStore = useSubAgentStore();
const mcpServerStore = useMcpServerStore();
const repositoryStore = useRepositoryStore();
const commandStore = useCommandStore();

// 讀取 Pod 對應 Provider 的 capability flags
const {
  isSkillEnabled,
  isSubAgentEnabled,
  isRepositoryEnabled,
  isCommandEnabled,
  isMcpEnabled,
} = usePodCapabilities(toRef(props, "podId"));

/** 不支援功能時顯示的 tooltip 文字（由 i18n 提供） */
const DISABLED_TOOLTIP = computed(() => t("pod.slot.codexDisabled"));

// -----------------------------------------------------------------------
// Slot 設定陣列：每筆描述一個 slot 的型態、資料來源與 emit 對應
// 新增 slot 類型只需在此加一筆，並補對應 emit 宣告即可。
//
// type === 'single'：對應 PodSingleBindSlot（一個 slot 只能綁定一個 note）
// type === 'multi'： 對應 PodMultiBindSlot（一個 slot 可綁定多個 note）
// -----------------------------------------------------------------------

type SingleSlotConfig = {
  kind: "single";
  areaClass: string;
  slotClass: string;
  label: string;
  store: typeof repositoryStore | typeof commandStore;
  boundNote: () => RepositoryNote | CommandNote | undefined;
  disabled: () => boolean;
  disabledTooltip: () => string;
  onDropped: (noteId: string) => void;
  onRemoved: () => void;
};

type MultiSlotConfig = {
  kind: "multi";
  areaClass: string;
  slotClass: string;
  label: string;
  store: typeof skillStore | typeof subAgentStore | typeof mcpServerStore;
  boundNotes: () => SkillNote[] | SubAgentNote[] | McpServerNote[];
  duplicateToastTitle: () => string;
  duplicateToastDescription: () => string;
  menuScrollableClass: string;
  itemIdField: string;
  disabled: () => boolean;
  disabledTooltip: () => string;
  onDropped: (noteId: string) => void;
};

type SlotConfig = SingleSlotConfig | MultiSlotConfig;

const slotConfigs = computed((): SlotConfig[] => [
  {
    kind: "multi",
    areaClass: "pod-notch-area-base pod-skill-notch-area",
    slotClass: "pod-skill-slot",
    label: "Skills",
    store: skillStore,
    boundNotes: () => props.boundSkillNotes,
    duplicateToastTitle: () => t("pod.slot.duplicateTitle"),
    duplicateToastDescription: () => t("pod.slot.skillDuplicate"),
    menuScrollableClass: "pod-skill-menu-scrollable",
    itemIdField: "skillId",
    disabled: () => !isSkillEnabled.value,
    disabledTooltip: () => DISABLED_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("skill-dropped", noteId);
    },
  },
  {
    kind: "multi",
    areaClass: "pod-notch-area-base pod-subagent-notch-area",
    slotClass: "pod-subagent-slot",
    label: "SubAgents",
    store: subAgentStore,
    boundNotes: () => props.boundSubAgentNotes,
    duplicateToastTitle: () => t("pod.slot.duplicateTitle"),
    duplicateToastDescription: () => t("pod.slot.subAgentDuplicate"),
    menuScrollableClass: "pod-subagent-menu-scrollable",
    itemIdField: "subAgentId",
    disabled: () => !isSubAgentEnabled.value,
    disabledTooltip: () => DISABLED_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("subagent-dropped", noteId);
    },
  },
  {
    kind: "single",
    areaClass: "pod-notch-area-base pod-repository-notch-area",
    slotClass: "pod-repository-slot",
    label: "Repo",
    store: repositoryStore,
    boundNote: () => props.boundRepositoryNote,
    disabled: () => !isRepositoryEnabled.value,
    disabledTooltip: () => DISABLED_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("repository-dropped", noteId);
    },
    onRemoved: () => emit("repository-removed"),
  },
  {
    kind: "single",
    areaClass: "pod-notch-area-base pod-command-notch-area",
    slotClass: "pod-command-slot",
    label: "Command",
    store: commandStore,
    boundNote: () => props.boundCommandNote,
    disabled: () => !isCommandEnabled.value,
    disabledTooltip: () => DISABLED_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("command-dropped", noteId);
    },
    onRemoved: () => emit("command-removed"),
  },
  {
    kind: "multi",
    areaClass: "pod-notch-area-base pod-mcp-server-notch-area",
    slotClass: "pod-mcp-server-slot",
    label: "MCPs",
    store: mcpServerStore,
    boundNotes: () => props.boundMcpServerNotes,
    duplicateToastTitle: () => t("pod.slot.duplicateTitle"),
    duplicateToastDescription: () => t("pod.slot.mcpServerDuplicate"),
    menuScrollableClass: "pod-mcp-server-menu-scrollable",
    itemIdField: "mcpServerId",
    disabled: () => !isMcpEnabled.value,
    disabledTooltip: () => DISABLED_TOOLTIP.value,
    onDropped: (noteId: string): void => {
      if (!noteId) return;
      emit("mcp-server-dropped", noteId);
    },
  },
]);
</script>

<template>
  <template v-for="slot in slotConfigs" :key="slot.slotClass">
    <div :class="slot.areaClass">
      <PodSingleBindSlot
        v-if="slot.kind === 'single'"
        :pod-id="props.podId"
        :bound-note="slot.boundNote()"
        :store="slot.store"
        :label="slot.label"
        :slot-class="slot.slotClass"
        :pod-rotation="props.podRotation"
        :disabled="slot.disabled()"
        :disabled-tooltip="slot.disabledTooltip()"
        @note-dropped="slot.onDropped"
        @note-removed="slot.onRemoved()"
      />
      <PodMultiBindSlot
        v-else-if="slot.kind === 'multi'"
        :pod-id="props.podId"
        :bound-notes="slot.boundNotes()"
        :store="slot.store"
        :label="slot.label"
        :duplicate-toast-title="slot.duplicateToastTitle()"
        :duplicate-toast-description="slot.duplicateToastDescription()"
        :slot-class="slot.slotClass"
        :menu-scrollable-class="slot.menuScrollableClass"
        :item-id-field="slot.itemIdField"
        :disabled="slot.disabled()"
        :disabled-tooltip="slot.disabledTooltip()"
        @note-dropped="slot.onDropped"
      />
    </div>
  </template>
</template>
