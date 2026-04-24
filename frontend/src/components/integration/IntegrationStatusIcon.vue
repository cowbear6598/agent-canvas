<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  IntegrationBinding,
  IntegrationProviderConfig,
} from "@/types/integration";
import { findProvider } from "@/integration/providerRegistry";
import { useIntegrationStore } from "@/stores/integrationStore";

const props = defineProps<{
  bindings: IntegrationBinding[];
}>();

const { t } = useI18n();
const integrationStore = useIntegrationStore();

interface IconData {
  binding: IntegrationBinding;
  config: IntegrationProviderConfig | null;
  bgClass: string;
  tooltip: string;
  style: { top: string; right: string };
}

const iconDataList = computed<IconData[]>(() =>
  props.bindings.map((binding, index) => {
    const config = findProvider(binding.provider);
    if (!config) {
      return {
        binding,
        config: null,
        bgClass: "bg-gray-400",
        tooltip: t("integration.status.appRemoved", {
          provider: binding.provider,
        }),
        style: { top: "-12px", right: `${-12 + index * 36}px` },
      };
    }

    const app = integrationStore.getAppForPodBinding(binding);
    const status = app?.connectionStatus ?? "disconnected";
    const statusConfig = config.connectionStatusConfig[status];

    return {
      binding,
      config,
      bgClass: app ? statusConfig.bg : "bg-gray-400",
      tooltip: app
        ? t("integration.status.appStatus", {
            provider: config.label,
            status: t(`common.connectionStatus.${status}`),
            name: app.name,
          })
        : t("integration.status.appRemoved", { provider: config.label }),
      style: { top: "-12px", right: `${-12 + index * 36}px` },
    };
  }),
);
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
