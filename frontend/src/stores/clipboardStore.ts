import { defineStore } from "pinia";
import type {
  CopiedPod,
  CopiedRepositoryNote,
  CopiedCommandNote,
  CopiedMcpServerNote,
  CopiedConnection,
} from "@/types";

interface ClipboardState {
  copiedPods: CopiedPod[];
  copiedRepositoryNotes: CopiedRepositoryNote[];
  copiedCommandNotes: CopiedCommandNote[];
  copiedMcpServerNotes: CopiedMcpServerNote[];
  copiedConnections: CopiedConnection[];
}

export const useClipboardStore = defineStore("clipboard", {
  state: (): ClipboardState => ({
    copiedPods: [],
    copiedRepositoryNotes: [],
    copiedCommandNotes: [],
    copiedMcpServerNotes: [],
    copiedConnections: [],
  }),

  getters: {
    isEmpty: (state): boolean =>
      state.copiedPods.length === 0 &&
      state.copiedRepositoryNotes.length === 0 &&
      state.copiedCommandNotes.length === 0 &&
      state.copiedMcpServerNotes.length === 0 &&
      state.copiedConnections.length === 0,
  },

  actions: {
    setCopy(
      pods: CopiedPod[],
      repositoryNotes: CopiedRepositoryNote[],
      commandNotes: CopiedCommandNote[],
      mcpServerNotes: CopiedMcpServerNote[],
      connections: CopiedConnection[],
    ): void {
      this.copiedPods = pods;
      this.copiedRepositoryNotes = repositoryNotes;
      this.copiedCommandNotes = commandNotes;
      this.copiedMcpServerNotes = mcpServerNotes;
      this.copiedConnections = connections;
    },

    clear(): void {
      this.copiedPods = [];
      this.copiedRepositoryNotes = [];
      this.copiedCommandNotes = [];
      this.copiedMcpServerNotes = [];
      this.copiedConnections = [];
    },

    getCopiedData(): {
      pods: CopiedPod[];
      repositoryNotes: CopiedRepositoryNote[];
      commandNotes: CopiedCommandNote[];
      mcpServerNotes: CopiedMcpServerNote[];
      connections: CopiedConnection[];
    } {
      return {
        pods: this.copiedPods,
        repositoryNotes: this.copiedRepositoryNotes,
        commandNotes: this.copiedCommandNotes,
        mcpServerNotes: this.copiedMcpServerNotes,
        connections: this.copiedConnections,
      };
    },
  },
});
