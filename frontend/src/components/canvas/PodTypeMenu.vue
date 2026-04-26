<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  computed,
  shallowRef,
  watchEffect,
  type Component,
} from "vue";
import {
  FolderOpen,
  Github,
  FolderPlus,
  FilePlus,
  Server,
} from "lucide-vue-next";
import type { Position, PodTypeConfig, Repository, McpServer } from "@/types";
import type { PodProvider, ProviderConfig } from "@/types/pod";
import { podTypes } from "@/data/podTypes";
import { useCanvasContext } from "@/composables/canvas/useCanvasContext";
import { useMenuPosition } from "@/composables/useMenuPosition";
import PodTypeMenuSubmenu from "./PodTypeMenuSubmenu.vue";
import ProviderPicker from "./ProviderPicker.vue";
import { useI18n } from "vue-i18n";

interface Props {
  position: Position;
}

const props = defineProps<Props>();

type ItemType = "repository" | "command" | "mcpServer";
type ResourceType = "command";
type GroupType = "commandGroup";
type OpenMenuType = "repository" | "command" | "mcpServer" | "pod";

/** 建立 Note 的 discriminated union，統一 create-*-note 事件為一個事件 */
type CreateNotePayload =
  | { type: "repository"; id: string }
  | { type: "command"; id: string }
  | { type: "mcpServer"; id: string };

/** 開啟 Modal 的 discriminated union，統一多個 open-*-modal 事件 */
type OpenModalPayload =
  | { type: "createRepository" }
  | { type: "cloneRepository" }
  | { type: "mcpServer"; mode: "create" | "edit"; mcpServerId?: string };

const emit = defineEmits<{
  /** Pod 建立：選擇 provider 後觸發 */
  select: [
    config: PodTypeConfig,
    provider: PodProvider,
    providerConfig: ProviderConfig,
  ];
  /** 建立任意資源的 Note（原六個 create-*-note 合併） */
  "create-note": [payload: CreateNotePayload];
  /** clone 開始（進度任務通知） */
  "clone-started": [payload: { requestId: string; repoName: string }];
  /** 開啟 create/edit 資源 Modal */
  "open-create-modal": [resourceType: ResourceType, title: string];
  "open-edit-modal": [resourceType: ResourceType, id: string];
  /** 開啟 delete 資源 Modal */
  "open-delete-modal": [type: ItemType, id: string, name: string];
  /** 開啟 create/delete group Modal */
  "open-create-group-modal": [groupType: GroupType, title: string];
  "open-delete-group-modal": [
    groupType: GroupType,
    groupId: string,
    name: string,
  ];
  /** 開啟各種 Modal（repository 建立/clone、MCP Server Modal） */
  "open-modal": [payload: OpenModalPayload];
  close: [];
}>();

const { repositoryStore, commandStore, mcpServerStore, podStore } =
  useCanvasContext();

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
    repositoryStore.loadRepositories(),
    commandStore.loadCommands(),
    commandStore.loadGroups(),
    mcpServerStore.loadMcpServers(),
  ]);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideMouseDown, true);
});

/** ProviderPicker 選到 provider 後，轉發 select 事件給父層 */
const handleProviderSelect = (payload: {
  provider: PodProvider;
  providerConfig: ProviderConfig;
}): void => {
  if (!podTypes[0]) return;
  openMenuType.value = null;
  emit("select", podTypes[0], payload.provider, payload.providerConfig);
};

const handleRepositorySelect = (repository: Repository): void => {
  openMenuType.value = null;
  emit("create-note", { type: "repository", id: repository.id });
  emit("close");
};

const handleCommandSelect = (command: { id: string; name: string }): void => {
  openMenuType.value = null;
  emit("create-note", { type: "command", id: command.id });
  emit("close");
};

const handleMcpServerSelect = (mcpServer: McpServer): void => {
  openMenuType.value = null;
  emit("create-note", { type: "mcpServer", id: mcpServer.id });
  emit("close");
};

const handleNewMcpServer = (): void => {
  openMenuType.value = null;
  emit("open-modal", { type: "mcpServer", mode: "create" });
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

const handleNewCommand = (): void =>
  openCreateModal("command", t("canvas.podTypeMenu.newCommand"));

const handleNewRepository = (): void => {
  openMenuType.value = null;
  emit("open-modal", { type: "createRepository" });
  emit("close");
};

const handleCloneRepository = (): void => {
  openMenuType.value = null;
  emit("open-modal", { type: "cloneRepository" });
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

const handleCommandEdit = (id: string, _name: string, event: Event): void =>
  openEditModal("command", id, event);

const openCreateGroupModal = (groupType: GroupType, title: string): void => {
  openMenuType.value = null;
  emit("open-create-group-modal", groupType, title);
  emit("close");
};

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

const handleCommandDropToGroup = (
  itemId: string,
  groupId: string | null,
): void => {
  commandStore.moveItemToGroup(itemId, groupId);
};

interface FooterAction {
  icon: Component;
  label: string;
  handler: () => void;
  /** 禁用狀態，顯示 opacity-50 cursor-not-allowed 樣式 */
  disabled?: boolean;
}

interface MenuSection {
  type: OpenMenuType;
  label: string;
  iconColor: string;
  icon: Component | null;
  /** 自訂 icon slot，當 icon 為 null 時使用 */
  iconSlot?: string;
  items: unknown[];
  editable?: boolean;
  groups?: unknown[];
  expandedGroupIds?: Set<string>;
  onSelect: (item: unknown) => void;
  onEdit?: (id: string, name: string, event: Event) => void;
  onDelete: (id: string, name: string, event: Event) => void;
  onToggleGroup?: (groupId: string) => void;
  onGroupDelete?: (groupId: string, name: string, event: Event) => void;
  onDropToGroup?: (itemId: string, groupId: string | null) => void;
  footerActions: FooterAction[];
}

/**
 * 各 section 的設定介面：差異化欄位集中宣告。
 * items / groups / expandedGroupIds 以 getter 函式提供，讓 watchEffect 正確追蹤響應式依賴。
 */
interface SectionConfig {
  type: OpenMenuType;
  label: string;
  iconColor: string;
  icon: Component | null;
  iconSlot?: string;
  editable?: boolean;
  getItems: () => unknown[];
  getGroups?: () => unknown[];
  getExpandedGroupIds?: () => Set<string>;
  onSelect: (item: unknown) => void;
  onEdit?: (id: string, name: string, event: Event) => void;
  onDelete: (id: string, name: string, event: Event) => void;
  onToggleGroup?: (groupId: string) => void;
  onGroupDelete?: (groupId: string, name: string, event: Event) => void;
  onDropToGroup?: (itemId: string, groupId: string | null) => void;
  footerActions: FooterAction[];
}

/** SectionConfig → MenuSection 的 factory，解構 getter 供 template 直接使用 */
const buildMenuSection = (config: SectionConfig): MenuSection => ({
  type: config.type,
  label: config.label,
  iconColor: config.iconColor,
  icon: config.icon,
  iconSlot: config.iconSlot,
  items: config.getItems(),
  editable: config.editable,
  groups: config.getGroups?.(),
  expandedGroupIds: config.getExpandedGroupIds?.(),
  onSelect: config.onSelect,
  onEdit: config.onEdit,
  onDelete: config.onDelete,
  onToggleGroup: config.onToggleGroup,
  onGroupDelete: config.onGroupDelete,
  onDropToGroup: config.onDropToGroup,
  footerActions: config.footerActions,
});

/**
 * 宣告式 section 設定陣列，各 section 的差異化欄位集中於此。
 * 由 watchEffect 驅動 buildMenuSection 轉換，避免在 template 中直接呼叫 getter 閉包。
 */
const SECTION_CONFIGS: SectionConfig[] = [
  {
    type: "command",
    label: "Commands >",
    iconColor: "var(--doodle-mint)",
    icon: null,
    iconSlot: "/",
    getItems: () => commandStore.typedAvailableItems,
    getGroups: () => commandStore.groups,
    getExpandedGroupIds: () => commandStore.expandedGroupIds,
    onSelect: (item) =>
      handleCommandSelect(item as { id: string; name: string }),
    onEdit: handleCommandEdit,
    onDelete: (id, name, event) =>
      handleDeleteClick("command", id, name, event),
    onToggleGroup: (groupId) => commandStore.toggleGroupExpand(groupId),
    onGroupDelete: (groupId, name, event) =>
      handleGroupDelete("commandGroup", groupId, name, event),
    onDropToGroup: handleCommandDropToGroup,
    footerActions: [
      { icon: FilePlus, label: "New File...", handler: handleNewCommand },
      {
        icon: FolderPlus,
        label: "New Group...",
        handler: handleNewCommandGroup,
      },
    ],
  },
  {
    type: "mcpServer",
    label: "MCPs >",
    iconColor: "var(--doodle-purple)",
    icon: Server,
    editable: false,
    getItems: () => mcpServerStore.typedAvailableItems,
    onSelect: (item) => handleMcpServerSelect(item as McpServer),
    onDelete: (id, name, event) =>
      handleDeleteClick("mcpServer", id, name, event),
    footerActions: [
      { icon: FilePlus, label: "New...", handler: handleNewMcpServer },
    ],
  },
  {
    type: "repository",
    label: "Repository >",
    iconColor: "var(--doodle-orange)",
    icon: FolderOpen,
    getItems: () => repositoryStore.typedAvailableItems,
    onSelect: (item) => handleRepositorySelect(item as Repository),
    onDelete: (id, name, event) =>
      handleDeleteClick("repository", id, name, event),
    footerActions: [
      { icon: FolderPlus, label: "New...", handler: handleNewRepository },
      { icon: Github, label: "Clone", handler: handleCloneRepository },
    ],
  },
];

/**
 * menuSections 使用 shallowRef + watchEffect 維護。
 * shallowRef 確保只有整個陣列被替換時才觸發子元件 diff，
 * watchEffect 在 store 響應式資料變動時重新呼叫 buildMenuSection。
 */
const menuSections = shallowRef<MenuSection[]>([]);

watchEffect(() => {
  menuSections.value = SECTION_CONFIGS.map(buildMenuSection);
});

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
    <!-- 新增 Pod → hover 展開 ProviderPicker 子選單 -->
    <div
      v-if="podTypes[0]"
      class="relative mb-1"
      @mouseenter="openMenuType = 'pod'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-blue)"
        >
          <component :is="podTypes[0].icon" :size="16" class="text-card" />
        </span>
        <span class="font-mono text-sm text-foreground">Pod &gt;</span>
      </button>

      <!-- ProviderPicker 子選單，樣式對齊既有 pod-menu-submenu -->
      <ProviderPicker
        v-if="openMenuType === 'pod'"
        @select="handleProviderSelect"
      />
    </div>

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
            section.iconSlot
          }}</span>
        </span>
        <span class="font-mono text-sm text-foreground">{{
          section.label
        }}</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="section.items as any[]"
        :visible="openMenuType === section.type"
        :editable="section.editable"
        :groups="section.groups as any[]"
        :expanded-group-ids="section.expandedGroupIds"
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
            :class="{ 'opacity-50 cursor-not-allowed': action.disabled }"
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
