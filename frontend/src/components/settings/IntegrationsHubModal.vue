<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bot,
  Cpu,
  KeyRound,
  Puzzle,
  Settings2,
  SlidersHorizontal,
} from "lucide-vue-next";

interface Props {
  open: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "select-global-settings": [];
  "select-integration-manager": [];
  "select-mcp": [];
  "select-plugin": [];
  "select-opencode": [];
  "select-model-settings": [];
}>();

const { t } = useI18n();

type HubAction =
  | "global-settings"
  | "integration-manager"
  | "mcp"
  | "plugin"
  | "opencode"
  | "model-settings";

interface HubCard {
  id: string;
  action: HubAction;
  icon: typeof Bot;
  label: string;
}

interface HubSection {
  id: string;
  cards: HubCard[];
}

const handleClose = (): void => {
  emit("update:open", false);
};

const sections = computed<HubSection[]>(() => [
  {
    id: "workspace",
    cards: [
      {
        id: "global-settings",
        action: "global-settings",
        icon: Settings2,
        label: t("integrationsHub.cards.globalSettings"),
      },
      {
        id: "integration-manager",
        action: "integration-manager",
        icon: KeyRound,
        label: t("integrationsHub.cards.integrations"),
      },
    ],
  },
  {
    id: "settings",
    cards: [
      {
        id: "mcp",
        action: "mcp",
        icon: Bot,
        label: t("integrationsHub.cards.mcp"),
      },
      {
        id: "plugin",
        action: "plugin",
        icon: Puzzle,
        label: t("integrationsHub.cards.plugin"),
      },
      {
        id: "model-settings",
        action: "model-settings",
        icon: SlidersHorizontal,
        label: t("integrationsHub.cards.modelSettings"),
      },
    ],
  },
  {
    id: "opencode",
    cards: [
      {
        id: "opencode",
        action: "opencode",
        icon: Cpu,
        label: t("integrationsHub.cards.opencode"),
      },
    ],
  },
]);

const handleSelect = (action: HubAction): void => {
  emit("update:open", false);
  switch (action) {
    case "global-settings":
      emit("select-global-settings");
      return;
    case "integration-manager":
      emit("select-integration-manager");
      return;
    case "mcp":
      emit("select-mcp");
      return;
    case "plugin":
      emit("select-plugin");
      return;
    case "opencode":
      emit("select-opencode");
      return;
    case "model-settings":
      emit("select-model-settings");
      return;
  }
};
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("integrationsHub.title") }}</DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("integrationsHub.title") }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <section
          v-for="(section, index) in sections"
          :key="section.id"
          class="space-y-3"
        >
          <div
            v-if="index > 0"
            class="border-t border-border"
          />

          <div class="pt-1">
            <div
              class="grid gap-3 sm:grid-cols-2"
              :class="section.cards.length === 1 ? 'grid-cols-1' : 'grid-cols-2'"
            >
              <button
                v-for="card in section.cards"
                :key="card.id"
                :data-testid="`integrations-hub-card-${card.id}`"
                class="flex items-center gap-3 rounded-lg border border-doodle-ink/20 bg-card px-4 py-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                @click="handleSelect(card.action)"
              >
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"
                >
                  <component
                    :is="card.icon"
                    class="h-5 w-5"
                  />
                </span>
                <span class="text-sm font-medium leading-tight">
                  {{ card.label }}
                </span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
