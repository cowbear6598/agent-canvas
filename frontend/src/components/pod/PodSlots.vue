<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { RepositoryNote } from "@/types";
import type { PodProvider } from "@/types/pod";
import PodSingleBindSlot from "@/components/pod/PodSingleBindSlot.vue";
import PodPluginSlot from "@/components/pod/PodPluginSlot.vue";
import PodMcpSlot from "@/components/pod/PodMcpSlot.vue";
import PodThinkingSlot from "@/components/pod/PodThinkingSlot.vue";
import PodGoalSlot from "@/components/pod/PodGoalSlot.vue";
import { useRepositoryStore } from "@/stores/note";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";

const props = defineProps<{
  podId: string;
  podRotation: number;
  pluginActiveCount: number;
  mcpActiveCount: number;
  provider: PodProvider;
  currentModel: string;
  currentThinkingLevel: string | undefined;
  boundRepositoryNote: RepositoryNote | undefined;
  goalTodoCount: number;
}>();

const emit = defineEmits<{
  "plugin-clicked": [event: MouseEvent];
  "mcp-clicked": [event: MouseEvent];
  "thinking-clicked": [event: MouseEvent];
  "goal-clicked": [event: MouseEvent];
  "repository-dropped": [noteId: string];
  "repository-removed": [];
}>();

const { t } = useI18n();

const repositoryStore = useRepositoryStore();
const providerCapabilityStore = useProviderCapabilityStore();

const disabledTooltip = computed(() => t("pod.slot.providerDisabled"));

const thinkingDisabled = computed(
  () =>
    !providerCapabilityStore.isThinkingSupportedForModel(
      props.provider,
      props.currentModel,
    ),
);
</script>

<template>
  <PodPluginSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.pluginActiveCount"
    @click="(ev) => emit('plugin-clicked', ev)"
  />

  <PodMcpSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.mcpActiveCount"
    @click="(ev) => emit('mcp-clicked', ev)"
  />

  <PodThinkingSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :current-level="props.currentThinkingLevel"
    :current-model="props.currentModel"
    :provider="props.provider"
    :disabled="thinkingDisabled"
    :disabled-tooltip="disabledTooltip"
    @click="(ev) => emit('thinking-clicked', ev)"
  />

  <PodGoalSlot
    :pod-id="props.podId"
    :todo-count="props.goalTodoCount"
    @click="(ev) => emit('goal-clicked', ev)"
  />

  <div class="pod-notch-area-base pod-repository-notch-area">
    <PodSingleBindSlot
      :pod-id="props.podId"
      :bound-note="props.boundRepositoryNote"
      :store="repositoryStore"
      :label="t('pod.slot.repositoryLabel')"
      slot-class="pod-repository-slot"
      :pod-rotation="props.podRotation"
      @note-dropped="(noteId) => emit('repository-dropped', noteId)"
      @note-removed="emit('repository-removed')"
    />
  </div>
</template>
