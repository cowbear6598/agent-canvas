<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  type ComponentPublicInstance,
} from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Copy, Check, KeyRound } from "lucide-vue-next";
import ModalBackButton from "@/components/ui/ModalBackButton.vue";
import { getProvider } from "@/integration/providerRegistry";
import { useIntegrationStore } from "@/stores/integrationStore";
import { t } from "@/i18n";
import type { IntegrationApp, IntegrationResource } from "@/types/integration";

interface Props {
  open: boolean;
  provider: string;
  showBackButton?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  back: [];
}>();

const integrationStore = useIntegrationStore();

const config = computed(() => {
  if (!props.provider) return null;
  return getProvider(props.provider);
});
const apps = computed(() => integrationStore.getAppsByProvider(props.provider));

const showAddForm = ref(false);
const isResettingCredentials = ref(false);
const formValues = ref<Record<string, string>>({});
const isSubmitting = ref(false);
const copiedAppId = ref<string | null>(null);
const copiedTokenAppId = ref<string | null>(null);
const copyTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const visibleResourceCounts = ref<Record<string, number>>({});
const hiddenResourceCounts = ref<Record<string, number>>({});
const resourceContainerElements = new Map<string, HTMLDivElement>();
let measureRafId: number | null = null;

const RESOURCE_CONTAINER_CLASS = "flex flex-wrap gap-1";
const RESOURCE_CHIP_CLASS =
  "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground whitespace-nowrap";
const MAX_RESOURCE_ROWS = 2;
const DEFAULT_RESOURCE_GAP_PX = 4;

watch(
  () => props.provider,
  () => {
    resetForm();
  },
);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (config.value?.hasNoResource) return;
    for (const app of apps.value) {
      if (app.connectionStatus === "connected") {
        integrationStore.refreshAppResources(props.provider, app.id);
      }
    }
  },
);

function isModalOpen(): boolean {
  return props.open;
}

function getProviderName(): string {
  return props.provider;
}

watch(
  [isModalOpen, getProviderName, apps],
  () => {
    scheduleResourceLayoutMeasure();
  },
  { deep: true, immediate: true },
);

function initFormValues(): void {
  const initial: Record<string, string> = {};
  config.value?.createFormFields.forEach((field) => {
    initial[field.key] = "";
  });
  formValues.value = initial;
}

function getAppResources(app: IntegrationApp): IntegrationResource[] {
  return config.value ? config.value.getResources(app) : [];
}

function getVisibleResources(app: IntegrationApp): IntegrationResource[] {
  const resources = getAppResources(app);
  const hiddenCount = hiddenResourceCounts.value[app.id] ?? 0;
  if (hiddenCount <= 0) {
    return resources;
  }

  const visibleCount = visibleResourceCounts.value[app.id] ?? resources.length;
  return resources.slice(0, visibleCount);
}

function getHiddenResourceCount(appId: string): number {
  return hiddenResourceCounts.value[appId] ?? 0;
}

function getHiddenResourcesLabel(count: number): string {
  return t("integration.apps.moreResources", { count });
}

function setResourceContainerRef(
  appId: string,
  element: Element | ComponentPublicInstance | null,
): void {
  if (element instanceof HTMLDivElement) {
    resourceContainerElements.set(appId, element);
    return;
  }

  resourceContainerElements.delete(appId);
}

function createMeasureChip(): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = RESOURCE_CHIP_CLASS;
  return chip;
}

function measureChipWidth(chip: HTMLSpanElement, label: string): number {
  chip.textContent = label;
  const width = chip.getBoundingClientRect().width;
  return width > 0 ? width : chip.offsetWidth;
}

function countFittableChipWidths(
  widths: number[],
  containerWidth: number,
  gap: number,
): number {
  let rowWidth = 0;
  let rowCount = 1;
  let visibleCount = 0;

  for (const width of widths) {
    if (rowWidth === 0) {
      rowWidth = width;
      visibleCount += 1;
      continue;
    }

    if (rowWidth + gap + width <= containerWidth) {
      rowWidth += gap + width;
      visibleCount += 1;
      continue;
    }

    if (rowCount >= MAX_RESOURCE_ROWS) {
      break;
    }

    rowCount += 1;
    rowWidth = width;
    visibleCount += 1;
  }

  return visibleCount;
}

function fitChipWidthsWithinRows(
  widths: number[],
  containerWidth: number,
  gap: number,
): boolean {
  return countFittableChipWidths(widths, containerWidth, gap) === widths.length;
}

function measureVisibleResourceCount(
  resources: IntegrationResource[],
  container: HTMLDivElement,
): {
  visibleCount: number;
  hiddenCount: number;
} {
  const containerWidth = container.clientWidth;
  if (resources.length === 0 || containerWidth <= 0) {
    return { visibleCount: resources.length, hiddenCount: 0 };
  }

  const measureContainer = document.createElement("div");
  measureContainer.className = RESOURCE_CONTAINER_CLASS;
  measureContainer.style.position = "absolute";
  measureContainer.style.left = "-9999px";
  measureContainer.style.top = "0";
  measureContainer.style.visibility = "hidden";
  measureContainer.style.pointerEvents = "none";
  measureContainer.style.width = `${containerWidth}px`;

  document.body.appendChild(measureContainer);

  try {
    const measureChip = createMeasureChip();
    measureContainer.appendChild(measureChip);

    const gapValue = Number.parseFloat(
      window.getComputedStyle(measureContainer).columnGap ||
        window.getComputedStyle(measureContainer).gap,
    );
    const gap = Number.isFinite(gapValue) ? gapValue : DEFAULT_RESOURCE_GAP_PX;
    const resourceWidths = resources.map((resource) =>
      measureChipWidth(measureChip, resource.label),
    );

    const visibleCount = countFittableChipWidths(
      resourceWidths,
      containerWidth,
      gap,
    );
    let hiddenCount = resources.length - visibleCount;

    if (hiddenCount <= 0) {
      return { visibleCount: resources.length, hiddenCount: 0 };
    }

    let adjustedVisibleCount = visibleCount;

    while (adjustedVisibleCount > 0) {
      const moreChipWidth = measureChipWidth(
        measureChip,
        getHiddenResourcesLabel(hiddenCount),
      );
      const candidateWidths = [
        ...resourceWidths.slice(0, adjustedVisibleCount),
        moreChipWidth,
      ];
      if (fitChipWidthsWithinRows(candidateWidths, containerWidth, gap)) {
        return {
          visibleCount: adjustedVisibleCount,
          hiddenCount,
        };
      }
      adjustedVisibleCount -= 1;
      hiddenCount += 1;
    }

    return { visibleCount: 0, hiddenCount: resources.length };
  } finally {
    document.body.removeChild(measureContainer);
  }
}

async function measureResourceLayout(): Promise<void> {
  if (!props.open || !config.value || config.value.hasNoResource) {
    visibleResourceCounts.value = {};
    hiddenResourceCounts.value = {};
    return;
  }

  await nextTick();

  const nextVisibleCounts: Record<string, number> = {};
  const nextHiddenCounts: Record<string, number> = {};

  for (const app of apps.value) {
    const resources = getAppResources(app);
    if (resources.length === 0) {
      nextVisibleCounts[app.id] = 0;
      nextHiddenCounts[app.id] = 0;
      continue;
    }

    const container = resourceContainerElements.get(app.id);
    if (!container || container.clientWidth <= 0) {
      nextVisibleCounts[app.id] = resources.length;
      nextHiddenCounts[app.id] = 0;
      continue;
    }

    const { visibleCount, hiddenCount } = measureVisibleResourceCount(resources, container);
    nextVisibleCounts[app.id] = visibleCount;
    nextHiddenCounts[app.id] = hiddenCount;
  }

  visibleResourceCounts.value = nextVisibleCounts;
  hiddenResourceCounts.value = nextHiddenCounts;
}

function scheduleResourceLayoutMeasure(): void {
  if (typeof window === "undefined") {
    return;
  }

  if (measureRafId !== null) {
    window.cancelAnimationFrame(measureRafId);
  }

  measureRafId = window.requestAnimationFrame(() => {
    measureRafId = null;
    void measureResourceLayout();
  });
}

const fieldErrors = computed<Record<string, string>>(() => {
  const errors: Record<string, string> = {};
  config.value?.createFormFields.forEach((field) => {
    errors[field.key] = field.validate(formValues.value[field.key] ?? "");
  });
  return errors;
});

const isDirty = computed(
  () =>
    config.value?.createFormFields.some(
      (field) => (formValues.value[field.key] ?? "") !== "",
    ) ?? false,
);

const isFormValid = computed(
  () =>
    config.value?.createFormFields.every(
      (field) => fieldErrors.value[field.key] === "",
    ) ?? false,
);

const handleClose = (): void => {
  emit("update:open", false);
};

const handleOpenAddForm = (): void => {
  initFormValues();
  isResettingCredentials.value = false;
  showAddForm.value = true;
};

const handleOpenCredentialForm = (app: IntegrationApp): void => {
  initFormValues();
  formValues.value.name = app.name;
  isResettingCredentials.value = true;
  showAddForm.value = true;
};

const handleCancelAddForm = (): void => {
  resetForm();
};

const resetForm = (): void => {
  showAddForm.value = false;
  isResettingCredentials.value = false;
  formValues.value = {};
};

const handleConfirmAdd = async (): Promise<void> => {
  if (!isFormValid.value) return;

  isSubmitting.value = true;

  const result = await integrationStore.createApp(
    props.provider,
    formValues.value,
  );

  isSubmitting.value = false;

  if (!result) return;

  resetForm();
};

const handleDeleteApp = async (appId: string): Promise<void> => {
  await integrationStore.deleteApp(props.provider, appId);
};

onUnmounted(() => {
  // 元件銷毀時清除所有未完成的 timer，避免記憶體洩漏
  for (const key of Object.keys(copyTimers)) {
    clearTimeout(copyTimers[key]);
  }

  if (typeof window !== "undefined") {
    window.removeEventListener("resize", scheduleResourceLayoutMeasure);
    if (measureRafId !== null) {
      window.cancelAnimationFrame(measureRafId);
    }
  }
});

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("resize", scheduleResourceLayoutMeasure);
  }
});

// 獨立函式：透過 execCommand 複製（非安全環境 fallback）
// 必須插入 dialog 內部，否則 Radix FocusScope 會攔截焦點導致複製失敗
function copyViaExecCommand(text: string): boolean {
  const container = document.querySelector("[role='dialog']") ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  container.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    // 靜默處理
    return false;
  } finally {
    container.removeChild(textarea);
  }
}

function handleCopy(
  text: string,
  setState: (id: string | null) => void,
  appId: string,
  timerKey: string,
): void {
  const onSuccess = (): void => {
    setState(appId);
    clearTimeout(copyTimers[timerKey]);
    copyTimers[timerKey] = setTimeout(() => setState(null), 2000);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(onSuccess)
      .catch(() => {
        // clipboard API 權限被拒時，fallback 到 execCommand
        if (copyViaExecCommand(text)) onSuccess();
      });
  } else {
    // fallback：非安全環境（如透過 IP 存取）下使用 execCommand
    if (copyViaExecCommand(text)) onSuccess();
  }
}

const handleCopyWebhookUrl = (appId: string, url: string): void => {
  handleCopy(
    url,
    (id) => {
      copiedAppId.value = id;
    },
    appId,
    `url-${appId}`,
  );
};

const handleCopyToken = (appId: string, token: string): void => {
  handleCopy(
    token,
    (id) => {
      copiedTokenAppId.value = id;
    },
    appId,
    `token-${appId}`,
  );
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent
      v-if="config"
      class="max-w-2xl"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ModalBackButton
            v-if="showBackButton"
            @back="emit('back')"
          />
          {{
            $t("integration.apps.title", { provider: config.label })
          }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ $t("integration.apps.title", { provider: config.label }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div
          v-if="apps.length === 0 && !showAddForm"
          class="py-6 text-center text-sm text-muted-foreground"
        >
          {{ config.emptyAppHint }}
        </div>

        <div
          v-for="app in apps"
          :key="app.id"
          class="flex items-center gap-3 rounded-md border px-4 py-3"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :class="
              config.connectionStatusConfig[app.connectionStatus]?.dotClass
            "
          />

          <div class="flex flex-1 flex-col overflow-hidden">
            <span class="font-semibold">{{ app.name }}</span>
            <span
              v-if="!app.hasCredentials"
              class="text-xs text-amber-600"
            >
              {{ $t("integration.apps.credentialsMissing") }}
            </span>

            <div
              v-if="config.getWebhookUrl"
              class="flex items-center gap-1"
            >
              <span class="truncate font-mono text-xs text-muted-foreground">
                {{ config.getWebhookUrl(app) }}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-5 shrink-0"
                @click="
                  handleCopyWebhookUrl(app.id, config.getWebhookUrl!(app))
                "
              >
                <Check
                  v-if="copiedAppId === app.id"
                  class="size-3"
                />
                <Copy
                  v-else
                  class="size-3"
                />
              </Button>
            </div>

            <div
              v-if="config.getTokenValue?.(app)"
              class="flex items-center gap-1"
            >
              <span class="font-mono text-xs text-muted-foreground">
                {{ config.tokenLabel ? $t(config.tokenLabel) : "" }}:
                ••••••••••••
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-5 shrink-0"
                @click="handleCopyToken(app.id, config.getTokenValue!(app)!)"
              >
                <Check
                  v-if="copiedTokenAppId === app.id"
                  class="size-3"
                />
                <Copy
                  v-else
                  class="size-3"
                />
              </Button>
            </div>

            <div
              v-if="
                !config.hasNoResource && config.getResources(app).length > 0
              "
              :ref="(element) => setResourceContainerRef(app.id, element)"
              :class="RESOURCE_CONTAINER_CLASS"
            >
              <span
                v-for="resource in getVisibleResources(app)"
                :key="resource.id"
                :class="RESOURCE_CHIP_CLASS"
              >
                {{ resource.label }}
              </span>
              <span
                v-if="getHiddenResourceCount(app.id) > 0"
                :class="RESOURCE_CHIP_CLASS"
              >
                {{ getHiddenResourcesLabel(getHiddenResourceCount(app.id)) }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <Button
              v-if="!app.hasCredentials"
              variant="ghost"
              size="icon-sm"
              :title="$t('integration.apps.resetCredentials')"
              :aria-label="$t('integration.apps.resetCredentials')"
              @click="handleOpenCredentialForm(app)"
            >
              <KeyRound class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-destructive hover:text-destructive"
              @click="handleDeleteApp(app.id)"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        </div>

        <div
          v-if="showAddForm"
          class="space-y-3 rounded-md border px-4 py-3"
        >
          <div
            v-for="field in config.createFormFields"
            :key="field.key"
            class="space-y-1"
          >
            <Input
              v-model="formValues[field.key]"
              :type="field.type"
              :placeholder="field.placeholder"
              :disabled="isResettingCredentials && field.key === 'name'"
            />
            <p
              v-if="isDirty && fieldErrors[field.key]"
              class="text-xs text-red-500"
            >
              {{ fieldErrors[field.key] }}
            </p>
          </div>

          <div class="flex justify-end gap-2">
            <Button
              variant="outline"
              @click="handleCancelAddForm"
            >
              {{ $t("common.cancel") }}
            </Button>
            <Button
              variant="default"
              :disabled="isSubmitting || !isFormValid"
              @click="handleConfirmAdd"
            >
              {{
                isSubmitting
                  ? $t("integration.apps.connecting")
                  : isResettingCredentials
                    ? $t("integration.apps.confirmCredentials")
                    : $t("integration.apps.confirmAdd")
              }}
            </Button>
          </div>
        </div>

        <Button
          v-if="!showAddForm"
          variant="outline"
          class="w-full"
          @click="handleOpenAddForm"
        >
          <Plus class="size-4" />
          {{ $t("integration.apps.addApp") }}
        </Button>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
