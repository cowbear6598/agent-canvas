<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import ModalBackButton from "@/components/ui/ModalBackButton.vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-vue-next";
import type { AcceptableValue } from "reka-ui";
import { useToast } from "@/composables/useToast";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { getConfig, updateConfig } from "@/services/configApi";
import { useConfigStore } from "@/stores/configStore";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import { PROVIDER_OPTIONS } from "@/components/canvas/connectionMenu/providerOptions";
import type { ModelOption, PodProvider } from "@/types/pod";

type ModelSettingsCategory = "memory" | "connectionLine";

interface ModelSettingsValue {
  provider: PodProvider | null;
  model: string;
  thinkingLevel: string | null;
}

interface Props {
  open: boolean;
  showBackButton?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  back: [];
}>();

const { t } = useI18n();
const { showSuccessToast } = useToast();
const { withErrorToast } = useWebSocketErrorHandler();
const configStore = useConfigStore();
const providerCapabilityStore = useProviderCapabilityStore();

const activeCategory = ref<ModelSettingsCategory>("memory");
const memorySettings = ref<ModelSettingsValue>({
  provider: null,
  model: "",
  thinkingLevel: null,
});
const connectionLineSettings = ref<ModelSettingsValue>({
  provider: null,
  model: "",
  thinkingLevel: null,
});
const timezoneOffset = ref<number>(configStore.timezoneOffset);
const isLoading = ref(false);
const isSaving = ref(false);
const loadFailed = ref(false);

const categories = computed<
  ReadonlyArray<{
    value: ModelSettingsCategory;
    label: string;
  }>
>(() => [
  {
    value: "memory",
    label: t("modelSettings.category.memory.title"),
  },
  {
    value: "connectionLine",
    label: t("modelSettings.category.connectionLine.title"),
  },
]);

const activeSettings = computed<ModelSettingsValue>(() =>
  activeCategory.value === "memory"
    ? memorySettings.value
    : connectionLineSettings.value,
);

const activeProvider = computed(() => activeSettings.value.provider);

const providerLabelByValue = computed(() => {
  const entries = PROVIDER_OPTIONS.map(
    (option): [string, string] => [option.value, option.label],
  );
  return new Map<string, string>(entries);
});

const providerOptions = computed<
  ReadonlyArray<{ value: PodProvider; label: string }>
>(() => {
  const knownValues = Array.from(providerCapabilityStore.allowedProviders);
  const options = knownValues.map((value) => ({
    value,
    label: providerLabelByValue.value.get(value) ?? value,
  }));

  if (
    activeProvider.value &&
    !options.some((option) => option.value === activeProvider.value)
  ) {
    options.push({
      value: activeProvider.value,
      label:
        providerLabelByValue.value.get(activeProvider.value) ??
        activeProvider.value,
    });
  }

  return options;
});

const modelOptions = computed<ReadonlyArray<ModelOption>>(() => {
  if (!activeProvider.value) return [];

  return [...providerCapabilityStore.getAvailableModels(activeProvider.value)];
});

const thinkingLevelOptions = computed<ReadonlyArray<string>>(() => {
  if (!activeProvider.value || !activeSettings.value.model) return [];

  return [
    ...providerCapabilityStore.getSupportedThinkingLevels(
      activeProvider.value,
      activeSettings.value.model,
    ),
  ];
});

const providerSelectValue = computed(
  () => activeSettings.value.provider ?? undefined,
);

const isModelDisabled = computed(
  () => !activeProvider.value || modelOptions.value.length === 0,
);

const isThinkingLevelDisabled = computed(
  () =>
    !activeProvider.value ||
    !activeSettings.value.model ||
    thinkingLevelOptions.value.length === 0,
);

const hasValidModelSettings = (settings: ModelSettingsValue): boolean =>
  !!settings.provider &&
  !!settings.model &&
  providerCapabilityStore.isModelValidForProvider(
    settings.provider,
    settings.model,
  );

const isSaveDisabled = computed(
  () =>
    isLoading.value ||
    isSaving.value ||
    loadFailed.value ||
    !hasValidModelSettings(memorySettings.value) ||
    !hasValidModelSettings(connectionLineSettings.value),
);

const modelPlaceholder = computed(() => {
  if (!activeProvider.value) {
    return t("modelSettings.form.modelPlaceholder");
  }

  if (activeProvider.value === "opencode" && modelOptions.value.length === 0) {
    return t("pod.modelSelector.opencode.emptyPlaceholder");
  }

  if (!providerCapabilityStore.loaded) {
    return t("modelSettings.form.modelLoading");
  }

  if (modelOptions.value.length === 0) {
    return t("modelSettings.form.modelUnavailable");
  }

  return t("modelSettings.form.modelPlaceholder");
});

const getThinkingLevelLabel = (level: string): string => {
  if (!activeProvider.value || !activeSettings.value.model) return level;

  return (
    providerCapabilityStore.getThinkingLevelLabel(
      activeProvider.value,
      activeSettings.value.model,
      level,
    ) ?? level
  );
};

const resolveDefaultModel = (provider: PodProvider): string =>
  providerCapabilityStore.getDefaultModel(provider) ??
  providerCapabilityStore.getAvailableModels(provider)[0]?.value ??
  "";

const resolveDefaultThinkingLevel = (
  provider: PodProvider,
  model: string,
): string | null => {
  if (!model) return null;

  return (
    providerCapabilityStore.getDefaultThinkingLevel(provider, model) ??
    providerCapabilityStore.getSupportedThinkingLevels(provider, model)[0] ??
    null
  );
};

const normalizeSettings = (
  settings: ModelSettingsValue,
): ModelSettingsValue => {
  if (!settings.provider) {
    return {
      provider: null,
      model: "",
      thinkingLevel: null,
    };
  }

  const model =
    settings.model &&
    providerCapabilityStore.isModelValidForProvider(
      settings.provider,
      settings.model,
    )
      ? settings.model
      : resolveDefaultModel(settings.provider);
  const supportedThinkingLevels = model
    ? providerCapabilityStore.getSupportedThinkingLevels(
        settings.provider,
        model,
      )
    : [];
  const thinkingLevel =
    settings.thinkingLevel &&
    supportedThinkingLevels.includes(settings.thinkingLevel)
      ? settings.thinkingLevel
      : resolveDefaultThinkingLevel(settings.provider, model);

  return {
    provider: settings.provider,
    model,
    thinkingLevel,
  };
};

const modelPayloadValue = (settings: ModelSettingsValue): string | undefined =>
  settings.provider ? settings.model : undefined;

const applyLoadedSettings = (
  result: Awaited<ReturnType<typeof getConfig | typeof updateConfig>>,
): void => {
  timezoneOffset.value = result.timezoneOffset ?? configStore.timezoneOffset;
  if (result.timezoneOffset !== undefined) {
    configStore.setTimezoneOffset(result.timezoneOffset);
  }

  memorySettings.value = normalizeSettings({
    provider: result.memoryProvider ?? null,
    model: result.memoryModel ?? "",
    thinkingLevel: result.memoryThinkingLevel ?? null,
  });
  connectionLineSettings.value = normalizeSettings({
    provider: result.connectionLineProvider ?? null,
    model: result.connectionLineModel ?? "",
    thinkingLevel: result.connectionLineThinkingLevel ?? null,
  });
  configStore.setMemoryConfig(memorySettings.value);
  configStore.setConnectionLineConfig(connectionLineSettings.value);
};

const loadSettings = async (): Promise<void> => {
  isLoading.value = true;
  loadFailed.value = false;
  try {
    if (!providerCapabilityStore.loaded) {
      await providerCapabilityStore.loadFromBackend();
    }

    const result = await withErrorToast(
      getConfig(),
      "Config",
      t("settings.loadFailed"),
      { swallow: true },
    );
    if (!result) {
      loadFailed.value = true;
      return;
    }

    applyLoadedSettings(result);
  } finally {
    isLoading.value = false;
  }
};

const updateActiveSettings = (next: ModelSettingsValue): void => {
  if (activeCategory.value === "memory") {
    memorySettings.value = next;
  } else {
    connectionLineSettings.value = next;
  }
};

const handleProviderChange = (value: AcceptableValue): void => {
  if (value === null) return;

  const provider = String(value) as PodProvider;
  const model = resolveDefaultModel(provider);

  updateActiveSettings({
    provider,
    model,
    thinkingLevel: resolveDefaultThinkingLevel(provider, model),
  });
};

const handleModelChange = (value: AcceptableValue): void => {
  if (value === null) return;
  if (!activeSettings.value.provider) return;

  const model = String(value);

  updateActiveSettings({
    ...activeSettings.value,
    model,
    thinkingLevel: resolveDefaultThinkingLevel(
      activeSettings.value.provider,
      model,
    ),
  });
};

const handleThinkingLevelChange = (value: AcceptableValue): void => {
  if (value === null) return;
  const thinkingLevel = String(value);

  if (!thinkingLevelOptions.value.includes(thinkingLevel)) return;

  updateActiveSettings({
    ...activeSettings.value,
    thinkingLevel,
  });
};

const handleSave = async (): Promise<void> => {
  if (isSaveDisabled.value) return;

  isSaving.value = true;
  try {
    const nextMemorySettings = normalizeSettings(memorySettings.value);
    const nextConnectionLineSettings = normalizeSettings(
      connectionLineSettings.value,
    );

    const result = await withErrorToast(
      updateConfig({
        timezoneOffset: timezoneOffset.value,
        memoryProvider: nextMemorySettings.provider ?? undefined,
        memoryModel: modelPayloadValue(nextMemorySettings),
        memoryThinkingLevel: nextMemorySettings.thinkingLevel,
        connectionLineProvider:
          nextConnectionLineSettings.provider ?? undefined,
        connectionLineModel: modelPayloadValue(nextConnectionLineSettings),
        connectionLineThinkingLevel: nextConnectionLineSettings.thinkingLevel,
      }),
      "Config",
      t("settings.saveFailed"),
      { swallow: true },
    );

    if (!result) return;

    applyLoadedSettings(result);
    showSuccessToast("Config", t("settings.saveSuccess"));
    emit("update:open", false);
  } finally {
    isSaving.value = false;
  }
};

const handleClose = (): void => {
  emit("update:open", false);
};

const handleBack = (): void => {
  emit("back");
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadSettings();
    }
  },
  { immediate: true },
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ModalBackButton
            v-if="showBackButton"
            @click="handleBack"
          />
          {{ t("modelSettings.title") }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("modelSettings.title") }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="max-h-[70vh] pr-3">
        <div class="space-y-4 py-2">
          <div
            class="grid grid-cols-2 gap-2"
            role="tablist"
            :aria-label="t('modelSettings.category.label')"
          >
            <Button
              v-for="category in categories"
              :key="category.value"
              type="button"
              :variant="
                activeCategory === category.value ? 'default' : 'outline'
              "
              class="h-auto min-h-12 justify-start whitespace-normal px-3 py-3 text-left"
              role="tab"
              :aria-selected="activeCategory === category.value"
              @click="activeCategory = category.value"
            >
              <span class="text-sm font-medium leading-5">
                {{ category.label }}
              </span>
            </Button>
          </div>

          <div class="rounded-md border border-border p-4">
            <div
              v-if="isLoading"
              class="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 class="h-4 w-4 animate-spin" />
              {{ t("modelSettings.form.loading") }}
            </div>

            <div
              v-else
              class="space-y-4"
            >
              <div class="space-y-2">
                <Label>{{ t("modelSettings.form.providerLabel") }}</Label>
                <Select
                  :model-value="providerSelectValue"
                  @update:model-value="handleProviderChange"
                >
                  <SelectTrigger>
                    <SelectValue
                      :placeholder="
                        t('modelSettings.form.providerPlaceholder')
                      "
                    />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem
                      v-for="option in providerOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-2">
                <Label>{{ t("modelSettings.form.modelLabel") }}</Label>
                <Select
                  :model-value="activeSettings.model || undefined"
                  :disabled="isModelDisabled"
                  @update:model-value="handleModelChange"
                >
                  <SelectTrigger>
                    <SelectValue :placeholder="modelPlaceholder" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem
                      v-for="option in modelOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="space-y-2">
                <Label>
                  {{ t("modelSettings.form.thinkingLevelLabel") }}
                </Label>
                <Select
                  :model-value="activeSettings.thinkingLevel || undefined"
                  :disabled="isThinkingLevelDisabled"
                  @update:model-value="handleThinkingLevelChange"
                >
                  <SelectTrigger>
                    <SelectValue
                      :placeholder="
                        isThinkingLevelDisabled
                          ? t('modelSettings.form.thinkingLevelUnavailable')
                          : t('modelSettings.form.thinkingLevelPlaceholder')
                      "
                    />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem
                      v-for="level in thinkingLevelOptions"
                      :key="level"
                      :value="level"
                    >
                      {{ getThinkingLevelLabel(level) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          @click="handleClose"
        >
          {{ t("modelSettings.form.cancel") }}
        </Button>
        <Button
          type="button"
          :disabled="isSaveDisabled"
          @click="handleSave"
        >
          <Loader2
            v-if="isSaving"
            class="mr-2 h-4 w-4 animate-spin"
          />
          {{
            isSaving
              ? t("modelSettings.form.saving")
              : t("modelSettings.form.save")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
