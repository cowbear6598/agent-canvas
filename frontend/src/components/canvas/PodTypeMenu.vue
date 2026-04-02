<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, type Component } from "vue";
import {
  Palette,
  Wrench,
  FolderOpen,
  Bot,
  Github,
  FolderPlus,
  FilePlus,
  Import,
  Server,
} from "lucide-vue-next";
import type {
  Position,
  PodTypeConfig,
  OutputStyleListItem,
  Skill,
  Repository,
  SubAgent,
  McpServer,
} from "@/types";
import { podTypes } from "@/data/podTypes";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useMenuPosition } from "@/composables/useMenuPosition";
import { useSkillImport } from "@/composables/useSkillImport";
import PodTypeMenuSubmenu from "./PodTypeMenuSubmenu.vue";
import { useI18n } from "vue-i18n";

interface Props {
  position: Position;
}

const props = defineProps<Props>();

type ItemType =
  | "outputStyle"
  | "skill"
  | "repository"
  | "subAgent"
  | "command"
  | "mcpServer";
type ResourceType = "outputStyle" | "subAgent" | "command";
type GroupType = "outputStyleGroup" | "subAgentGroup" | "commandGroup";
type OpenMenuType =
  | "outputStyle"
  | "skill"
  | "subAgent"
  | "repository"
  | "command"
  | "mcpServer";

const emit = defineEmits<{
  select: [config: PodTypeConfig];
  "create-output-style-note": [outputStyleId: string];
  "create-skill-note": [skillId: string];
  "create-subagent-note": [subAgentId: string];
  "create-repository-note": [repositoryId: string];
  "create-command-note": [commandId: string];
  "create-mcp-server-note": [mcpServerId: string];
  "clone-started": [payload: { requestId: string; repoName: string }];
  "open-create-modal": [resourceType: ResourceType, title: string];
  "open-edit-modal": [resourceType: ResourceType, id: string];
  "open-delete-modal": [type: ItemType, id: string, name: string];
  "open-create-group-modal": [groupType: GroupType, title: string];
  "open-delete-group-modal": [
    groupType: GroupType,
    groupId: string,
    name: string,
  ];
  "open-create-repository-modal": [];
  "open-clone-repository-modal": [];
  "open-mcp-server-modal": [mode: "create" | "edit", mcpServerId?: string];
  close: [];
}>();

const {
  outputStyleStore,
  skillStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
  podStore,
} = useCanvasContext();

const { importSkill, isImporting } = useSkillImport();
const { t } = useI18n();

const menuRef = ref<HTMLElement | null>(null);
const openMenuType = ref<OpenMenuType | null>(null);
const hoveredItemId = ref<string | null>(null);

const handleOutsideMouseDown = (event: MouseEvent): void => {
  if (!event.target) return;

  const menuEl = menuRef.value;
  if (menuEl && !menuEl.contains(event.target as Node)) {
    podStore.hideTypeMenu();

    if (event.button !== 2) {
      event.stopPropagation();
    }
  }
};

onMounted(async () => {
  document.addEventListener("mousedown", handleOutsideMouseDown, true);

  await Promise.all([
    outputStyleStore.loadOutputStyles(),
    outputStyleStore.loadGroups(),
    skillStore.loadSkills(),
    subAgentStore.loadSubAgents(),
    subAgentStore.loadGroups(),
    repositoryStore.loadRepositories(),
    commandStore.loadCommands(),
    commandStore.loadGroups(),
    mcpServerStore.loadMcpServers(),
  ]);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideMouseDown, true);
});

const handleSelect = (config: PodTypeConfig): void => {
  emit("select", config);
};

const handleOutputStyleSelect = (style: OutputStyleListItem): void => {
  openMenuType.value = null;
  emit("create-output-style-note", style.id);
  emit("close");
};

const handleSkillSelect = (skill: Skill): void => {
  openMenuType.value = null;
  emit("create-skill-note", skill.id);
  emit("close");
};

const handleSubAgentSelect = (subAgent: SubAgent): void => {
  openMenuType.value = null;
  emit("create-subagent-note", subAgent.id);
  emit("close");
};

const handleRepositorySelect = (repository: Repository): void => {
  openMenuType.value = null;
  emit("create-repository-note", repository.id);
  emit("close");
};

const handleCommandSelect = (command: { id: string; name: string }): void => {
  openMenuType.value = null;
  emit("create-command-note", command.id);
  emit("close");
};

const handleMcpServerSelect = (mcpServer: McpServer): void => {
  openMenuType.value = null;
  emit("create-mcp-server-note", mcpServer.id);
  emit("close");
};

const handleNewMcpServer = (): void => {
  openMenuType.value = null;
  emit("open-mcp-server-modal", "create");
  emit("close");
};

const handleDeleteClick = (
  type: ItemType,
  id: string,
  name: string,
  event: Event,
): void => {
  event.stopPropagation();
  openMenuType.value = null;
  emit("open-delete-modal", type, id, name);
  emit("close");
};

const openCreateModal = (resourceType: ResourceType, title: string): void => {
  openMenuType.value = null;
  emit("open-create-modal", resourceType, title);
  emit("close");
};

const handleNewOutputStyle = (): void =>
  openCreateModal("outputStyle", t("canvas.podTypeMenu.newOutputStyle"));
const handleNewSubAgent = (): void =>
  openCreateModal("subAgent", t("canvas.podTypeMenu.newSubAgent"));
const handleNewCommand = (): void =>
  openCreateModal("command", t("canvas.podTypeMenu.newCommand"));

const handleNewRepository = (): void => {
  openMenuType.value = null;
  emit("open-create-repository-modal");
  emit("close");
};

const handleCloneRepository = (): void => {
  openMenuType.value = null;
  emit("open-clone-repository-modal");
  emit("close");
};

const openEditModal = (
  resourceType: ResourceType,
  id: string,
  event: Event,
): void => {
  event.stopPropagation();
  openMenuType.value = null;
  emit("open-edit-modal", resourceType, id);
  emit("close");
};

const handleOutputStyleEdit = (id: string, _name: string, event: Event): void =>
  openEditModal("outputStyle", id, event);

const handleSubAgentEdit = (id: string, _name: string, event: Event): void =>
  openEditModal("subAgent", id, event);

const handleCommandEdit = (id: string, _name: string, event: Event): void =>
  openEditModal("command", id, event);

const openCreateGroupModal = (groupType: GroupType, title: string): void => {
  openMenuType.value = null;
  emit("open-create-group-modal", groupType, title);
  emit("close");
};

const handleNewOutputStyleGroup = (): void =>
  openCreateGroupModal(
    "outputStyleGroup",
    t("canvas.podTypeMenu.newOutputStyleGroup"),
  );
const handleNewSubAgentGroup = (): void =>
  openCreateGroupModal(
    "subAgentGroup",
    t("canvas.podTypeMenu.newSubAgentGroup"),
  );
const handleNewCommandGroup = (): void =>
  openCreateGroupModal("commandGroup", t("canvas.podTypeMenu.newCommandGroup"));

const handleGroupDelete = (
  groupType: GroupType,
  groupId: string,
  name: string,
  event: Event,
): void => {
  event.stopPropagation();
  openMenuType.value = null;
  emit("open-delete-group-modal", groupType, groupId, name);
  emit("close");
};

const handleOutputStyleDropToGroup = (
  itemId: string,
  groupId: string | null,
): void => {
  outputStyleStore.moveItemToGroup(itemId, groupId);
};

const handleSubAgentDropToGroup = (
  itemId: string,
  groupId: string | null,
): void => {
  subAgentStore.moveItemToGroup(itemId, groupId);
};

const handleCommandDropToGroup = (
  itemId: string,
  groupId: string | null,
): void => {
  commandStore.moveItemToGroup(itemId, groupId);
};

const handleImportSkill = async (): Promise<void> => {
  openMenuType.value = null;
  await importSkill();
  emit("close");
};

interface FooterAction {
  icon: Component;
  label: string;
  handler: () => void;
  /** 動態 class，例如 isImporting 狀態下的禁用樣式 */
  extraClass?: () => string;
}

interface MenuSection {
  type: OpenMenuType;
  label: string;
  iconColor: string;
  icon: Component | null;
  /** 自訂 icon slot，當 icon 為 null 時使用 */
  iconSlot?: () => string;
  items: () => unknown[];
  editable?: boolean;
  groups?: () => unknown[];
  expandedGroupIds?: () => Set<string>;
  onSelect: (item: unknown) => void;
  onEdit?: (id: string, name: string, event: Event) => void;
  onDelete: (id: string, name: string, event: Event) => void;
  onToggleGroup?: (groupId: string) => void;
  onGroupDelete?: (groupId: string, name: string, event: Event) => void;
  onDropToGroup?: (itemId: string, groupId: string | null) => void;
  footerActions: FooterAction[];
}

const buildOutputStyleSection = (): MenuSection => ({
  type: "outputStyle",
  label: "Styles >",
  iconColor: "var(--doodle-pink)",
  icon: Palette,
  items: (): unknown[] => outputStyleStore.typedAvailableItems,
  groups: (): unknown[] => outputStyleStore.groups,
  expandedGroupIds: (): Set<string> => outputStyleStore.expandedGroupIds,
  onSelect: (item: unknown): void =>
    handleOutputStyleSelect(item as OutputStyleListItem),
  onEdit: handleOutputStyleEdit,
  onDelete: (id: string, name: string, event: Event): void =>
    handleDeleteClick("outputStyle", id, name, event),
  onToggleGroup: (groupId: string): void =>
    outputStyleStore.toggleGroupExpand(groupId),
  onGroupDelete: (groupId: string, name: string, event: Event): void =>
    handleGroupDelete("outputStyleGroup", groupId, name, event),
  onDropToGroup: handleOutputStyleDropToGroup,
  footerActions: [
    {
      icon: FilePlus,
      label: "New File...",
      handler: handleNewOutputStyle,
    },
    {
      icon: FolderPlus,
      label: "New Group...",
      handler: handleNewOutputStyleGroup,
    },
  ],
});

const buildCommandSection = (): MenuSection => ({
  type: "command",
  label: "Commands >",
  iconColor: "var(--doodle-mint)",
  icon: null,
  iconSlot: (): string => "/",
  items: (): unknown[] => commandStore.typedAvailableItems,
  groups: (): unknown[] => commandStore.groups,
  expandedGroupIds: (): Set<string> => commandStore.expandedGroupIds,
  onSelect: (item: unknown): void =>
    handleCommandSelect(item as { id: string; name: string }),
  onEdit: handleCommandEdit,
  onDelete: (id: string, name: string, event: Event): void =>
    handleDeleteClick("command", id, name, event),
  onToggleGroup: (groupId: string): void =>
    commandStore.toggleGroupExpand(groupId),
  onGroupDelete: (groupId: string, name: string, event: Event): void =>
    handleGroupDelete("commandGroup", groupId, name, event),
  onDropToGroup: handleCommandDropToGroup,
  footerActions: [
    {
      icon: FilePlus,
      label: "New File...",
      handler: handleNewCommand,
    },
    {
      icon: FolderPlus,
      label: "New Group...",
      handler: handleNewCommandGroup,
    },
  ],
});

const buildSkillSection = (): MenuSection => ({
  type: "skill",
  label: "Skills >",
  iconColor: "var(--doodle-green)",
  icon: Wrench,
  items: (): unknown[] => skillStore.typedAvailableItems,
  editable: false,
  onSelect: (item: unknown): void => handleSkillSelect(item as Skill),
  onDelete: (id: string, name: string, event: Event): void =>
    handleDeleteClick("skill", id, name, event),
  footerActions: [
    {
      icon: Import,
      label: "Import...",
      handler: handleImportSkill,
      extraClass: (): string =>
        isImporting.value ? "opacity-50 cursor-not-allowed" : "",
    },
  ],
});

const buildSubAgentSection = (): MenuSection => ({
  type: "subAgent",
  label: "Agents >",
  iconColor: "var(--doodle-sand)",
  icon: Bot,
  items: (): unknown[] => subAgentStore.typedAvailableItems,
  groups: (): unknown[] => subAgentStore.groups,
  expandedGroupIds: (): Set<string> => subAgentStore.expandedGroupIds,
  onSelect: (item: unknown): void => handleSubAgentSelect(item as SubAgent),
  onEdit: handleSubAgentEdit,
  onDelete: (id: string, name: string, event: Event): void =>
    handleDeleteClick("subAgent", id, name, event),
  onToggleGroup: (groupId: string): void =>
    subAgentStore.toggleGroupExpand(groupId),
  onGroupDelete: (groupId: string, name: string, event: Event): void =>
    handleGroupDelete("subAgentGroup", groupId, name, event),
  onDropToGroup: handleSubAgentDropToGroup,
  footerActions: [
    {
      icon: FilePlus,
      label: "New File...",
      handler: handleNewSubAgent,
    },
    {
      icon: FolderPlus,
      label: "New Group...",
      handler: handleNewSubAgentGroup,
    },
  ],
});

const buildMcpServerSection = (): MenuSection => ({
  type: "mcpServer",
  label: "MCPs >",
  iconColor: "var(--doodle-purple)",
  icon: Server,
  items: (): unknown[] => mcpServerStore.typedAvailableItems,
  editable: false,
  onSelect: (item: unknown): void => handleMcpServerSelect(item as McpServer),
  onDelete: (id: string, name: string, event: Event): void =>
    handleDeleteClick("mcpServer", id, name, event),
  footerActions: [
    {
      icon: FilePlus,
      label: "New...",
      handler: handleNewMcpServer,
    },
  ],
});

const buildRepositorySection = (): MenuSection => ({
  type: "repository",
  label: "Repository >",
  iconColor: "var(--doodle-orange)",
  icon: FolderOpen,
  items: (): unknown[] => repositoryStore.typedAvailableItems,
  onSelect: (item: unknown): void => handleRepositorySelect(item as Repository),
  onDelete: (id: string, name: string, event: Event): void =>
    handleDeleteClick("repository", id, name, event),
  footerActions: [
    {
      icon: FolderPlus,
      label: "New...",
      handler: handleNewRepository,
    },
    {
      icon: Github,
      label: "Clone",
      handler: handleCloneRepository,
    },
  ],
});

const menuSections = computed<MenuSection[]>((): MenuSection[] => [
  buildOutputStyleSection(),
  buildCommandSection(),
  buildSkillSection(),
  buildSubAgentSection(),
  buildMcpServerSection(),
  buildRepositorySection(),
]);

const { menuStyle } = useMenuPosition({
  position: computed(() => props.position),
});
</script>

<template>
  <div
    ref="menuRef"
    class="fixed z-50 bg-card border-2 border-doodle-ink rounded-lg p-2 min-w-36"
    :style="menuStyle"
    @contextmenu.prevent
  >
    <button
      v-if="podTypes[0]"
      class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left mb-1"
      @click="handleSelect(podTypes[0])"
    >
      <span
        class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
        style="background-color: var(--doodle-blue)"
      >
        <component :is="podTypes[0].icon" :size="16" class="text-card" />
      </span>
      <span class="font-mono text-sm text-foreground">Pod</span>
    </button>

    <div
      v-for="section in menuSections"
      :key="section.type"
      class="relative"
      @mouseenter="openMenuType = section.type"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          :style="{ backgroundColor: section.iconColor }"
        >
          <!-- 有 icon 元件時渲染 icon，否則渲染文字 slot -->
          <component
            :is="section.icon"
            v-if="section.icon"
            :size="16"
            class="text-card"
          />
          <span v-else class="text-xs text-card font-mono font-bold">{{
            section.iconSlot?.()
          }}</span>
        </span>
        <span class="font-mono text-sm text-foreground">{{
          section.label
        }}</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="section.items() as any[]"
        :visible="openMenuType === section.type"
        :editable="section.editable"
        :groups="section.groups?.() as any[]"
        :expanded-group-ids="section.expandedGroupIds?.()"
        @item-select="section.onSelect"
        @item-edit="section.onEdit"
        @item-delete="section.onDelete"
        @toggle-group="section.onToggleGroup"
        @group-delete="section.onGroupDelete"
        @item-drop-to-group="section.onDropToGroup"
      >
        <template v-if="section.footerActions.length > 0" #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            v-for="action in section.footerActions"
            :key="action.label"
            class="pod-menu-submenu-item flex items-center gap-2"
            :class="action.extraClass?.()"
            @click="action.handler"
          >
            <component :is="action.icon" :size="16" />
            {{ action.label }}
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>
  </div>
</template>
