<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, type Component } from "vue";
import {
  ArrowRightLeft,
  Brain,
  Check,
  ChevronRight,
  Download,
  Eraser,
  Plug,
} from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import AnthropicLogo from "@/components/icons/AnthropicLogo.vue";
import OpenAILogo from "@/components/icons/OpenAILogo.vue";
import OpencodeLogo from "@/components/icons/OpencodeLogo.vue";
import { downloadPodDirectory } from "@/services/podApi";
import { getActiveCanvasIdOrWarn } from "@/utils/canvasGuard";
import { generateUUID } from "@/services/utils";
import { usePodStore } from "@/stores";
import { getAllProviders } from "@/integration/providerRegistry";
import { useDownloadProgress } from "@/composables/canvas/useDownloadProgress";
import { useProviderCapabilityStore } from "@/stores/providerCapabilityStore";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import { useToast } from "@/composables/useToast";
import {
  isProviderSelectionDisabled,
  resolveDefaultProviderConfig,
} from "@/lib/providerSelection";

interface Props {
  position: { x: number; y: number };
  podId: string;
  memoryEnabled?: boolean;
  hasPodMemory?: boolean;
}

const AI_PROVIDER_OPTIONS: Array<{
  value: PodProvider;
  label: string;
  icon: Component;
}> = [
  { value: "claude", label: "Claude", icon: AnthropicLogo },
  { value: "codex", label: "Codex", icon: OpenAILogo },
  { value: "opencode", label: "OpenCode", icon: OpencodeLogo },
];

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  "switch-provider": [
    podId: string,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ];
  "set-memory-enabled": [podId: string, memoryEnabled: boolean];
  "set-repo-memory-enabled": [repositoryId: string, memoryEnabled: boolean];
  "clear-memory": [podId: string];
  "connect-integration": [podId: string, provider: string];
  "disconnect-integration": [podId: string, provider: string];
}>();

const { t } = useI18n();
const { toast } = useToast();
const providerCapabilityStore = useProviderCapabilityStore();

const pod = computed(() => usePodStore().getPodById(props.podId));
const bindings = computed(() => pod.value?.integrationBindings ?? []);
const currentProvider = computed(() => pod.value?.provider ?? null);
const isMemoryEnabled = computed(
  () => pod.value?.memoryEnabled ?? props.memoryEnabled ?? false,
);
const hasPodMemory = computed(
  () => pod.value?.hasPodMemory ?? props.hasPodMemory ?? false,
);
const repositoryId = computed(() => pod.value?.repositoryId ?? null);
const isRepoMemoryEnabled = computed(
  () => pod.value?.repoMemoryEnabled ?? false,
);
const integrationProviders = getAllProviders();

const downloadProgress = useDownloadProgress();

const menuRef = ref<HTMLElement | null>(null);
const isProviderMenuOpen = ref(false);
const isIntegrationMenuOpen = ref(false);

const isBound = (provider: string): boolean =>
  bindings.value.some((binding) => binding.provider === provider);

const isCurrentProvider = (provider: PodProvider): boolean =>
  currentProvider.value === provider;

const isProviderDisabled = (provider: PodProvider): boolean =>
  isProviderSelectionDisabled(providerCapabilityStore, provider);

const handleOutsideClick = (event: MouseEvent): void => {
  const menuEl = menuRef.value;

  const insideMenu = menuEl?.contains(event.target as Node) ?? false;

  if (insideMenu) return;

  if (event.button !== 2) {
    event.stopPropagation();
  }

  emit("close");
};

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideClick, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick, true);
});

const handleDownloadDirectory = (): void => {
  const canvasId = getActiveCanvasIdOrWarn("PodContextMenu");
  if (!canvasId) return;

  const taskId = generateUUID();
  const podName = pod.value?.name ?? props.podId;

  downloadProgress.addTask(taskId, podName);

  emit("close");

  downloadPodDirectory(canvasId, props.podId, (downloadedBytes) => {
    downloadProgress.updateProgress(taskId, downloadedBytes);
  })
    .then(() => {
      downloadProgress.completeTask(taskId);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : t("canvas.podContextMenu.downloadDirectoryFailed");
      downloadProgress.failTask(taskId, message);
    });
};

function showProviderUnavailableToast(provider: PodProvider): void {
  toast({
    title: t("shared.providerModelSelector.providerLabel"),
    description:
      provider === "opencode"
        ? t("pod.modelSelector.opencode.emptyPlaceholder")
        : t("pod.provider.loadingHint"),
    variant: "default",
  });
}

function resolveProviderConfig(provider: PodProvider): ProviderConfig | null {
  const providerConfig = resolveDefaultProviderConfig(
    providerCapabilityStore,
    provider,
  );
  if (!providerConfig) {
    showProviderUnavailableToast(provider);
    return null;
  }
  return providerConfig;
}

const handleSwitchProvider = (provider: PodProvider): void => {
  if (isCurrentProvider(provider)) {
    emit("close");
    return;
  }

  const providerConfig = resolveProviderConfig(provider);
  if (!providerConfig) return;

  emit("switch-provider", props.podId, provider, providerConfig);
  emit("close");
};

const handleConnect = (provider: string): void => {
  emit("connect-integration", props.podId, provider);
  emit("close");
};

const handleDisconnect = (provider: string): void => {
  emit("disconnect-integration", props.podId, provider);
  emit("close");
};

const handleSetMemoryEnabled = (memoryEnabled: boolean): void => {
  emit("set-memory-enabled", props.podId, memoryEnabled);
  emit("close");
};

const handleSetRepoMemoryEnabled = (memoryEnabled: boolean): void => {
  if (!repositoryId.value) return;
  emit("set-repo-memory-enabled", repositoryId.value, memoryEnabled);
  emit("close");
};

const handleClearMemory = (): void => {
  if (!hasPodMemory.value) return;
  emit("clear-memory", props.podId);
  emit("close");
};
</script>

<template>
  <div
    ref="menuRef"
    class="bg-card border border-doodle-ink rounded-md p-1 fixed z-50"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
    }"
    @contextmenu.prevent
  >
    <button
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      @click="handleDownloadDirectory"
    >
      <Download :size="14" />
      <span class="font-mono">{{
        $t("canvas.podContextMenu.downloadDirectory")
      }}</span>
    </button>

    <div class="my-1 border-t border-border" />

    <button
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      @click="handleSetMemoryEnabled(!isMemoryEnabled)"
    >
      <Brain :size="14" />
      <span class="font-mono">{{
        isMemoryEnabled
          ? $t("canvas.podContextMenu.disableMemory")
          : $t("canvas.podContextMenu.enableMemory")
      }}</span>
    </button>

    <button
      v-if="repositoryId"
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
      @click="handleSetRepoMemoryEnabled(!isRepoMemoryEnabled)"
    >
      <Brain :size="14" />
      <span class="font-mono">{{
        isRepoMemoryEnabled
          ? $t("canvas.podContextMenu.disableRepoMemory")
          : $t("canvas.podContextMenu.enableRepoMemory")
      }}</span>
    </button>

    <button
      :disabled="!hasPodMemory"
      :title="
        !hasPodMemory
          ? $t('canvas.podContextMenu.clearMemoryDisabled')
          : undefined
      "
      :class="[
        'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs',
        hasPodMemory
          ? 'hover:bg-secondary'
          : 'cursor-not-allowed opacity-60',
      ]"
      @click="handleClearMemory"
    >
      <Eraser :size="14" />
      <span class="font-mono">{{
        $t("canvas.podContextMenu.clearMemory")
      }}</span>
    </button>

    <div class="my-1 border-t border-border" />

    <div
      class="relative"
      @mouseenter="isProviderMenuOpen = true"
      @mouseleave="isProviderMenuOpen = false"
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isProviderMenuOpen }"
      >
        <span class="flex items-center gap-2">
          <ArrowRightLeft :size="14" />
          <span class="font-mono">{{
            $t("canvas.podContextMenu.convertProvider")
          }}</span>
        </span>
        <ChevronRight
          :size="12"
          class="text-muted-foreground"
        />
      </button>

      <div
        v-if="isProviderMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="isProviderMenuOpen = true"
        @mouseleave="isProviderMenuOpen = false"
      >
        <div
          class="bg-card border border-doodle-ink rounded-md p-1 min-w-[180px]"
        >
          <div
            v-for="provider in AI_PROVIDER_OPTIONS"
            :key="provider.value"
            @click="() => handleSwitchProvider(provider.value)"
          >
            <button
              :disabled="isProviderDisabled(provider.value)"
              :class="[
                'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary',
                {
                  'bg-secondary': isCurrentProvider(provider.value),
                  'cursor-not-allowed opacity-60':
                    isProviderDisabled(provider.value),
                },
              ]"
            >
              <component
                :is="provider.icon"
                :size="14"
              />
              <span
                :class="[
                  'font-mono flex-1',
                  isCurrentProvider(provider.value)
                    ? 'font-semibold'
                    : '',
                ]"
              >
                {{ provider.label }}
              </span>
              <Check
                v-if="isCurrentProvider(provider.value)"
                :size="12"
              />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="my-1 border-t border-border" />

    <div
      class="relative"
      @mouseenter="isIntegrationMenuOpen = true"
      @mouseleave="isIntegrationMenuOpen = false"
    >
      <button
        class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
        :class="{ 'bg-secondary': isIntegrationMenuOpen }"
      >
        <span class="flex items-center gap-2">
          <Plug :size="14" />
          <span class="font-mono">{{
            $t("canvas.podContextMenu.integrations")
          }}</span>
        </span>
        <ChevronRight
          :size="12"
          class="text-muted-foreground"
        />
      </button>

      <div
        v-if="isIntegrationMenuOpen"
        class="absolute left-full top-0 pl-1 z-50"
        @mouseenter="isIntegrationMenuOpen = true"
        @mouseleave="isIntegrationMenuOpen = false"
      >
        <div
          class="bg-card border border-doodle-ink rounded-md p-1 min-w-[220px]"
        >
          <button
            v-for="provider in integrationProviders"
            :key="provider.name"
            class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
            @click="
              isBound(provider.name)
                ? handleDisconnect(provider.name)
                : handleConnect(provider.name)
            "
          >
            <component
              :is="provider.icon"
              :size="14"
            />
            <span class="font-mono">
              {{
                isBound(provider.name)
                  ? $t("canvas.podContextMenu.disconnect", {
                    label: provider.label,
                  })
                  : $t("canvas.podContextMenu.connect", {
                    label: provider.label,
                  })
              }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
