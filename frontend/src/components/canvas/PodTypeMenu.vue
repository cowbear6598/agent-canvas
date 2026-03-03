<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Palette, Wrench, FolderOpen, Bot, Github, FolderPlus, FilePlus, Import, Server } from 'lucide-vue-next'
import type { Position, PodTypeConfig, OutputStyleListItem, Skill, Repository, SubAgent, McpServer } from '@/types'
import { podTypes } from '@/data/podTypes'
import { useCanvasContext } from '@/composables/canvas/useCanvasContext'
import { useMenuPosition } from '@/composables/useMenuPosition'
import { useSkillImport } from '@/composables/useSkillImport'
import PodTypeMenuSubmenu from './PodTypeMenuSubmenu.vue'

interface Props {
  position: Position
}

const props = defineProps<Props>()

type ItemType = 'outputStyle' | 'skill' | 'repository' | 'subAgent' | 'command' | 'mcpServer'
type ResourceType = 'outputStyle' | 'subAgent' | 'command'
type GroupType = 'outputStyleGroup' | 'subAgentGroup' | 'commandGroup'

const emit = defineEmits<{
  select: [config: PodTypeConfig]
  'create-output-style-note': [outputStyleId: string]
  'create-skill-note': [skillId: string]
  'create-subagent-note': [subAgentId: string]
  'create-repository-note': [repositoryId: string]
  'create-command-note': [commandId: string]
  'create-mcp-server-note': [mcpServerId: string]
  'clone-started': [payload: { requestId: string; repoName: string }]
  'open-create-modal': [resourceType: ResourceType, title: string]
  'open-edit-modal': [resourceType: ResourceType, id: string]
  'open-delete-modal': [type: ItemType, id: string, name: string]
  'open-create-group-modal': [groupType: GroupType, title: string]
  'open-delete-group-modal': [groupType: GroupType, groupId: string, name: string]
  'open-create-repository-modal': []
  'open-clone-repository-modal': []
  'open-mcp-server-modal': [mode: 'create' | 'edit', mcpServerId?: string]
  close: []
}>()

const {
  outputStyleStore,
  skillStore,
  subAgentStore,
  repositoryStore,
  commandStore,
  mcpServerStore,
  podStore
} = useCanvasContext()

const { importSkill, isImporting } = useSkillImport()

const menuRef = ref<HTMLElement | null>(null)
const openMenuType = ref<'outputStyle' | 'skill' | 'subAgent' | 'repository' | 'command' | 'mcpServer' | null>(null)
const hoveredItemId = ref<string | null>(null)

const handleOutsideMouseDown = (e: MouseEvent): void => {
  if (!e.target) return

  const menuEl = menuRef.value
  if (menuEl && !menuEl.contains(e.target as Node)) {
    podStore.hideTypeMenu()

    if (e.button !== 2) {
      e.stopPropagation()
    }
  }
}

onMounted(async () => {
  document.addEventListener('mousedown', handleOutsideMouseDown, true)

  await Promise.all([
    outputStyleStore.loadOutputStyles(),
    outputStyleStore.loadGroups(),
    skillStore.loadSkills(),
    subAgentStore.loadSubAgents(),
    subAgentStore.loadGroups(),
    repositoryStore.loadRepositories(),
    commandStore.loadCommands(),
    commandStore.loadGroups(),
    mcpServerStore.loadMcpServers()
  ])
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideMouseDown, true)
})

const handleSelect = (config: PodTypeConfig): void => {
  emit('select', config)
}

const handleOutputStyleSelect = (style: OutputStyleListItem): void => {
  openMenuType.value = null
  emit('create-output-style-note', style.id)
  emit('close')
}

const handleSkillSelect = (skill: Skill): void => {
  openMenuType.value = null
  emit('create-skill-note', skill.id)
  emit('close')
}

const handleSubAgentSelect = (subAgent: SubAgent): void => {
  openMenuType.value = null
  emit('create-subagent-note', subAgent.id)
  emit('close')
}

const handleRepositorySelect = (repository: Repository): void => {
  openMenuType.value = null
  emit('create-repository-note', repository.id)
  emit('close')
}

const handleCommandSelect = (command: { id: string; name: string }): void => {
  openMenuType.value = null
  emit('create-command-note', command.id)
  emit('close')
}

const handleMcpServerSelect = (mcpServer: McpServer): void => {
  openMenuType.value = null
  emit('create-mcp-server-note', mcpServer.id)
  emit('close')
}

const handleNewMcpServer = (): void => {
  openMenuType.value = null
  emit('open-mcp-server-modal', 'create')
  emit('close')
}

const handleDeleteClick = (type: ItemType, id: string, name: string, event: Event): void => {
  event.stopPropagation()
  openMenuType.value = null
  emit('open-delete-modal', type, id, name)
  emit('close')
}

const openCreateModal = (resourceType: ResourceType, title: string): void => {
  openMenuType.value = null
  emit('open-create-modal', resourceType, title)
  emit('close')
}

const handleNewOutputStyle = (): void => openCreateModal('outputStyle', '新增 Output Style')
const handleNewSubAgent = (): void => openCreateModal('subAgent', '新增 SubAgent')
const handleNewCommand = (): void => openCreateModal('command', '新增 Command')

const handleNewRepository = (): void => {
  openMenuType.value = null
  emit('open-create-repository-modal')
  emit('close')
}

const handleCloneRepository = (): void => {
  openMenuType.value = null
  emit('open-clone-repository-modal')
  emit('close')
}

const openEditModal = (
  resourceType: ResourceType,
  id: string,
  event: Event
): void => {
  event.stopPropagation()
  openMenuType.value = null
  emit('open-edit-modal', resourceType, id)
  emit('close')
}

const handleOutputStyleEdit = (id: string, _name: string, event: Event): void =>
  openEditModal('outputStyle', id, event)

const handleSubAgentEdit = (id: string, _name: string, event: Event): void =>
  openEditModal('subAgent', id, event)

const handleCommandEdit = (id: string, _name: string, event: Event): void =>
  openEditModal('command', id, event)

const openCreateGroupModal = (groupType: GroupType, title: string): void => {
  openMenuType.value = null
  emit('open-create-group-modal', groupType, title)
  emit('close')
}

const handleNewOutputStyleGroup = (): void => openCreateGroupModal('outputStyleGroup', '新增 Output Style 群組')
const handleNewSubAgentGroup = (): void => openCreateGroupModal('subAgentGroup', '新增 SubAgent 群組')
const handleNewCommandGroup = (): void => openCreateGroupModal('commandGroup', '新增 Command 群組')

const handleGroupDelete = (groupType: GroupType, groupId: string, name: string, event: Event): void => {
  event.stopPropagation()
  openMenuType.value = null
  emit('open-delete-group-modal', groupType, groupId, name)
  emit('close')
}

const handleOutputStyleDropToGroup = (itemId: string, groupId: string | null): void => {
  outputStyleStore.moveItemToGroup(itemId, groupId)
}

const handleSubAgentDropToGroup = (itemId: string, groupId: string | null): void => {
  subAgentStore.moveItemToGroup(itemId, groupId)
}

const handleCommandDropToGroup = (itemId: string, groupId: string | null): void => {
  commandStore.moveItemToGroup(itemId, groupId)
}

const handleImportSkill = async (): Promise<void> => {
  openMenuType.value = null
  await importSkill()
  emit('close')
}

const { menuStyle } = useMenuPosition({ position: computed(() => props.position) })
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
        <component
          :is="podTypes[0].icon"
          :size="16"
          class="text-card"
        />
      </span>
      <span class="font-mono text-sm text-foreground">Pod</span>
    </button>

    <div
      class="relative"
      @mouseenter="openMenuType = 'outputStyle'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-pink)"
        >
          <Palette
            :size="16"
            class="text-card"
          />
        </span>
        <span class="font-mono text-sm text-foreground">Styles &gt;</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="outputStyleStore.typedAvailableItems"
        :visible="openMenuType === 'outputStyle'"
        :groups="outputStyleStore.groups"
        :expanded-group-ids="outputStyleStore.expandedGroupIds"
        @item-select="handleOutputStyleSelect"
        @item-edit="handleOutputStyleEdit"
        @item-delete="(id, name, event) => handleDeleteClick('outputStyle', id, name, event)"
        @toggle-group="(groupId) => outputStyleStore.toggleGroupExpand(groupId)"
        @group-delete="(groupId, name, event) => handleGroupDelete('outputStyleGroup', groupId, name, event)"
        @item-drop-to-group="handleOutputStyleDropToGroup"
      >
        <template #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewOutputStyle"
          >
            <FilePlus :size="16" />
            New File...
          </div>
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewOutputStyleGroup"
          >
            <FolderPlus :size="16" />
            New Group...
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>

    <div
      class="relative"
      @mouseenter="openMenuType = 'command'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-mint)"
        >
          <span class="text-xs text-card font-mono font-bold">/</span>
        </span>
        <span class="font-mono text-sm text-foreground">Commands &gt;</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="commandStore.typedAvailableItems"
        :visible="openMenuType === 'command'"
        :groups="commandStore.groups"
        :expanded-group-ids="commandStore.expandedGroupIds"
        @item-select="handleCommandSelect"
        @item-edit="handleCommandEdit"
        @item-delete="(id, name, event) => handleDeleteClick('command', id, name, event)"
        @toggle-group="(groupId) => commandStore.toggleGroupExpand(groupId)"
        @group-delete="(groupId, name, event) => handleGroupDelete('commandGroup', groupId, name, event)"
        @item-drop-to-group="handleCommandDropToGroup"
      >
        <template #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewCommand"
          >
            <FilePlus :size="16" />
            New File...
          </div>
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewCommandGroup"
          >
            <FolderPlus :size="16" />
            New Group...
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>

    <div
      class="relative"
      @mouseenter="openMenuType = 'skill'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-green)"
        >
          <Wrench
            :size="16"
            class="text-card"
          />
        </span>
        <span class="font-mono text-sm text-foreground">Skills &gt;</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="skillStore.typedAvailableItems"
        :visible="openMenuType === 'skill'"
        :editable="false"
        @item-select="handleSkillSelect"
        @item-delete="(id, name, event) => handleDeleteClick('skill', id, name, event)"
      >
        <template #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            :class="{ 'opacity-50 cursor-not-allowed': isImporting }"
            @click="handleImportSkill"
          >
            <Import :size="16" />
            Import...
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>

    <div
      class="relative"
      @mouseenter="openMenuType = 'subAgent'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-sand)"
        >
          <Bot
            :size="16"
            class="text-card"
          />
        </span>
        <span class="font-mono text-sm text-foreground">Agents &gt;</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="subAgentStore.typedAvailableItems"
        :visible="openMenuType === 'subAgent'"
        :groups="subAgentStore.groups"
        :expanded-group-ids="subAgentStore.expandedGroupIds"
        @item-select="handleSubAgentSelect"
        @item-edit="handleSubAgentEdit"
        @item-delete="(id, name, event) => handleDeleteClick('subAgent', id, name, event)"
        @toggle-group="(groupId) => subAgentStore.toggleGroupExpand(groupId)"
        @group-delete="(groupId, name, event) => handleGroupDelete('subAgentGroup', groupId, name, event)"
        @item-drop-to-group="handleSubAgentDropToGroup"
      >
        <template #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewSubAgent"
          >
            <FilePlus :size="16" />
            New File...
          </div>
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewSubAgentGroup"
          >
            <FolderPlus :size="16" />
            New Group...
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>

    <div
      class="relative"
      @mouseenter="openMenuType = 'mcpServer'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-purple)"
        >
          <Server
            :size="16"
            class="text-card"
          />
        </span>
        <span class="font-mono text-sm text-foreground">MCPs &gt;</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="mcpServerStore.typedAvailableItems"
        :visible="openMenuType === 'mcpServer'"
        :editable="false"
        @item-select="handleMcpServerSelect"
        @item-delete="(id, name, event) => handleDeleteClick('mcpServer', id, name, event)"
      >
        <template #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewMcpServer"
          >
            <FilePlus :size="16" />
            New...
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>

    <div
      class="relative"
      @mouseenter="openMenuType = 'repository'"
      @mouseleave="openMenuType = null"
    >
      <button
        class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary transition-colors text-left"
      >
        <span
          class="w-8 h-8 rounded-full flex items-center justify-center border border-doodle-ink"
          style="background-color: var(--doodle-orange)"
        >
          <FolderOpen
            :size="16"
            class="text-card"
          />
        </span>
        <span class="font-mono text-sm text-foreground">Repository &gt;</span>
      </button>

      <PodTypeMenuSubmenu
        v-model:hovered-item-id="hoveredItemId"
        :items="repositoryStore.typedAvailableItems"
        :visible="openMenuType === 'repository'"
        @item-select="handleRepositorySelect"
        @item-delete="(id, name, event) => handleDeleteClick('repository', id, name, event)"
      >
        <template #footer>
          <div class="border-t border-doodle-ink/30 my-1" />
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleNewRepository"
          >
            <FolderPlus :size="16" />
            New...
          </div>
          <div
            class="pod-menu-submenu-item flex items-center gap-2"
            @click="handleCloneRepository"
          >
            <Github :size="16" />
            Clone
          </div>
        </template>
      </PodTypeMenuSubmenu>
    </div>
  </div>
</template>
