<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSecurityStore } from "@/stores/securityStore";

const securityStore = useSecurityStore();
const { t } = useI18n();
const password = ref("");

const isSubmitting = computed(
  () => securityStore.isUnlockingWorkspace || securityStore.bootStatus === "reconnecting",
);
const isUnlockDisabled = computed(
  () =>
    isSubmitting.value ||
    securityStore.isPasswordTransportBlocked ||
    !password.value.trim(),
);

const handleSubmit = async (): Promise<void> => {
  if (!password.value.trim() || isSubmitting.value) {
    return;
  }

  try {
    await securityStore.unlockWorkspace(password.value);
    password.value = "";
  } catch {
    // 錯誤訊息由 store 維護，這裡不重複處理
  }
};
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background px-6">
    <div class="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
      <div class="space-y-2 text-center">
        <h1 class="text-2xl font-semibold">
          {{ t("security.workspace.unlockTitle") }}
        </h1>
        <p class="text-sm text-muted-foreground">
          {{ t("security.workspace.unlockDescription") }}
        </p>
      </div>

      <form
        class="mt-6 space-y-4"
        @submit.prevent="handleSubmit"
      >
        <Input
          v-model="password"
          type="password"
          :placeholder="t('security.workspace.password')"
          :disabled="isSubmitting || securityStore.isPasswordTransportBlocked"
        />

        <p
          v-if="securityStore.lastUnlockError"
          class="text-sm text-destructive"
        >
          {{ securityStore.lastUnlockError }}
        </p>

        <Button
          type="submit"
          class="w-full"
          :disabled="isUnlockDisabled"
        >
          {{
            securityStore.bootStatus === "reconnecting"
              ? t("security.workspace.reconnecting")
              : t("security.workspace.unlockAction")
          }}
        </Button>
      </form>
    </div>
  </div>
</template>
