<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
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
import { Trash2, Plus, Copy, Check } from "lucide-vue-next";
import { getProvider } from "@/integration/providerRegistry";
import { useIntegrationStore } from "@/stores/integrationStore";

interface Props {
  open: boolean;
  provider: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const integrationStore = useIntegrationStore();

const config = computed(() => {
  if (!props.provider) return null;
  return getProvider(props.provider);
});
const apps = computed(() => integrationStore.getAppsByProvider(props.provider));

const showAddForm = ref(false);
const formValues = ref<Record<string, string>>({});
const isSubmitting = ref(false);
const copiedAppId = ref<string | null>(null);
const copiedTokenAppId = ref<string | null>(null);
const copyTimers: Record<string, ReturnType<typeof setTimeout>> = {};

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

function initFormValues(): void {
  const initial: Record<string, string> = {};
  config.value?.createFormFields.forEach((field) => {
    initial[field.key] = "";
  });
  formValues.value = initial;
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
  showAddForm.value = true;
};

const handleCancelAddForm = (): void => {
  showAddForm.value = false;
  resetForm();
};

const resetForm = (): void => {
  showAddForm.value = false;
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

  showAddForm.value = false;
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
        <DialogTitle>
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
              class="flex flex-wrap gap-1"
            >
              <span
                v-for="resource in config.getResources(app)"
                :key="resource.id"
                class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {{ resource.label }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
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
