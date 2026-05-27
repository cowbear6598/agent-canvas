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
import ThinkingLevelSubmenu from "./ThinkingLevelSubmenu.vue";

interface Props {
  connectionId: string;
  currentBranchProvider?: PodProvider;
  currentBranchModel?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "branch-provider-changed": [];
  "branch-model-changed": [];
}>();

const connectionStore = useConnectionStore();
const providerCapabilityStore = useProviderCapabilityStore();
const { toast } = useToast();
const { t } = useI18n();

const isBranchProviderMenuOpen = ref(false);
const isBranchModelMenuOpen = ref(false);

const currentBranchProviderEffective = computed((): PodProvider => {
  return props.currentBranchProvider ?? "claude";
});

const branchModelOptions = computed(() => {
  const provider = currentBranchProviderEffective.value;
  const models = providerCapabilityStore.getAvailableModels(provider);
  if (models.length === 0) return null;
  return models;
});

const currentBranchModelEffective = computed((): string | undefined => {
  return props.currentBranchModel ?? branchModelOptions.value?.[0]?.value;
});

const isBranchModelActive = (optionValue: string): boolean => {
  return currentBranchModelEffective.value === optionValue;
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

const handleSetBranchProvider = async (
  targetProvider: PodProvider,
): Promise<void> => {
  if (targetProvider === currentBranchProviderEffective.value) {
    emit("close");
    return;
  }

  const defaultModel =
    providerCapabilityStore.getDefaultModel(targetProvider) ??
    providerCapabilityStore.getAvailableModels(targetProvider)[0]?.value;
  const branchModel =
    defaultModel ??
    (targetProvider === "opencode" ? undefined : DEFAULT_SUMMARY_MODEL);
  if (!branchModel) {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.branchModelChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
    return;
  }

  const result = await connectionStore.updateConnectionBranchProvider(
    props.connectionId,
    targetProvider,
    branchModel,
  );

  if (result) {
    const providerLabel =
      PROVIDER_OPTIONS.find((o) => o.value === targetProvider)?.label ??
      targetProvider;
    const modelLabel =
      providerCapabilityStore
        .getAvailableModels(targetProvider)
        .find((m) => m.value === branchModel)?.label ?? branchModel;

    toast({
      title: t("canvas.connectionContextMenu.branchProviderChanged"),
      description: t("canvas.connectionContextMenu.branchProviderChangedDesc", {
        provider: providerLabel,
        model: modelLabel,
      }),
      duration: SHORT_TOAST_DURATION_MS,
    });
    emit("branch-provider-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.branchModelChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

const handleSetBranchModel = async (
  targetValue: string,
  displayLabel: string,
): Promise<void> => {
  if (targetValue === currentBranchModelEffective.value) {
    emit("close");
    return;
  }

  const result = await connectionStore.updateConnectionBranchModel(
    props.connectionId,
    targetValue,
  );

  if (result) {
    showModelChangeToast(
      t("canvas.connectionContextMenu.branchModelChanged"),
      displayLabel,
    );
    emit("branch-model-changed");
    emit("close");
  } else {
    toast({
      title: t("canvas.connectionContextMenu.changeFailed"),
      description: t("canvas.connectionContextMenu.branchModelChangeFailed"),
      duration: DEFAULT_TOAST_DURATION_MS,
    });
  }
};

const connection = computed(() =>
  connectionStore.findConnectionById(props.connectionId),
);

const handleSetBranchThinkingLevel = (
  level: string | null,
): Promise<unknown> => {
  return connectionStore.updateConnectionBranchThinkingLevel(
    props.connectionId,
    level,
  );
};
</script>

<template>
  <!-- Branch Provider 子選單觸發器 -->
  <div
    class="relative"
    @mouseenter="isBranchProviderMenuOpen = true"
    @mouseleave="isBranchProviderMenuOpen = false"
  >
    <button
      class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      :class="{ 'bg-secondary': isBranchProviderMenuOpen }"
    >
      <span class="font-mono text-foreground">{{
        $t("canvas.connectionContextMenu.branchProvider")
      }}</span>
      <ChevronRight
        :size="12"
        class="text-muted-foreground"
      />
    </button>

    <div
      v-if="isBranchProviderMenuOpen"
      class="absolute left-full top-0 pl-1 z-50"
      @mouseenter="isBranchProviderMenuOpen = true"
      @mouseleave="isBranchProviderMenuOpen = false"
    >
      <div
        class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
      >
        <button
          v-for="option in PROVIDER_OPTIONS"
          :key="option.value"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary':
                option.value === currentBranchProviderEffective,
            },
          ]"
          @click="handleSetBranchProvider(option.value)"
        >
          <span
            :class="[
              'font-mono',
              option.value === currentBranchProviderEffective
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

  <!-- Branch Model 子選單觸發器 -->
  <div
    class="relative"
    @mouseenter="isBranchModelMenuOpen = true"
    @mouseleave="isBranchModelMenuOpen = false"
  >
    <button
      class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      :class="{ 'bg-secondary': isBranchModelMenuOpen }"
    >
      <span class="font-mono text-foreground">{{
        $t("canvas.connectionContextMenu.branchModel")
      }}</span>
      <ChevronRight
        :size="12"
        class="text-muted-foreground"
      />
    </button>

    <div
      v-if="isBranchModelMenuOpen"
      class="absolute left-full top-0 pl-1 z-50"
      @mouseenter="isBranchModelMenuOpen = true"
      @mouseleave="isBranchModelMenuOpen = false"
    >
      <div
        class="bg-card border border-doodle-ink rounded-md p-1 min-w-[120px]"
      >
        <div
          v-if="branchModelOptions === null"
          class="px-2 py-1 text-xs font-mono text-muted-foreground"
        >
          {{ $t("canvas.connectionContextMenu.loading") }}
        </div>

        <button
          v-for="option in branchModelOptions ?? []"
          :key="option.value"
          :class="[
            'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
            {
              'bg-secondary border-l-2 border-l-primary': isBranchModelActive(
                option.value,
              ),
            },
          ]"
          @click="handleSetBranchModel(option.value, option.label)"
        >
          <span
            :class="[
              'font-mono',
              isBranchModelActive(option.value)
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

  <ThinkingLevelSubmenu
    :provider="currentBranchProviderEffective"
    :model="currentBranchModelEffective"
    :current-level="connection?.branchThinkingLevel"
    :label="$t('canvas.connectionContextMenu.branchThinkingLevel')"
    :on-update="handleSetBranchThinkingLevel"
    @close="emit('close')"
  />
</template>
