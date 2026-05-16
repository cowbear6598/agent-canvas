import { defineStore } from "pinia";
import type {
  CopiedPod,
  CopiedRepositoryNote,
  CopiedConnection,
} from "@/types";

interface ClipboardState {
  copiedPods: CopiedPod[];
  copiedRepositoryNotes: CopiedRepositoryNote[];
  copiedConnections: CopiedConnection[];
}

export const useClipboardStore = defineStore("clipboard", {
  state: (): ClipboardState => ({
    copiedPods: [],
    copiedRepositoryNotes: [],
    copiedConnections: [],
  }),

  getters: {
    isEmpty: (state): boolean =>
      state.copiedPods.length === 0 &&
      state.copiedRepositoryNotes.length === 0 &&
      state.copiedConnections.length === 0,
  },

  actions: {
    setCopy(
      pods: CopiedPod[],
      repositoryNotes: CopiedRepositoryNote[],
      connections: CopiedConnection[],
    ): void {
      this.copiedPods = pods;
      this.copiedRepositoryNotes = repositoryNotes;
      this.copiedConnections = connections;
    },

    clear(): void {
      this.copiedPods = [];
      this.copiedRepositoryNotes = [];
      this.copiedConnections = [];
    },

    getCopiedData(): {
      pods: CopiedPod[];
      repositoryNotes: CopiedRepositoryNote[];
      connections: CopiedConnection[];
    } {
      return {
        pods: this.copiedPods,
        repositoryNotes: this.copiedRepositoryNotes,
        connections: this.copiedConnections,
      };
    },
  },
});
