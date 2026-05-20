<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { McpDisplayStatus } from "@/types/mcp";

interface Props {
  status: McpDisplayStatus;
  size?: "sm" | "md";
}

const props = withDefaults(defineProps<Props>(), {
  size: "sm",
});

const { t } = useI18n();

const badgeClass = computed(() => {
  switch (props.status) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "completed":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "blocked":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "disabled":
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
    case "idle":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "unknown":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
});

const sizeClass = computed(() =>
  props.size === "md" ? "px-2 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
);

const label = computed(() => t(`managedMcp.status.${props.status}` as const));
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center rounded-full border font-mono',
      sizeClass,
      badgeClass,
    ]"
  >
    {{ label }}
  </span>
</template>
