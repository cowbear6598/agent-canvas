<script setup lang="ts">
import { ref, watch, computed } from "vue";
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
import { MODEL_OPTIONS, TIMEZONE_OPTIONS } from "@/types";
import type { ModelType } from "@/types/pod";
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

const { showSuccessToast } = useToast();
const { withErrorToast } = useWebSocketErrorHandler();

const configStore = useConfigStore();

const summaryModel = ref<ModelType>("sonnet");
const aiDecideModel = ref<ModelType>("sonnet");
const timezoneOffset = ref<string>("8");
const isLoading = ref<boolean>(false);
const isSaving = ref<boolean>(false);
const loadFailed = ref<boolean>(false);

const backupGitRemoteUrl = ref<string>("");
const backupHour = ref<string>("03");
const backupMinute = ref<string>("00");
const backupEnabled = ref<boolean>(false);
const isBackingUp = ref<boolean>(false);
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
    const result = await withErrorToast(getConfig(), "Config", "載入失敗");
    if (!result) {
      loadFailed.value = true;
      return;
    }
    if (result.summaryModel) summaryModel.value = result.summaryModel;
    if (result.aiDecideModel) aiDecideModel.value = result.aiDecideModel;
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
    const tzOffset = Number(timezoneOffset.value);
    const backupTime = `${backupHour.value}:${backupMinute.value}`;
    const result = await withErrorToast(
      updateConfig({
        summaryModel: summaryModel.value,
        aiDecideModel: aiDecideModel.value,
        timezoneOffset: tzOffset,
        backupGitRemoteUrl: backupGitRemoteUrl.value,
        backupTime,
        backupEnabled: backupEnabled.value,
      }),
      "Config",
      "儲存失敗",
    );
    if (result) {
      configStore.setTimezoneOffset(tzOffset);
      configStore.setBackupConfig({
        gitRemoteUrl: backupGitRemoteUrl.value,
        time: backupTime,
        enabled: backupEnabled.value,
      });
      showSuccessToast("Config", "儲存成功");
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
  isBackingUp.value = true;
  try {
    await triggerBackup(backupGitRemoteUrl.value);
    showSuccessToast("Config", "備份已觸發");
  } catch (err) {
    const message = err instanceof Error ? err.message : "備份觸發失敗";
    backupError.value = message;
  } finally {
    isBackingUp.value = false;
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
    }
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>全域設定</DialogTitle>
        <DialogDescription>管理模型與全域參數設定</DialogDescription>
      </DialogHeader>

      <ScrollArea class="h-[420px] pr-3">
        <div class="space-y-4 py-2">
          <div class="space-y-2">
            <Label>總結模型</Label>
            <p class="text-xs text-muted-foreground">工作流總結時使用的模型</p>
            <Select v-model="summaryModel">
              <SelectTrigger>
                <SelectValue placeholder="選擇模型" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem
                  v-for="option in MODEL_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="border-t border-border" />

          <div class="space-y-2">
            <Label>AI 決策模型</Label>
            <p class="text-xs text-muted-foreground">
              AI Decide 連線判斷時使用的模型
            </p>
            <Select v-model="aiDecideModel">
              <SelectTrigger>
                <SelectValue placeholder="選擇模型" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem
                  v-for="option in MODEL_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="border-t border-border" />

          <div class="space-y-2">
            <Label>時區</Label>
            <p class="text-xs text-muted-foreground">排程觸發時間的時區設定</p>
            <Select v-model="timezoneOffset">
              <SelectTrigger>
                <SelectValue placeholder="選擇時區" />
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
                <Label>備份設定</Label>
                <p class="text-xs text-muted-foreground">
                  設定 Git 遠端儲存庫，定時自動備份畫布資料
                </p>
              </div>
              <Switch v-model="backupEnabled" />
            </div>

            <div class="relative">
              <Input
                v-model="backupGitRemoteUrl"
                placeholder="git@github.com:user/backup.git"
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
            <p v-if="backupUrlError" class="text-xs text-destructive">
              請填寫 Git Remote URL
            </p>
            <p v-if="backupError" class="text-xs text-destructive">
              {{ backupError }}
            </p>

            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-xs text-muted-foreground leading-none"
                  >每日備份時間</span
                >
                <Select v-model="backupHour" :disabled="!backupEnabled">
                  <SelectTrigger class="w-20">
                    <SelectValue placeholder="時" />
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
                <Select v-model="backupMinute" :disabled="!backupEnabled">
                  <SelectTrigger class="w-20">
                    <SelectValue placeholder="分" />
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
                {{ isBackingUp ? "備份中..." : "立即備份" }}
              </Button>
            </div>

            <div class="text-xs text-muted-foreground">
              <span v-if="configStore.lastBackupTime">
                上次備份：{{ configStore.lastBackupTime }}
              </span>
              <span v-else-if="configStore.backupStatus === 'running'">
                備份進行中...
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>

      <DialogFooter>
        <Button
          :disabled="isLoading || isSaving || loadFailed"
          @click="handleSave"
        >
          {{ isSaving ? "儲存中..." : "儲存" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
