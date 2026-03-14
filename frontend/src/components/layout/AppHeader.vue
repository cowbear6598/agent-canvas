<template>
  <header
    class="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md"
  >
    <div class="container mx-auto flex h-16 items-center justify-between px-4">
      <div class="flex items-center gap-3">
        <Sparkles class="h-6 w-6 text-primary" />
        <h1
          class="text-2xl font-bold tracking-tight"
          style="font-family: var(--font-handwriting)"
        >
          Claude Code Canvas
        </h1>
      </div>

      <div class="flex items-center gap-4">
        <ConnectionStatus />

        <button
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          title="全域設定"
          @click="showSettingsModal = true"
        >
          <Settings class="h-4 w-4" />
        </button>

        <button
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          title="整合服務管理"
          @click="showIntegrationModal = true"
        >
          <KeyRound class="h-4 w-4" />
        </button>

        <button
          data-history-toggle
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          title="歷程"
          @click="runStore.toggleHistoryPanel()"
        >
          <History class="h-4 w-4" />
        </button>

        <button
          v-if="canvasStore.activeCanvas"
          data-canvas-toggle
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
          @click="canvasStore.toggleSidebar()"
        >
          <LayoutDashboard class="h-4 w-4" />
          <span>{{ canvasStore.activeCanvas.name }}</span>
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
  <GlobalSettingsModal v-model:open="showSettingsModal" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Sparkles, LayoutDashboard, KeyRound, Settings, History } from 'lucide-vue-next'
import ConnectionStatus from '@/components/ui/ConnectionStatus.vue'
import IntegrationSelectModal from '@/components/integration/IntegrationSelectModal.vue'
import IntegrationAppsModal from '@/components/integration/IntegrationAppsModal.vue'
import GlobalSettingsModal from '@/components/settings/GlobalSettingsModal.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useRunStore } from '@/stores/run/runStore'

const canvasStore = useCanvasStore()
const runStore = useRunStore()
const showIntegrationModal = ref<boolean>(false)
const selectedProvider = ref<string | null>(null)
const showSettingsModal = ref<boolean>(false)

const handleIntegrationSelect = (category: string): void => {
  selectedProvider.value = category
}
</script>
