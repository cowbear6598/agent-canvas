<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, CheckCircle2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { RunGoalRoundDivider } from "@/types/run";

const props = defineProps<{
  divider: RunGoalRoundDivider;
}>();

const { t } = useI18n();

const sourcePodLabel = computed(() => {
  const names = props.divider.sourcePodNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const sourceIds = props.divider.sourcePodIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return names.length > 0 ? names.join("、") : sourceIds.join("、");
});

const isBlocked = computed(() => props.divider.status === "blocked");

const statusLabel = computed(() =>
  t(
    isBlocked.value
      ? "chat.goalRoundDivider.blockedLabel"
      : "chat.goalRoundDivider.completedLabel",
  ),
);

const blockedReason = computed(() => {
  if (!isBlocked.value) return null;

  return props.divider.blockedReason?.trim() || null;
});
</script>

<template>
  <div
    class="flex items-center gap-3 py-2"
    data-testid="goal-round-divider"
  >
    <div class="h-px flex-1 bg-border" />

    <div
      class="max-w-[82%] border border-doodle-ink bg-card shadow-[2px_2px_0_var(--doodle-ink)]"
      :class="
        isBlocked
          ? 'rounded-lg border-2 px-4 py-2 text-left'
          : 'rounded-full px-3 py-1.5 text-center'
      "
      :data-status="divider.status"
    >
      <div class="flex items-center justify-center gap-2 text-xs font-semibold">
        <CheckCircle2
          v-if="!isBlocked"
          class="h-3.5 w-3.5 text-emerald-600"
          aria-hidden="true"
        />
        <AlertTriangle
          v-else
          class="h-3.5 w-3.5 text-amber-600"
          aria-hidden="true"
        />
        <span class="text-foreground">{{ statusLabel }}</span>
      </div>

      <div class="mt-0.5 max-w-full truncate text-xs text-muted-foreground">
        {{ sourcePodLabel }}
      </div>

      <div
        v-if="blockedReason"
        class="mt-1 max-w-full whitespace-pre-wrap break-words text-[11px] leading-5 text-amber-700"
      >
        {{
          t("chat.goalRoundDivider.blockedReason", {
            reason: blockedReason,
          })
        }}
      </div>
    </div>

    <div class="h-px flex-1 bg-border" />
  </div>
</template>
