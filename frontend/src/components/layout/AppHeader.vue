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
          Claude Code Canvas
        </h1>
      </div>

      <div class="flex items-center gap-4">
        <ConnectionStatus />

        <!-- 語言切換按鈕 -->
        <div
          ref="localeMenuRef"
          class="relative"
        >
          <button
            class="flex items-center gap-1 rounded-md px-2 py-2 hover:bg-accent text-xs font-mono"
            :title="currentLocaleLabel"
            @click="showLocaleMenu = !showLocaleMenu"
          >
            <Globe class="h-4 w-4" />
          </button>

          <!-- 語言下拉選單 -->
          <div
            v-if="showLocaleMenu"
            class="absolute right-0 top-full mt-1 bg-card border border-doodle-ink rounded-md p-1 z-50 min-w-[140px]"
          >
            <button
              v-for="option in LOCALE_OPTIONS"
              :key="option.value"
              :class="[
                'w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary font-mono',
                {
                  'bg-secondary border-l-2 border-l-primary':
                    currentLocale === option.value,
                },
              ]"
              @click="handleSelectLocale(option.value)"
            >
              <span
                :class="[
                  currentLocale === option.value
                    ? 'text-primary font-semibold'
                    : 'text-foreground',
                ]"
              >
                {{ option.label }}
              </span>
            </button>
          </div>
        </div>

        <button
          class="flex items-center justify-center rounded-md p-2 hover:bg-accent"
          :title="$t('layout.header.globalSettings')"
          @click="showSettingsModal = true"
        >
          <Settings class="h-4 w-4" />
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
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  Sparkles,
  LayoutDashboard,
  KeyRound,
  Settings,
  History,
  Globe,
} from "lucide-vue-next";
import ConnectionStatus from "@/components/ui/ConnectionStatus.vue";
import IntegrationSelectModal from "@/components/integration/IntegrationSelectModal.vue";
import IntegrationAppsModal from "@/components/integration/IntegrationAppsModal.vue";
import GlobalSettingsModal from "@/components/settings/GlobalSettingsModal.vue";
import { useCanvasStore } from "@/stores/canvasStore";
import { useRunStore } from "@/stores/run/runStore";
import { i18n, setLocale } from "@/i18n";

const canvasStore = useCanvasStore();
const runStore = useRunStore();
const showIntegrationModal = ref<boolean>(false);
const selectedProvider = ref<string | null>(null);
const showSettingsModal = ref<boolean>(false);

const handleIntegrationSelect = (category: string): void => {
  selectedProvider.value = category;
};

// 語言切換相關
type SupportedLocale = "zh-TW" | "en" | "ja";

const LOCALE_OPTIONS: {
  value: SupportedLocale;
  label: string;
  abbr: string;
}[] = [
  { value: "zh-TW", label: "繁體中文", abbr: "中" },
  { value: "en", label: "English", abbr: "EN" },
  { value: "ja", label: "日本語", abbr: "日" },
];

const showLocaleMenu = ref<boolean>(false);
const localeMenuRef = ref<HTMLElement | null>(null);

const currentLocale = computed(
  () => i18n.global.locale.value as SupportedLocale,
);

const currentLocaleLabel = computed(
  () =>
    LOCALE_OPTIONS.find((o) => o.value === currentLocale.value)?.label ??
    "繁體中文",
);

const handleSelectLocale = (locale: SupportedLocale): void => {
  setLocale(locale);
  showLocaleMenu.value = false;
};

const handleOutsideMouseDown = (event: MouseEvent): void => {
  if (!localeMenuRef.value) return;
  if (localeMenuRef.value.contains(event.target as Node)) return;
  showLocaleMenu.value = false;
};

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideMouseDown, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideMouseDown, true);
});
</script>
