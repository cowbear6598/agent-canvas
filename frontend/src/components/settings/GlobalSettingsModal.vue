<script setup lang="ts">
import { watch } from "vue";
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
import WarningBox from "@/components/ui/WarningBox.vue";
import { Loader2 } from "lucide-vue-next";
import { TIMEZONE_OPTIONS } from "@/types";
import { useToast } from "@/composables/useToast";
import { useWebSocketErrorHandler } from "@/composables/useWebSocketErrorHandler";
import { useConfigStore } from "@/stores/configStore";
import { useSecurityStore } from "@/stores/securityStore";
import { LOCALE_OPTIONS } from "@/constants/locale";
import { useGlobalSettingsForm } from "@/composables/useGlobalSettingsForm";
import { useBackupSettingsForm } from "@/composables/useBackupSettingsForm";
import { useWorkspacePasswordForm } from "@/composables/useWorkspacePasswordForm";
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
const securityStore = useSecurityStore();

const hourOptions = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);

const minuteOptions = ["00", "15", "30", "45"];

const {
  timezoneOffset,
  currentLocale,
  isLoading,
  isSaving,
  loadFailed,
  loadConfig,
  handleSave: saveGlobalSettings,
} = useGlobalSettingsForm({
  configStore,
  t,
  showSuccessToast,
  withErrorToast,
});

const {
  backupGitRemoteUrl,
  backupHour,
  backupMinute,
  backupEnabled,
  backupUrlError,
  backupError,
  isBackingUp,
  isBackupActionsDisabled,
  applyLoadedConfig,
  validateBeforeSave,
  buildSavePayload,
  applySavedConfig,
  handleBackupRemoteInput,
  handleTriggerBackup,
} = useBackupSettingsForm({
  configStore,
  t,
});

const {
  workspaceCurrentPassword,
  workspaceNewPassword,
  workspaceSecurityError,
  isUpdatingWorkspacePassword,
  canSetWorkspacePassword,
  canRemoveWorkspacePassword,
  canChangeWorkspacePassword,
  resetWorkspaceSecurityForm,
  handleSetWorkspacePassword,
  handleChangeWorkspacePassword,
  handleRemoveWorkspacePassword,
} = useWorkspacePasswordForm({
  securityStore,
  t,
  showSuccessToast,
});

const handleSave = async (): Promise<void> => {
  if (!validateBeforeSave()) {
    return;
  }

  await saveGlobalSettings({
    backupPayload: buildSavePayload(),
    onBackupSaved: applySavedConfig,
    onSaved: () => emit("update:open", false),
  });
};

const handleClose = (): void => {
  emit("update:open", false);
};

watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      loadConfig({ onLoaded: applyLoadedConfig });
      resetWorkspaceSecurityForm();
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

          <div class="space-y-2">
            <Label>{{ $t("settings.language.title") }}</Label>
            <Select v-model="currentLocale">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem
                  v-for="option in LOCALE_OPTIONS"
                  :key="option.value"
                  :value="option.value"
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
                @input="handleBackupRemoteInput"
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

          <div class="border-t border-border" />

          <div class="space-y-3">
            <div>
              <Label>{{ t("security.workspace.settingsTitle") }}</Label>
              <p class="mt-1 text-xs text-muted-foreground">
                {{
                  securityStore.workspacePasswordEnabled
                    ? t("security.workspace.statusProtected")
                    : t("security.workspace.statusOpen")
                }}
              </p>
            </div>

            <WarningBox
              v-if="securityStore.showTransportRiskWarning"
              :title="t('security.transportWarning.title')"
              :description="t('security.transportWarning.description')"
            />

            <Input
              v-if="securityStore.workspacePasswordEnabled"
              v-model="workspaceCurrentPassword"
              type="password"
              :placeholder="t('security.workspace.currentPassword')"
              :disabled="
                isUpdatingWorkspacePassword ||
                  securityStore.isPasswordTransportBlocked
              "
            />
            <Input
              v-model="workspaceNewPassword"
              type="password"
              :placeholder="
                securityStore.workspacePasswordEnabled
                  ? t('security.workspace.newPassword')
                  : t('security.workspace.password')
              "
              :disabled="
                isUpdatingWorkspacePassword ||
                  securityStore.isPasswordTransportBlocked
              "
            />

            <p
              v-if="workspaceSecurityError"
              class="text-xs text-destructive"
            >
              {{ workspaceSecurityError }}
            </p>

            <div class="flex flex-wrap gap-2">
              <Button
                v-if="!securityStore.workspacePasswordEnabled"
                type="button"
                :disabled="!canSetWorkspacePassword"
                @click="handleSetWorkspacePassword"
              >
                {{ t("security.workspace.setPassword") }}
              </Button>
              <Button
                v-if="securityStore.workspacePasswordEnabled"
                type="button"
                variant="outline"
                :disabled="!canRemoveWorkspacePassword"
                @click="handleRemoveWorkspacePassword"
              >
                {{ t("security.workspace.removePassword") }}
              </Button>
              <Button
                v-if="securityStore.workspacePasswordEnabled"
                type="button"
                :disabled="!canChangeWorkspacePassword"
                @click="handleChangeWorkspacePassword"
              >
                {{ t("security.workspace.changePassword") }}
              </Button>
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
