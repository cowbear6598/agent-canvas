<script setup lang="ts">
import { ref, computed } from "vue";
import { ChevronRight } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { PodProvider } from "@/types/pod";
import { useConnectionStore } from "@/stores/connectionStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { useToast } from "@/composables/useToast";
import {
  DEFAULT_TOAST_DURATION_MS,
  SHORT_TOAST_DURATION_MS,
} from "@/lib/constants";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import { PROVIDER_OPTIONS } from "./providerOptions";

interface Props {
  connectionId: string;
  currentSummaryModel: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "summary-model-changed": [];
}>();

const connectionStore = useConnectionStore();
const providerCapabilityStore = useProviderCapabilityStore();
const { toast } = useToast();
const { t } = useI18n();

const isProviderMenuOpen = ref(false);
const isSummaryMenuOpen = ref(false);

const connection = computed(() =>
  connectionStore.findConnectionById(props.connectionId),
);

const currentProvider = computed((): PodProvider | undefined => {
  return connection.value?.summaryProvider ?? undefined;
});

const summaryModelOptions = computed(() => {
  if (!currentProvider.value) return null;
  const models = providerCapabilityStore.getAvailableModels(
    currentProvider.value,
  );
  if (models.length === 0) return null;
  return models;
});

const isSummaryModelActive = (optionValue: string): boolean => {
  return (
    currentProvider.value === (connection.value?.summaryProvider ?? "claude") &&
    props.currentSummaryModel === optionValue
  );
};

const showModelChangeToast = (title: string, label: string): void => {
  toast({
    title,
    description: t("canvas.connectionContextMenu.modelSwitched", {
      model: label,
    }),
    duration: SHORT_TOAST_DURATION_MS,
  });
};

const handleSetSummaryProvider = async (
  targetProvider: PodProvider,
): Promise<void> => {
  if (targetProvider === currentProvider.value) {
    emit("close");
    return;
  }

  const defaultModel = providerCapabilityStore.getDefaultModel(targetProvider);
  const summaryModel = defaultModel ?? DEFAULT_SUMMARY_MODEL;

  const result = await connectionStore.updateConnectionSummaryProvider(
    props.connectionId,
    targetProvider,
    summaryModel,
  );

  if (result) {
    const providerLabel =
      PROVIDER_OPTIONS.find((o) => o.value === targetProvider)?.label ??
      targetProvider;
    const modelLabel =
      providerCapabilityStore
        .getAvailableModels(targetProvider)
        .find((m) => m.value === summaryModel)?.label ?? summaryModel;

    toast({
      title: t("canvas.connectionContextMenu.summaryProviderChanged"),
      description: t(
        "canvas.connectionContextMenu.summaryProviderChangedDesc",
        { provider: providerLabel, model: modelLabel ?? "" },
      ),
      duration: SHORT_TOAST_DURATION_MS,
    });
    emit("summary-model-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.summaryModelChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

const handleSetSummaryModel = async (
  targetValue: string,
  displayLabel: string,
): Promise<void> => {
  if (targetValue === props.currentSummaryModel) {
    emit("close");
    return;
  }

  const result = await connectionStore.updateConnectionSummaryModel(
    props.connectionId,
    targetValue,
  );

  if (result) {
    showModelChangeToast(
      t("canvas.connectionContextMenu.summaryModelChanged"),
      displayLabel,
    );
    emit("summary-model-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.summaryModelChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};
</script>

<template>
  <!-- Summary Provider 子選單觸發器 -->
  <div
    class="relative"
    @mouseenter="isProviderMenuOpen = true"
    @mouseleave="isProviderMenuOpen = false"
  >
    <button
      class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      :class="{ 'bg-secondary': isProviderMenuOpen }"
    >
      <span class="font-mono text-foreground">{{
        $t("canvas.connectionContextMenu.summaryProvider")
      }}</span>
      <ChevronRight
        :size="12"
        class="text-muted-foreground"
      />
    </button>

    <div
      v-if="isProviderMenuOpen"
      class="absolute left-full top-0 pl-1 z-50"
      @mouseenter="isProviderMenuOpen = true"
      @mouseleave="isProviderMenuOpen = false"
    >
      <div
        class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
      >
        <div
          v-if="currentProvider === undefined"
          class="px-2 py-1 text-xs font-mono text-muted-foreground"
        >
          {{ $t("canvas.connectionContextMenu.loading") }}
        </div>

        <button
          v-for="option in PROVIDER_OPTIONS"
          :key="option.value"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary':
                option.value === currentProvider,
            },
          ]"
          @click="handleSetSummaryProvider(option.value)"
        >
          <span
            :class="[
              'font-mono',
              option.value === currentProvider
                ? 'text-primary font-semibold'
                : 'text-foreground',
            ]"
          >
            {{ option.label }}
          </span>
        </button>
      </div>
    </div>
  </div>

  <!-- Summary Model 子選單觸發器 -->
  <div
    class="relative"
    @mouseenter="isSummaryMenuOpen = true"
    @mouseleave="isSummaryMenuOpen = false"
  >
    <button
      class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      :class="{ 'bg-secondary': isSummaryMenuOpen }"
    >
      <span class="font-mono text-foreground">{{
        $t("canvas.connectionContextMenu.summaryModel")
      }}</span>
      <ChevronRight
        :size="12"
        class="text-muted-foreground"
      />
    </button>

    <div
      v-if="isSummaryMenuOpen"
      class="absolute left-full top-0 pl-1 z-50"
      @mouseenter="isSummaryMenuOpen = true"
      @mouseleave="isSummaryMenuOpen = false"
    >
      <div
        class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
      >
        <div
          v-if="summaryModelOptions === null"
          class="px-2 py-1 text-xs font-mono text-muted-foreground"
        >
          {{ $t("canvas.connectionContextMenu.loading") }}
        </div>

        <button
          v-for="option in summaryModelOptions ?? []"
          :key="option.value"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary': isSummaryModelActive(
                option.value,
              ),
            },
          ]"
          @click="handleSetSummaryModel(option.value, option.label)"
        >
          <span
            :class="[
              'font-mono',
              isSummaryModelActive(option.value)
                ? 'text-primary font-semibold'
                : 'text-foreground',
            ]"
          >
            {{ option.label }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
