<template>
  <header
    class="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md"
    @contextmenu.prevent
  >
    <div class="container mx-auto flex h-16 items-center justify-between px-4">
      <div class="flex items-center gap-3">
        <Sparkles class="h-6 w-6 text-primary" />
        <h1
          class="text-2xl font-bold tracking-tight"
          style="font-family: var(--font-handwriting)"
        >
          Agent Canvas
        </h1>
      </div>

      <div class="flex items-center gap-4">
        <ConnectionStatus />

        <button
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          :title="$t('layout.header.globalSettings')"
          @click="showSettingsModal = true"
        >
          <Settings class="h-4 w-4" />
        </button>

        <button
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          :title="$t('layout.header.integrationsHub')"
          @click="showIntegrationsHubModal = true"
        >
          <Boxes class="h-4 w-4" />
        </button>

        <button
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          :title="$t('layout.header.integrations')"
          @click="showIntegrationModal = true"
        >
          <KeyRound class="h-4 w-4" />
        </button>

        <button
          data-history-toggle
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          :title="$t('layout.header.history')"
          @click="runStore.toggleHistoryPanel()"
        >
          <History class="h-4 w-4" />
        </button>

        <button
          v-if="canvasStore.canvases.length > 0"
          data-canvas-toggle
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
          @click="canvasStore.toggleSidebar()"
        >
          <LayoutDashboard class="h-4 w-4" />
          <span>{{
            canvasStore.activeCanvas?.name ?? $t("layout.header.canvasList")
          }}</span>
        </button>
      </div>
    </div>
  </header>

  <IntegrationSelectModal
    v-model:open="showIntegrationModal"
    @select="handleIntegrationSelect"
  />
  <IntegrationAppsModal
    :open="selectedProvider !== null"
    :provider="selectedProvider ?? ''"
    @update:open="selectedProvider = null"
  />
  <ManagedMcpModal v-model:open="showManagedMcpModal" />
  <ManagedPluginModal v-model:open="showManagedPluginModal" />
  <GlobalSettingsModal v-model:open="showSettingsModal" />
  <LlmProviderModal v-model:open="showLlmProviderModal" />
  <IntegrationsHubModal
    v-model:open="showIntegrationsHubModal"
    @select-mcp="openMcpFromHub"
    @select-plugin="openPluginFromHub"
    @select-llm-provider="openLlmProviderFromHub"
  />
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import {
  Sparkles,
  LayoutDashboard,
  KeyRound,
  Settings,
  History,
  Boxes,
} from "lucide-vue-next";
import ConnectionStatus from "@/components/ui/ConnectionStatus.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRunStore } from "@/stores/run/runStore";

const IntegrationSelectModal = defineAsyncComponent(
  () => import("@/components/integration/IntegrationSelectModal.vue"),
);
const IntegrationAppsModal = defineAsyncComponent(
  () => import("@/components/integration/IntegrationAppsModal.vue"),
);
const GlobalSettingsModal = defineAsyncComponent(
  () => import("@/components/settings/GlobalSettingsModal.vue"),
);
const ManagedMcpModal = defineAsyncComponent(
  () => import("@/components/settings/ManagedMcpModal.vue"),
);
const ManagedPluginModal = defineAsyncComponent(
  () => import("@/components/settings/ManagedPluginModal.vue"),
);
const LlmProviderModal = defineAsyncComponent(
  () => import("@/components/settings/LlmProviderModal.vue"),
);
const IntegrationsHubModal = defineAsyncComponent(
  () => import("@/components/settings/IntegrationsHubModal.vue"),
);

const canvasStore = useCanvasStore();
const runStore = useRunStore();
const showIntegrationModal = ref<boolean>(false);
const selectedProvider = ref<string | null>(null);
const showSettingsModal = ref<boolean>(false);
const showManagedMcpModal = ref<boolean>(false);
const showManagedPluginModal = ref<boolean>(false);
const showLlmProviderModal = ref<boolean>(false);
const showIntegrationsHubModal = ref<boolean>(false);

const handleIntegrationSelect = (category: string): void => {
  selectedProvider.value = category;
};

// 以下三個 handler 是給 IntegrationsHubModal 卡片 emit 的 entry point。
// hub modal 在 emit 前已自行 close，因此這裡只負責開子 modal、不處理重開 hub。
const openMcpFromHub = (): void => {
  showManagedMcpModal.value = true;
};

const openPluginFromHub = (): void => {
  showManagedPluginModal.value = true;
};

const openLlmProviderFromHub = (): void => {
  showLlmProviderModal.value = true;
};
</script>
