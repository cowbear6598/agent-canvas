import { createNoteStore } from "./GenericNoteStore.js";
import type {
  RepositoryNote,
  SubAgentNote,
  CommandNote,
  McpServerNote,
} from "../types";

export const repositoryNoteStore = createNoteStore<
  RepositoryNote,
  "repositoryId"
>({
  noteType: "repository",
  foreignKeyField: "repositoryId",
  storeName: "RepositoryNoteStore",
});

export const subAgentNoteStore = createNoteStore<SubAgentNote, "subAgentId">({
  noteType: "subAgent",
  foreignKeyField: "subAgentId",
  storeName: "SubAgentNoteStore",
});

export const commandNoteStore = createNoteStore<CommandNote, "commandId">({
  noteType: "command",
  foreignKeyField: "commandId",
  storeName: "CommandNoteStore",
});

export const mcpServerNoteStore = createNoteStore<McpServerNote, "mcpServerId">(
  {
    noteType: "mcpServer",
    foreignKeyField: "mcpServerId",
    storeName: "McpServerNoteStore",
  },
);
