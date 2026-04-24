<script setup lang="ts">
import { ref, watch, computed } from "vue";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-vue-next";
import { getConfig, updateConfig } from "@/services/configApi";
import { triggerBackup } from "@/services/backupApi";
import { TIMEZONE_OPTIONS } from "@/types";
import { useToast } from "@/composables/useToast";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { useConfigStore } from "@/stores/configStore";

interface Props {
  open: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();
const { showSuccessToast } = useToast();
const { withErrorToast } = useWebSocketErrorHandler();

const configStore = useConfigStore();

const timezoneOffset = ref<string>("8");
const isLoading = ref<boolean>(false);
const isSaving = ref<boolean>(false);
const loadFailed = ref<boolean>(false);

const backupGitRemoteUrl = ref<string>("");
const backupHour = ref<string>("03");
const backupMinute = ref<string>("00");
const backupEnabled = ref<boolean>(false);
const isBackingUp = computed<boolean>(
  () => configStore.backupStatus === "running",
);
const backupUrlError = ref<boolean>(false);
const backupError = ref<string | null>(null);

const isBackupActionsDisabled = computed<boolean>(
  () => !backupEnabled.value || backupGitRemoteUrl.value === "",
);

const hourOptions = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);

const minuteOptions = ["00", "15", "30", "45"];

const loadConfig = async (): Promise<void> => {
  isLoading.value = true;
  loadFailed.value = false;
  try {
    const result = await withErrorToast(
      getConfig(),
      "Config",
      t("settings.loadFailed"),
    );
    if (!result) {
      loadFailed.value = true;
      return;
    }
    if (result.timezoneOffset !== undefined) {
      timezoneOffset.value = String(result.timezoneOffset);
      configStore.setTimezoneOffset(result.timezoneOffset);
    }
    backupGitRemoteUrl.value = result.backupGitRemoteUrl ?? "";
    backupEnabled.value = result.backupEnabled ?? false;
    if (result.backupTime) {
      const parts = result.backupTime.split(":");
      backupHour.value = parts[0] ?? "03";
      backupMinute.value = parts[1] ?? "00";
    }
    configStore.setBackupConfig({
      gitRemoteUrl: backupGitRemoteUrl.value,
      time: `${backupHour.value}:${backupMinute.value}`,
      enabled: backupEnabled.value,
    });
  } finally {
    isLoading.value = false;
  }
};

const handleSave = async (): Promise<void> => {
  // 若備份已啟用但未填寫 Remote URL，阻擋儲存並顯示 inline 錯誤
  if (backupEnabled.value && backupGitRemoteUrl.value.trim() === "") {
    backupUrlError.value = true;
    return;
  }
  isSaving.value = true;
  try {
    // 關閉備份時，送出空字串；但先不修改 UI，等 API 成功後再更新
    const urlToSend = backupEnabled.value ? backupGitRemoteUrl.value : "";
    const tzOffset = Number(timezoneOffset.value);
    const backupTime = `${backupHour.value}:${backupMinute.value}`;
    const result = await withErrorToast(
      updateConfig({
        timezoneOffset: tzOffset,
        backupGitRemoteUrl: urlToSend,
        backupTime,
        backupEnabled: backupEnabled.value,
      }),
      "Config",
      t("settings.saveFailed"),
    );
    if (result) {
      // API 成功後才更新 UI 狀態，避免失敗時 URL 被錯誤清空
      backupGitRemoteUrl.value = urlToSend;
      configStore.setTimezoneOffset(tzOffset);
      configStore.setBackupConfig({
        gitRemoteUrl: urlToSend,
        time: backupTime,
        enabled: backupEnabled.value,
      });
      showSuccessToast("Config", t("settings.saveSuccess"));
      emit("update:open", false);
    }
  } finally {
    isSaving.value = false;
  }
};

const handleClose = (): void => {
  emit("update:open", false);
};

const handleTriggerBackup = async (): Promise<void> => {
  backupError.value = null;
  try {
    await triggerBackup(backupGitRemoteUrl.value);
    // 不跳 Toast；後端會推送 BACKUP_STARTED 事件，store 狀態自動更新
  } catch (err) {
    const message =
      err instanceof Error ? err.message : t("settings.backup.backingUp");
    backupError.value = message;
  }
};

watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      loadConfig();
    }
  },
  { immediate: true },
);

// 排程備份失敗時同步顯示 inline 錯誤，補足 catch 只能捕捉手動觸發的情境
watch(
  () => ({
    status: configStore.backupStatus,
    error: configStore.lastBackupError,
  }),
  ({ status, error }) => {
    if (status === "failed" && error) {
      backupError.value = error;
    } else if (status === "running") {
      backupError.value = null;
    }
  },
);
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>{{ $t("settings.title") }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ $t("settings.title") }}
        </DialogDescription>
      </DialogHeader>

      <ScrollArea class="h-[420px] pr-3">
        <div class="space-y-4 py-2">
          <div class="space-y-2">
            <Label>{{ $t("settings.timezone") }}</Label>
            <Select v-model="timezoneOffset">
              <SelectTrigger>
                <SelectValue
                  :placeholder="$t('settings.timezonePlaceholder')"
                />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem
                  v-for="option in TIMEZONE_OPTIONS"
                  :key="option.value"
                  :value="String(option.value)"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="border-t border-border" />

          <!-- 備份設定區塊 -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <Label>{{ $t("settings.backup.title") }}</Label>
              </div>
              <Switch v-model="backupEnabled" />
            </div>

            <div class="relative">
              <Input
                v-model="backupGitRemoteUrl"
                :placeholder="$t('settings.backup.gitRemoteUrlPlaceholder')"
                :disabled="!backupEnabled || isBackingUp"
                :class="[
                  backupUrlError ? 'border-destructive' : '',
                  isBackingUp ? 'pr-8' : '',
                ]"
                @input="
                  backupUrlError = false;
                  backupError = null;
                "
              />
              <Loader2
                v-if="isBackingUp"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
              />
            </div>
            <p
              v-if="backupUrlError"
              class="text-xs text-destructive"
            >
              {{ $t("settings.backup.gitRemoteUrlRequired") }}
            </p>
            <p
              v-if="backupError"
              class="text-xs text-destructive"
            >
              {{ backupError }}
            </p>

            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-muted-foreground leading-none">{{
                  $t("settings.backup.dailyBackupTime")
                }}</span>
                <Select
                  v-model="backupHour"
                  :disabled="!backupEnabled"
                >
                  <SelectTrigger class="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem
                      v-for="hour in hourOptions"
                      :key="hour"
                      :value="hour"
                    >
                      {{ hour }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <span class="text-sm leading-none">:</span>
                <Select
                  v-model="backupMinute"
                  :disabled="!backupEnabled"
                >
                  <SelectTrigger class="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem
                      v-for="minute in minuteOptions"
                      :key="minute"
                      :value="minute"
                    >
                      {{ minute }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="isBackupActionsDisabled || isBackingUp"
                @click="handleTriggerBackup"
              >
                {{
                  isBackingUp
                    ? $t("settings.backup.backingUp")
                    : $t("settings.backup.backupNow")
                }}
              </Button>
            </div>

            <div
              v-if="configStore.lastBackupTime"
              class="text-xs text-muted-foreground"
            >
              {{
                $t("settings.backup.lastBackup", {
                  time: configStore.lastBackupTime,
                })
              }}
            </div>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button
          :disabled="isLoading || isSaving || loadFailed"
          @click="handleSave"
        >
          {{ isSaving ? $t("settings.saving") : $t("common.save") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
