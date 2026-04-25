import { defineStore } from "pinia";
import type {
  CopiedPod,
  CopiedSkillNote,
  CopiedRepositoryNote,
  CopiedSubAgentNote,
  CopiedCommandNote,
  CopiedMcpServerNote,
  CopiedConnection,
} from "@/types";

interface ClipboardState {
  copiedPods: CopiedPod[];
  copiedSkillNotes: CopiedSkillNote[];
  copiedRepositoryNotes: CopiedRepositoryNote[];
  copiedSubAgentNotes: CopiedSubAgentNote[];
  copiedCommandNotes: CopiedCommandNote[];
  copiedMcpServerNotes: CopiedMcpServerNote[];
  copiedConnections: CopiedConnection[];
}

export const useClipboardStore = defineStore("clipboard", {
  state: (): ClipboardState => ({
    copiedPods: [],
    copiedSkillNotes: [],
    copiedRepositoryNotes: [],
    copiedSubAgentNotes: [],
    copiedCommandNotes: [],
    copiedMcpServerNotes: [],
    copiedConnections: [],
  }),

  getters: {
    isEmpty: (state): boolean =>
      state.copiedPods.length === 0 &&
      state.copiedSkillNotes.length === 0 &&
      state.copiedRepositoryNotes.length === 0 &&
      state.copiedSubAgentNotes.length === 0 &&
      state.copiedCommandNotes.length === 0 &&
      state.copiedMcpServerNotes.length === 0 &&
      state.copiedConnections.length === 0,
  },

  actions: {
    setCopy(
      pods: CopiedPod[],
      skillNotes: CopiedSkillNote[],
      repositoryNotes: CopiedRepositoryNote[],
      subAgentNotes: CopiedSubAgentNote[],
      commandNotes: CopiedCommandNote[],
      mcpServerNotes: CopiedMcpServerNote[],
      connections: CopiedConnection[],
    ): void {
      this.copiedPods = pods;
      this.copiedSkillNotes = skillNotes;
      this.copiedRepositoryNotes = repositoryNotes;
      this.copiedSubAgentNotes = subAgentNotes;
      this.copiedCommandNotes = commandNotes;
      this.copiedMcpServerNotes = mcpServerNotes;
      this.copiedConnections = connections;
    },

    clear(): void {
      this.copiedPods = [];
      this.copiedSkillNotes = [];
      this.copiedRepositoryNotes = [];
      this.copiedSubAgentNotes = [];
      this.copiedCommandNotes = [];
      this.copiedMcpServerNotes = [];
      this.copiedConnections = [];
    },

    getCopiedData(): {
      pods: CopiedPod[];
      skillNotes: CopiedSkillNote[];
      repositoryNotes: CopiedRepositoryNote[];
      subAgentNotes: CopiedSubAgentNote[];
      commandNotes: CopiedCommandNote[];
      mcpServerNotes: CopiedMcpServerNote[];
      connections: CopiedConnection[];
    } {
      return {
        pods: this.copiedPods,
        skillNotes: this.copiedSkillNotes,
        repositoryNotes: this.copiedRepositoryNotes,
        subAgentNotes: this.copiedSubAgentNotes,
        commandNotes: this.copiedCommandNotes,
        mcpServerNotes: this.copiedMcpServerNotes,
        connections: this.copiedConnections,
      };
    },
  },
});
