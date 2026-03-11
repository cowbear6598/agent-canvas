<script setup lang="ts">
import { computed } from 'vue'
import type { IntegrationBinding, IntegrationProviderConfig } from '@/types/integration'
import { findProvider } from '@/integration/providerRegistry'
import { useIntegrationStore } from '@/stores/integrationStore'

const props = defineProps<{
  bindings: IntegrationBinding[]
}>()

const integrationStore = useIntegrationStore()

interface IconData {
  binding: IntegrationBinding
  config: IntegrationProviderConfig | null
  bgClass: string
  tooltip: string
  style: { top: string; right: string }
}

const iconDataList = computed<IconData[]>(() =>
  props.bindings.map((binding, index) => {
    const config = findProvider(binding.provider)
    if (!config) {
      return {
        binding,
        config: null,
        bgClass: 'bg-gray-400',
        tooltip: `${binding.provider} App 已移除`,
        style: { top: '-12px', right: `${-12 + index * 36}px` },
      }
    }

    const app = integrationStore.getAppForPodBinding(binding)
    const status = app?.connectionStatus ?? 'disconnected'
    const statusConfig = config.connectionStatusConfig[status]

    return {
      binding,
      config,
      bgClass: app ? statusConfig.bg : 'bg-gray-400',
      tooltip: app
        ? `${config.label} ${statusConfig.label}：${app.name}`
        : `${config.label} App 已移除`,
      style: { top: '-12px', right: `${-12 + index * 36}px` },
    }
  })
)
</script>

<template>
  <div
    v-for="(iconData, index) in iconDataList"
    :key="index"
    class="absolute w-8 h-8 rounded-full flex items-center justify-center border-2 border-black"
    :class="iconData.bgClass"
    :title="iconData.tooltip"
    :style="iconData.style"
  >
    <component
      :is="iconData.config?.icon"
      :size="18"
    />
  </div>
</template>
