<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useEscapeClose } from "@/composables/useEscapeClose";
import { useI18n } from "vue-i18n";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useManagedPluginStore } from "@/stores/managedPluginStore";
import { updatePodPlugins as updatePodPluginsApi } from "@/services/podPluginApi";
import { usePodStore } from "@/stores/pod";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { useOptimisticToggle } from "@/composables/pod/useOptimisticToggle";
import { type InstalledPlugin } from "@/types/plugin";
import { shouldPreservePodResourceMenu } from "@/lib/podResourceMenu";
import type { PodProvider } from "@/types/pod";
import type { CodexSkillAvailabilityItem } from "@/types/codexSkill";
import {
  groupCodexSkillResources,
  type CodexSkillResource,
} from "@/lib/codexSkillResource";
import {
  listPodCodexSkills,
  updatePodCodexSkills,
} from "@/services/podCodexSkillApi";

const POPOVER_ANCHOR_GAP_PX = 8;

const props = defineProps<{
  podId: string;
  anchorRect: DOMRect;
  provider: PodProvider;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const podStore = usePodStore();
const managedPluginStore = useManagedPluginStore();
const { isToggling: isBundleDraftDirty, runToggle } = useOptimisticToggle();
const { isToggling: isSkillDraftDirty, runToggle: runSkillToggle } =
  useOptimisticToggle();

const localPluginIds = ref<string[]>([]);
const localSkillKeys = ref<string[]>([]);
const codexSkills = ref<CodexSkillAvailabilityItem[]>([]);
const skillsLoading = ref(false);
const skillsLoadFailed = ref(false);

const searchQuery = ref<string>("");
const searchInputRef = ref<HTMLInputElement | null>(null);

const loading = computed(() => managedPluginStore.loading);
const hasBundleCache = computed(
  () => managedPluginStore.loaded || managedPluginStore.plugins.length > 0,
);
const showLoading = computed(() => loading.value && !hasBundleCache.value);
const loadFailed = computed(
  () =>
    managedPluginStore.error !== null &&
    !loading.value &&
    !hasBundleCache.value,
);

const filteredBundles = computed<InstalledPlugin[]>(() => {
  const bundles = managedPluginStore.plugins;
  if (!searchQuery.value) return bundles;
  const query = searchQuery.value.toLowerCase();
  return bundles.filter(
    (bundle) =>
      bundle.displayName.toLowerCase().includes(query) ||
      bundle.source.ref.toLowerCase().includes(query),
  );
});

const skillResources = computed(() => {
  if (props.provider !== "codex") return [];
  return groupCodexSkillResources(codexSkills.value);
});

const filteredSkillResources = computed<CodexSkillResource[]>(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return skillResources.value;
  return skillResources.value.filter(
    (resource) =>
      resource.label.toLowerCase().includes(query) ||
      resource.items.some(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query) ||
          skill.scope.toLowerCase().includes(query),
      ),
  );
});

const skillGroups = computed(() =>
  (["custom", "official"] as const)
    .map((origin) => ({
      origin,
      resources: filteredSkillResources.value.filter(
        (resource) => resource.origin === origin,
      ),
    }))
    .filter((group) => group.resources.length > 0),
);

const showGroupDivider = computed(
  () =>
    filteredBundles.value.length > 0 && filteredSkillResources.value.length > 0,
);

const hasVisibleRows = computed(
  () =>
    filteredBundles.value.length > 0 || filteredSkillResources.value.length > 0,
);

const anyLoading = computed(
  () => showLoading.value || (props.provider === "codex" && skillsLoading.value),
);

const showSearchEmpty = computed(
  () =>
    searchQuery.value.trim().length > 0 &&
    !hasVisibleRows.value &&
    !anyLoading.value,
);

const showEmpty = computed(
  () =>
    searchQuery.value.trim().length === 0 &&
    !hasVisibleRows.value &&
    !anyLoading.value &&
    !loadFailed.value &&
    !skillsLoadFailed.value,
);

const localPluginIdsSet = computed(() => new Set(localPluginIds.value));
const localSkillKeysSet = computed(() => new Set(localSkillKeys.value));

const rootRef = ref<HTMLElement | null>(null);

const handleMousedown = (event: MouseEvent): void => {
  if (!rootRef.value) return;
  if (shouldPreservePodResourceMenu(event, props.podId)) return;
  if (!rootRef.value.contains(event.target as Node)) {
    emit("close");
  }
};

const initLocalPluginIds = (): void => {
  const pod = podStore.getPodById(props.podId);
  localPluginIds.value = [...(pod?.pluginIds ?? [])];
  localSkillKeys.value = [...(pod?.codexSkillKeys ?? [])];
};

const loadCodexSkills = async (): Promise<void> => {
  if (props.provider !== "codex") return;
  const canvasId = getActiveCanvasIdOrWarn("PluginPopover");
  if (!canvasId) return;

  skillsLoading.value = true;
  skillsLoadFailed.value = false;
  try {
    const result = await listPodCodexSkills(canvasId, props.podId);
    codexSkills.value = result.items;
    localSkillKeys.value = [...result.selectedKeys];
    podStore.updatePodCodexSkills(props.podId, result.selectedKeys);
  } catch {
    skillsLoadFailed.value = true;
  } finally {
    skillsLoading.value = false;
  }
};

const focusSearchInput = async (): Promise<void> => {
  await nextTick();
  searchInputRef.value?.focus();
};

const refreshBundlesInBackground = (): void => {
  // 只背景刷新已匯入的 bundle 清單，避免 late refresh 覆蓋使用者正在切換的本地 draft。
  void managedPluginStore.refresh();
};

onMounted(() => {
  initLocalPluginIds();
  refreshBundlesInBackground();
  void loadCodexSkills();
  void focusSearchInput();
  document.addEventListener("mousedown", handleMousedown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleMousedown, true);
});

useEscapeClose(() => emit("close"));

const buildNextIds = (
  current: string[],
  pluginId: string,
  enabled: boolean,
): string[] => {
  if (enabled) {
    return current.includes(pluginId) ? [...current] : [...current, pluginId];
  }
  return current.filter((id) => id !== pluginId);
};

const resolvePluginErrorDescription = (_err: unknown): string =>
  t("pod.slot.pluginsToggleFailed");

const handleToggle = async (
  pluginId: string,
  enabled: boolean,
): Promise<void> => {
  const nextIds = buildNextIds(localPluginIds.value, pluginId, enabled);

  const canvasId = getActiveCanvasIdOrWarn("PluginPopover");
  if (!canvasId) return;

  await runToggle(nextIds, {
    getCurrent: () => [...localPluginIds.value],
    setLocal: (items) => {
      localPluginIds.value = items;
    },
    setStore: (items) => podStore.updatePodPlugins(props.podId, items),
    callApi: (items) => updatePodPluginsApi(canvasId, props.podId, items),
    resolveError: resolvePluginErrorDescription,
    failToast: { title: "Pod" },
  });
};

const resolveSkillErrorDescription = (_err: unknown): string =>
  t("pod.slot.skillsToggleFailed");

const getSelectableSkillKeys = (resource: CodexSkillResource): string[] =>
  resource.items
    .filter((skill) => skill.globallyEnabled)
    .map((skill) => skill.key);

const isSkillResourceEnabled = (resource: CodexSkillResource): boolean => {
  const selectableKeys = getSelectableSkillKeys(resource);
  return (
    selectableKeys.length > 0 &&
    selectableKeys.every((key) => localSkillKeysSet.value.has(key))
  );
};

const isSkillResourceGloballyDisabled = (
  resource: CodexSkillResource,
): boolean => getSelectableSkillKeys(resource).length === 0;

const handleSkillToggle = async (
  resource: CodexSkillResource,
  enabled: boolean,
): Promise<void> => {
  const resourceKeys = new Set(getSelectableSkillKeys(resource));
  if (resourceKeys.size === 0) return;

  const nextKeys = enabled
    ? [...new Set([...localSkillKeys.value, ...resourceKeys])]
    : localSkillKeys.value.filter((key) => !resourceKeys.has(key));
  const canvasId = getActiveCanvasIdOrWarn("PluginPopover");
  if (!canvasId) return;

  await runSkillToggle(nextKeys, {
    getCurrent: () => [...localSkillKeys.value],
    setLocal: (items) => {
      localSkillKeys.value = items;
    },
    setStore: (items) => podStore.updatePodCodexSkills(props.podId, items),
    callApi: (items) => updatePodCodexSkills(canvasId, props.podId, items),
    resolveError: resolveSkillErrorDescription,
    failToast: { title: "Pod" },
  });
};
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      :data-resource-menu-pod-id="podId"
      class="fixed z-50 min-w-72 rounded-md border border-doodle-ink bg-card p-2 shadow-md"
      :style="{
        left: `${anchorRect.left - POPOVER_ANCHOR_GAP_PX}px`,
        top: `${anchorRect.top}px`,
        transform: 'translateX(-100%)',
      }"
      @click.stop
    >
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="pod-popover-search"
        type="text"
        :placeholder="t('pod.slot.searchPlaceholder')"
        @click.stop
      >

      <ScrollArea
        v-if="hasVisibleRows"
        class="pod-popover-scrollable"
      >
        <div class="space-y-1 pr-3">
          <p
            v-if="filteredBundles.length > 0"
            data-testid="plugin-origin-canvas"
            class="px-2 pt-1 text-[10px] font-mono text-muted-foreground"
          >
            {{ t("pod.slot.canvasInstalledPlugins") }}
          </p>
          <div
            v-for="bundle in filteredBundles"
            :key="bundle.id"
            class="group relative flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-secondary"
          >
            <div class="min-w-0">
              <p class="truncate text-xs font-mono">
                {{ bundle.displayName }}
              </p>
            </div>
            <Switch
              :model-value="localPluginIdsSet.has(bundle.id)"
              :disabled="isBundleDraftDirty"
              @click.stop
              @update:model-value="
                (val: boolean) => handleToggle(bundle.id, val)
              "
            />
          </div>

          <div
            v-if="showGroupDivider"
            data-testid="plugin-skill-group-divider"
            class="my-1 border-t border-dashed border-doodle-ink/40"
          />

          <template
            v-for="(skillGroup, groupIndex) in skillGroups"
            :key="skillGroup.origin"
          >
            <div
              v-if="groupIndex > 0"
              data-testid="skill-origin-group-divider"
              class="my-1 border-t border-dashed border-doodle-ink/40"
            />
            <p
              :data-testid="`skill-origin-${skillGroup.origin}`"
              class="px-2 pt-1 text-[10px] font-mono text-muted-foreground"
            >
              {{ t(`pod.slot.skillOrigin.${skillGroup.origin}`) }}
            </p>
            <div
              v-for="resource in skillGroup.resources"
              :key="resource.id"
              data-testid="codex-skill-resource"
              :data-resource-id="resource.id"
              class="group relative flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-secondary"
              :title="resource.items.map((skill) => skill.description).join('\n')"
            >
              <div class="min-w-0">
                <p class="truncate text-xs font-mono">
                  {{ resource.label }}
                </p>
              </div>
              <Switch
                :model-value="isSkillResourceEnabled(resource)"
                :disabled="
                  isSkillDraftDirty || isSkillResourceGloballyDisabled(resource)
                "
                :title="
                  isSkillResourceGloballyDisabled(resource)
                    ? t('pod.slot.skillGloballyDisabled')
                    : undefined
                "
                @click.stop
                @update:model-value="
                  (val: boolean) => handleSkillToggle(resource, val)
                "
              />
            </div>
          </template>
        </div>
      </ScrollArea>

      <div
        v-if="anyLoading && !hasVisibleRows"
        class="flex items-center gap-2 px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        <span
          class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        <span>{{ t("pod.slot.resourcesLoading") }}</span>
      </div>

      <div
        v-if="loadFailed && filteredBundles.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ t("pod.slot.pluginsLoadFailed") }}
      </div>

      <div
        v-if="skillsLoadFailed && codexSkills.length === 0"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ t("pod.slot.skillsLoadFailed") }}
      </div>

      <div
        v-if="showSearchEmpty"
        class="px-2 py-1 text-xs font-mono text-muted-foreground"
      >
        {{ t("pod.slot.pluginsSearchEmpty") }}
      </div>

      <div
        v-if="showEmpty"
        class="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
      >
        {{ t("pod.slot.resourcesEmpty") }}
      </div>
    </div>
  </Teleport>
</template>
