<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type {
  OutputStyleNote,
  SkillNote,
  SubAgentNote,
  RepositoryNote,
  CommandNote,
  McpServerNote,
} from "@/types";
import PodMultiBindSlot from "@/components/pod/PodMultiBindSlot.vue";
import PodSingleBindSlot from "@/components/pod/PodSingleBindSlot.vue";
import {
  useSkillStore,
  useSubAgentStore,
  useMcpServerStore,
  useOutputStyleStore,
  useRepositoryStore,
  useCommandStore,
} from "@/stores/note";

const {
  podId,
  podRotation,
  boundOutputStyleNote,
  boundSkillNotes,
  boundSubAgentNotes,
  boundRepositoryNote,
  boundCommandNote,
  boundMcpServerNotes,
} = defineProps<{
  podId: string;
  podRotation: number;
  boundOutputStyleNote: OutputStyleNote | undefined;
  boundSkillNotes: SkillNote[];
  boundSubAgentNotes: SubAgentNote[];
  boundRepositoryNote: RepositoryNote | undefined;
  boundCommandNote: CommandNote | undefined;
  boundMcpServerNotes: McpServerNote[];
}>();

const emit = defineEmits<{
  "output-style-dropped": [noteId: string];
  "output-style-removed": [];
  "skill-dropped": [noteId: string];
  "subagent-dropped": [noteId: string];
  "repository-dropped": [noteId: string];
  "repository-removed": [];
  "command-dropped": [noteId: string];
  "command-removed": [];
  "mcp-server-dropped": [noteId: string];
}>();

const { t } = useI18n();

const skillStore = useSkillStore();
const subAgentStore = useSubAgentStore();
const mcpServerStore = useMcpServerStore();
const outputStyleStore = useOutputStyleStore();
const repositoryStore = useRepositoryStore();
const commandStore = useCommandStore();
</script>

<template>
  <div class="pod-notch-area-base pod-notch-area">
    <PodSingleBindSlot
      :pod-id="podId"
      :bound-note="boundOutputStyleNote"
      :store="outputStyleStore"
      label="Style"
      slot-class="pod-output-style-slot"
      :pod-rotation="podRotation"
      @note-dropped="(noteId) => emit('output-style-dropped', noteId)"
      @note-removed="() => emit('output-style-removed')"
    />
  </div>

  <div class="pod-notch-area-base pod-skill-notch-area">
    <PodMultiBindSlot
      :pod-id="podId"
      :bound-notes="boundSkillNotes"
      :store="skillStore"
      label="Skills"
      :duplicate-toast-title="t('pod.slot.duplicateTitle')"
      :duplicate-toast-description="t('pod.slot.skillDuplicate')"
      slot-class="pod-skill-slot"
      menu-scrollable-class="pod-skill-menu-scrollable"
      item-id-field="skillId"
      @note-dropped="(noteId) => emit('skill-dropped', noteId)"
    />
  </div>

  <div class="pod-notch-area-base pod-subagent-notch-area">
    <PodMultiBindSlot
      :pod-id="podId"
      :bound-notes="boundSubAgentNotes"
      :store="subAgentStore"
      label="SubAgents"
      :duplicate-toast-title="t('pod.slot.duplicateTitle')"
      :duplicate-toast-description="t('pod.slot.subAgentDuplicate')"
      slot-class="pod-subagent-slot"
      menu-scrollable-class="pod-subagent-menu-scrollable"
      item-id-field="subAgentId"
      @note-dropped="(noteId) => emit('subagent-dropped', noteId)"
    />
  </div>

  <div class="pod-notch-area-base pod-repository-notch-area">
    <PodSingleBindSlot
      :pod-id="podId"
      :bound-note="boundRepositoryNote"
      :store="repositoryStore"
      label="Repo"
      slot-class="pod-repository-slot"
      :pod-rotation="podRotation"
      @note-dropped="(noteId) => emit('repository-dropped', noteId)"
      @note-removed="() => emit('repository-removed')"
    />
  </div>

  <div class="pod-notch-area-base pod-command-notch-area">
    <PodSingleBindSlot
      :pod-id="podId"
      :bound-note="boundCommandNote"
      :store="commandStore"
      label="Command"
      slot-class="pod-command-slot"
      :pod-rotation="podRotation"
      @note-dropped="(noteId) => emit('command-dropped', noteId)"
      @note-removed="() => emit('command-removed')"
    />
  </div>

  <div class="pod-notch-area-base pod-mcp-server-notch-area">
    <PodMultiBindSlot
      :pod-id="podId"
      :bound-notes="boundMcpServerNotes"
      :store="mcpServerStore"
      label="MCPs"
      :duplicate-toast-title="t('pod.slot.duplicateTitle')"
      :duplicate-toast-description="t('pod.slot.mcpServerDuplicate')"
      slot-class="pod-mcp-server-slot"
      menu-scrollable-class="pod-mcp-server-menu-scrollable"
      item-id-field="mcpServerId"
      @note-dropped="(noteId) => emit('mcp-server-dropped', noteId)"
    />
  </div>
</template>
