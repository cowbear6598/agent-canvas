<script setup lang="ts">
import { computed, toRef } from "vue";
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

const { isPluginEnabled, isRepositoryEnabled, isGoalEnabled, isMcpEnabled } =
  usePodCapabilities(toRef(props, "podId"));

const disabledTooltip = computed(() => t("pod.slot.providerDisabled"));

const pluginDisabled = computed(() => !isPluginEnabled.value);
const mcpDisabled = computed(() => !isMcpEnabled.value);
const goalDisabled = computed(() => !isGoalEnabled.value);

const thinkingCapabilityUnsupported = computed(
  () =>
    !providerCapabilityStore.isThinkingSupportedForModel(
      props.provider,
      props.currentModel,
    ),
);
const thinkingDisabled = computed(() => thinkingCapabilityUnsupported.value);
</script>

<template>
  <PodPluginSlot
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.pluginActiveCount"
    :provider="props.provider"
    :disabled="pluginDisabled"
    :disabled-tooltip="disabledTooltip"
    @click="(ev) => emit('plugin-clicked', ev)"
  />

  <PodMcpSlot
    v-if="isMcpEnabled"
    :pod-id="props.podId"
    :pod-rotation="props.podRotation"
    :active-count="props.mcpActiveCount"
    :disabled="mcpDisabled"
    :disabled-tooltip="disabledTooltip"
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
    :disabled="goalDisabled"
    :disabled-tooltip="disabledTooltip"
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
      :disabled="!isRepositoryEnabled"
      :disabled-tooltip="disabledTooltip"
      @note-dropped="(noteId) => emit('repository-dropped', noteId)"
      @note-removed="emit('repository-removed')"
    />
  </div>
</template>
