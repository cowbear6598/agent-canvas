<script setup lang="ts">
import { ref, watch, computed, nextTick } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { getProvider } from "@/integration/providerRegistry";
import { useIntegrationStore } from "@/stores/integrationStore";
import { usePodStore } from "@/stores";
import type {
  IntegrationApp,
  IntegrationProviderConfig,
} from "@/types/integration";

interface Props {
  open: boolean;
  podId: string;
  provider: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const integrationStore = useIntegrationStore();
const podStore = usePodStore();

const config = computed<IntegrationProviderConfig>(() =>
  getProvider(props.provider),
);
const apps = computed(() => integrationStore.getAppsByProvider(props.provider));

const selectedAppId = ref<string | null>(null);
const extraValues = ref<Record<string, string>>({});
const selectedResourceId = ref<string | null>(null);
const manualResourceInput = ref<string>("");

const isRestoringBinding = ref(false);

const selectedApp = computed<IntegrationApp | undefined>(() =>
  selectedAppId.value
    ? integrationStore.getAppById(props.provider, selectedAppId.value)
    : undefined,
);

const resources = computed(() =>
  selectedApp.value ? config.value.getResources(selectedApp.value) : [],
);

const isNoResource = computed<boolean>(
  () => config.value.hasNoResource ?? false,
);

const isManualInput = computed<boolean>(
  () => config.value.hasManualResourceInput?.(extraValues.value) ?? false,
);

const manualInputError = computed<string>(() => {
  const manualConfig = config.value.manualResourceInputConfig;
  if (!manualConfig) return "";
  return manualConfig.validate(manualResourceInput.value);
});

const isConfirmDisabled = computed<boolean>(() => {
  if (apps.value.length === 0 || !selectedAppId.value) return true;

  const extraFields = config.value.bindingExtraFields ?? [];
  if (extraFields.some((field) => !extraValues.value[field.key])) return true;

  if (isNoResource.value) return false;

  if (isManualInput.value) {
    return manualInputError.value !== "" || manualResourceInput.value === "";
  }

  return !selectedResourceId.value;
});

function initExtraValues(): void {
  const extra: Record<string, string> = {};
  const extraFields = config.value.bindingExtraFields ?? [];
  extraFields.forEach((field) => {
    extra[field.key] = field.defaultValue;
  });
  extraValues.value = extra;
}

function resetState(): void {
  selectedAppId.value = null;
  selectedResourceId.value = null;
  manualResourceInput.value = "";
  initExtraValues();
}

watch(
  () => props.open,
  (newOpen) => {
    if (!newOpen) {
      resetState();
      return;
    }

    if (!isNoResource.value) {
      for (const app of apps.value) {
        if (app.connectionStatus === "connected") {
          integrationStore.refreshAppResources(props.provider, app.id);
        }
      }
    }

    initExtraValues();

    const pod = podStore.getPodById(props.podId);
    const binding = (pod?.integrationBindings ?? []).find(
      (b) => b.provider === props.provider,
    );

    if (!binding) {
      selectedAppId.value = null;
      selectedResourceId.value = null;
      manualResourceInput.value = "";
      return;
    }

    // 防止 selectedAppId 設定後立即觸發 watch 清除 selectedResourceId
    isRestoringBinding.value = true;
    selectedAppId.value = binding.appId;

    const extraFields = config.value.bindingExtraFields ?? [];
    extraFields.forEach((field) => {
      const savedValue = binding.extra[field.key];
      if (typeof savedValue === "string") {
        extraValues.value[field.key] = savedValue;
      }
    });

    selectedResourceId.value = binding.resourceId;

    // private 模式下 resourceId 即為 User ID
    if (config.value.hasManualResourceInput?.(extraValues.value)) {
      manualResourceInput.value = binding.resourceId;
    }

    nextTick(() => {
      isRestoringBinding.value = false;
    });
  },
);

// 防止回填期間清除資源選擇
watch(selectedAppId, () => {
  if (isRestoringBinding.value) return;
  selectedResourceId.value = null;
  manualResourceInput.value = "";
});

// 防止回填期間清除資源選擇
watch(
  extraValues,
  () => {
    if (isRestoringBinding.value) return;
    selectedResourceId.value = null;
    manualResourceInput.value = "";
  },
  { deep: true },
);

function resolveResourceId(): string | null {
  if (isNoResource.value) return "*";
  if (isManualInput.value) {
    if (manualInputError.value !== "" || manualResourceInput.value === "")
      return null;
    return manualResourceInput.value;
  }
  return selectedResourceId.value;
}

const handleConfirm = async (): Promise<void> => {
  if (!selectedAppId.value) return;

  const resourceId = resolveResourceId();
  if (!resourceId) return;

  const extra: Record<string, unknown> = {};
  Object.entries(extraValues.value).forEach(([k, v]) => {
    extra[k] = v;
  });

  await integrationStore.bindToPod(
    props.provider,
    props.podId,
    selectedAppId.value,
    resourceId,
    extra,
  );
  emit("update:open", false);
};

const handleClose = (): void => {
  emit("update:open", false);
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {{
            $t("integration.connect.title", { provider: config.label })
          }}
        </DialogTitle>
        <DialogDescription>
          <template v-if="isNoResource">
            {{
              $t("integration.connect.descriptionNoResource", {
                provider: config.label,
              })
            }}
          </template>
          <template v-else>
            {{
              $t("integration.connect.descriptionWithResource", {
                provider: config.label,
                resourceLabel: config.resourceLabel,
              })
            }}
          </template>
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div
          v-if="apps.length === 0"
          class="py-4 text-sm text-muted-foreground"
        >
          {{ $t("integration.connect.noAppsHint", { provider: config.label }) }}
        </div>

        <template v-else>
          <div class="space-y-2">
            <Label>{{ $t("integration.connect.selectApp") }}</Label>
            <RadioGroup
              v-model="selectedAppId"
              class="space-y-2"
            >
              <div
                v-for="app in apps"
                :key="app.id"
                class="flex items-center gap-3"
              >
                <RadioGroupItem
                  :id="`app-${app.id}`"
                  :value="app.id"
                />
                <Label
                  :for="`app-${app.id}`"
                  class="flex cursor-pointer items-center gap-2 font-normal"
                >
                  <span
                    class="size-2 shrink-0 rounded-full"
                    :class="
                      config.connectionStatusConfig[app.connectionStatus]
                        ?.dotClass
                    "
                  />
                  {{ app.name }}
                </Label>
              </div>
            </RadioGroup>
          </div>

          <!-- 額外欄位（如 Jira 事件過濾、Telegram 的 private/group 選擇） -->
          <template
            v-if="selectedApp && (config.bindingExtraFields ?? []).length > 0"
          >
            <div
              v-for="extraField in config.bindingExtraFields ?? []"
              :key="extraField.key"
              class="space-y-2"
            >
              <Label>{{ extraField.label }}</Label>
              <RadioGroup
                v-model="extraValues[extraField.key]"
                class="flex gap-4"
              >
                <div
                  v-for="option in extraField.options"
                  :key="option.value"
                  class="flex items-center gap-2"
                >
                  <RadioGroupItem
                    :id="`${extraField.key}-${option.value}`"
                    :value="option.value"
                  />
                  <Label
                    :for="`${extraField.key}-${option.value}`"
                    class="cursor-pointer font-normal"
                  >
                    {{ option.label }}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </template>

          <template v-if="selectedApp && !isNoResource">
            <!-- 手動輸入模式（如 Telegram private User ID） -->
            <div
              v-if="isManualInput && config.manualResourceInputConfig"
              class="space-y-2"
            >
              <Label :for="`manual-resource-${provider}`">
                {{ config.manualResourceInputConfig.label }}
              </Label>
              <Input
                :id="`manual-resource-${provider}`"
                v-model="manualResourceInput"
                type="text"
                :placeholder="config.manualResourceInputConfig.placeholder"
              />
              <p
                v-if="manualResourceInput && manualInputError"
                class="text-xs text-red-500"
              >
                {{ manualInputError }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ config.manualResourceInputConfig.hint }}
              </p>
            </div>

            <!-- 資源列表選擇 -->
            <div
              v-else
              class="space-y-2"
            >
              <Label>{{
                $t("integration.connect.selectResource", {
                  resourceLabel: config.resourceLabel,
                })
              }}</Label>
              <div
                v-if="resources.length === 0"
                class="text-sm text-muted-foreground"
              >
                {{ config.emptyResourceHint }}
              </div>
              <RadioGroup
                v-else
                v-model="selectedResourceId"
                class="space-y-2"
              >
                <div
                  v-for="resource in resources"
                  :key="resource.id"
                  class="flex items-center gap-3"
                >
                  <RadioGroupItem
                    :id="`resource-${resource.id}`"
                    :value="String(resource.id)"
                  />
                  <Label
                    :for="`resource-${resource.id}`"
                    class="cursor-pointer font-normal"
                  >
                    {{ resource.label }}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </template>
        </template>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleClose"
        >
          {{
            $t("common.cancel")
          }}
        </Button>
        <Button
          variant="default"
          :disabled="isConfirmDisabled"
          @click="handleConfirm"
        >
          {{ $t("common.confirm") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
