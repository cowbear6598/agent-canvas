<script setup lang="ts">
import { AlertTriangle, FolderGit2, Package, Server } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { PodPackPreview } from "@/types";

defineProps<{ preview: PodPackPreview; busy?: boolean }>();
defineEmits<{ confirm: []; cancel: [] }>();
const { t } = useI18n();
</script>

<template>
  <div
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
    role="presentation"
    @mousedown.self="$emit('cancel')"
  >
    <section
      class="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border-2 border-doodle-ink bg-card p-5 shadow-xl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('podPack.import.title')"
    >
      <h2 class="text-lg font-semibold">
        {{ t("podPack.import.title") }}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ t("podPack.import.summary", { pods: preview.podCount, connections: preview.connectionCount }) }}
      </p>

      <div
        v-if="preview.repositories.length"
        class="mt-5"
      >
        <h3 class="flex items-center gap-2 font-medium">
          <FolderGit2 :size="17" />{{ t("podPack.import.repositories") }}
        </h3>
        <ul class="mt-2 space-y-2">
          <li
            v-for="repository in preview.repositories"
            :key="repository.originalKey"
            class="rounded-lg border p-3 text-sm"
          >
            <div class="flex justify-between gap-3">
              <span>{{ repository.name }}</span>
              <span class="text-muted-foreground">
                {{ t(`podPack.repositorySource.${repository.source}`) }} ·
                {{ t(`podPack.action.${repository.action}`) }}<template v-if="repository.resolvedName !== repository.name"> · {{ repository.resolvedName }}</template>
              </span>
            </div>
          </li>
        </ul>
      </div>

      <div
        v-if="preview.plugins.length"
        class="mt-5"
      >
        <h3 class="flex items-center gap-2 font-medium">
          <Package :size="17" />{{ t("podPack.import.plugins") }}
        </h3>
        <ul class="mt-2 space-y-2">
          <li
            v-for="plugin in preview.plugins"
            :key="plugin.originalKey"
            class="rounded-lg border p-3 text-sm"
          >
            <div class="flex justify-between gap-3">
              <span>{{ plugin.name }}</span><span
                v-if="plugin.action !== 'reuse'"
                class="text-muted-foreground"
              >{{ t(`podPack.action.${plugin.action}`) }}<template v-if="plugin.resolvedName !== plugin.name"> · {{ plugin.resolvedName }}</template></span>
            </div>
            <div
              v-if="plugin.skills?.length"
              class="mt-2 text-xs text-muted-foreground"
            >
              <p>{{ t("podPack.import.skills") }}</p>
              <ul class="mt-1 list-disc space-y-0.5 pl-5">
                <li
                  v-for="skill in plugin.skills"
                  :key="skill.skillName"
                  class="break-all"
                >
                  {{ skill.skillName }}
                </li>
              </ul>
            </div>
            <p
              v-if="plugin.executableFiles?.length"
              class="mt-2 flex items-start gap-1 text-xs text-amber-700"
            >
              <AlertTriangle
                :size="14"
                class="mt-0.5 shrink-0"
              /><span>{{ t("podPack.import.executableFiles", { count: plugin.executableFiles.length }) }}</span>
            </p>
          </li>
        </ul>
      </div>

      <div
        v-if="preview.omitted.length"
        class="mt-5 rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
      >
        <p class="font-medium text-foreground">
          {{ t("podPack.import.omitted") }}
        </p>
        <ul class="mt-1 list-disc pl-5">
          <li
            v-for="item in preview.omitted"
            :key="item"
          >
            {{ t(`podPack.omitted.${item}`) }}
          </li>
        </ul>
      </div>

      <div
        v-if="preview.managedMcps.length"
        class="mt-5"
      >
        <h3 class="flex items-center gap-2 font-medium">
          <Server :size="17" />{{ t("podPack.import.managedMcps") }}
        </h3>
        <ul class="mt-2 space-y-2">
          <li
            v-for="mcp in preview.managedMcps"
            :key="mcp.originalKey"
            class="rounded-lg border p-3 text-sm"
          >
            <div class="flex justify-between gap-3">
              <span>{{ mcp.name }}</span><span
                v-if="mcp.action !== 'reuse'"
                class="text-muted-foreground"
              >{{ t(`podPack.action.${mcp.action}`) }}<template v-if="mcp.resolvedName !== mcp.name"> · {{ mcp.resolvedName }}</template></span>
            </div>
            <p
              v-if="mcp.transport"
              class="mt-1 break-all text-xs text-muted-foreground"
            >
              {{ mcp.transport }} · {{ mcp.command ?? mcp.url }}<template v-if="mcp.args?.length">
                {{ mcp.args.join(" ") }}
              </template>
            </p>
            <p
              v-if="mcp.envKeys?.length"
              class="mt-1 text-xs text-muted-foreground"
            >
              {{ t("podPack.import.emptyEnv", { names: mcp.envKeys.join(", ") }) }}
            </p>
          </li>
        </ul>
      </div>

      <div class="mt-6 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border px-4 py-2 text-sm hover:bg-secondary"
          :disabled="busy"
          @click="$emit('cancel')"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          :disabled="busy"
          @click="$emit('confirm')"
        >
          {{ busy ? t("podPack.import.importing") : t("podPack.import.confirm") }}
        </button>
      </div>
    </section>
  </div>
</template>
