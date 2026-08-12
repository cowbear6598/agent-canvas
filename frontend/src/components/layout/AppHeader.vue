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
          data-integrations-hub-toggle
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          :title="$t('layout.header.integrationsHub')"
          @click="isIntegrationsHubOpen = true"
        >
          <Boxes class="h-4 w-4" />
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
    v-model:open="isIntegrationManagerOpen"
    :show-back-button="true"
    @back="returnFromIntegrationManager"
    @select="handleIntegrationSelect"
  />
  <IntegrationAppsModal
    :open="activeIntegrationProvider !== null"
    :provider="activeIntegrationProvider ?? ''"
    :show-back-button="true"
    @back="returnFromIntegrationApps"
    @update:open="handleIntegrationAppsOpenChange"
  />
  <ManagedMcpModal
    v-model:open="isManagedMcpOpen"
    :show-back-button="true"
    @back="returnFromManagedMcp"
  />
  <ManagedPluginModal
    v-model:open="isManagedPluginOpen"
    :show-back-button="true"
    @back="returnFromManagedPlugin"
  />
  <GlobalSettingsModal
    v-model:open="isGlobalSettingsOpen"
    :show-back-button="true"
    @back="returnFromGlobalSettings"
  />
  <LlmProviderModal
    v-model:open="isOpenCodeSettingsOpen"
    :show-back-button="true"
    @back="returnFromOpenCode"
  />
  <ModelSettingsModal
    v-model:open="isModelSettingsOpen"
    :show-back-button="true"
    @back="returnFromModelSettings"
  />
  <AgentAccessModal
    v-model:open="isAgentAccessOpen"
    :show-back-button="true"
    @back="returnFromAgentAccess"
  />
  <IntegrationsHubModal
    v-model:open="isIntegrationsHubOpen"
    @select-global-settings="openGlobalSettingsFromHub"
    @select-integration-manager="openIntegrationManagerFromHub"
    @select-mcp="openMcpFromHub"
    @select-plugin="openPluginFromHub"
    @select-opencode="openOpenCodeFromHub"
    @select-model-settings="openModelSettingsFromHub"
    @select-agent-access="openAgentAccessFromHub"
  />
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import { Sparkles, LayoutDashboard, History, Boxes } from "lucide-vue-next";
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
const ModelSettingsModal = defineAsyncComponent(
  () => import("@/components/settings/ModelSettingsModal.vue"),
);
const IntegrationsHubModal = defineAsyncComponent(
  () => import("@/components/settings/IntegrationsHubModal.vue"),
);
const AgentAccessModal = defineAsyncComponent(
  () => import("@/components/settings/AgentAccessModal.vue"),
);

const canvasStore = useCanvasStore();
const runStore = useRunStore();
const isIntegrationManagerOpen = ref<boolean>(false);
const activeIntegrationProvider = ref<string | null>(null);
const isGlobalSettingsOpen = ref<boolean>(false);
const isManagedMcpOpen = ref<boolean>(false);
const isManagedPluginOpen = ref<boolean>(false);
const isOpenCodeSettingsOpen = ref<boolean>(false);
const isModelSettingsOpen = ref<boolean>(false);
const isIntegrationsHubOpen = ref<boolean>(false);
const isAgentAccessOpen = ref<boolean>(false);

const handleIntegrationSelect = (category: string): void => {
  isIntegrationManagerOpen.value = false;
  activeIntegrationProvider.value = category;
};

const openGlobalSettingsFromHub = (): void => {
  isGlobalSettingsOpen.value = true;
};

const openIntegrationManagerFromHub = (): void => {
  isIntegrationManagerOpen.value = true;
};

const openMcpFromHub = (): void => {
  isManagedMcpOpen.value = true;
};

const openPluginFromHub = (): void => {
  isManagedPluginOpen.value = true;
};

const openOpenCodeFromHub = (): void => {
  isOpenCodeSettingsOpen.value = true;
};

const openModelSettingsFromHub = (): void => {
  isModelSettingsOpen.value = true;
};

const openAgentAccessFromHub = (): void => {
  isAgentAccessOpen.value = true;
};

const returnFromGlobalSettings = (): void => {
  isGlobalSettingsOpen.value = false;
  isIntegrationsHubOpen.value = true;
};

const returnFromIntegrationManager = (): void => {
  isIntegrationManagerOpen.value = false;
  isIntegrationsHubOpen.value = true;
};

const handleIntegrationAppsOpenChange = (open: boolean): void => {
  if (open) return;
  activeIntegrationProvider.value = null;
};

const returnFromIntegrationApps = (): void => {
  activeIntegrationProvider.value = null;
  isIntegrationManagerOpen.value = true;
};

const returnFromManagedMcp = (): void => {
  isManagedMcpOpen.value = false;
  isIntegrationsHubOpen.value = true;
};

const returnFromManagedPlugin = (): void => {
  isManagedPluginOpen.value = false;
  isIntegrationsHubOpen.value = true;
};

const returnFromOpenCode = (): void => {
  isOpenCodeSettingsOpen.value = false;
  isIntegrationsHubOpen.value = true;
};

const returnFromModelSettings = (): void => {
  isModelSettingsOpen.value = false;
  isIntegrationsHubOpen.value = true;
};

const returnFromAgentAccess = (): void => {
  isAgentAccessOpen.value = false;
  isIntegrationsHubOpen.value = true;
};
</script>
