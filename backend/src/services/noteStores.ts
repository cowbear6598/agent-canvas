import { createNoteStore } from "./GenericNoteStore.js";
import type { RepositoryNote } from "../types";

export const repositoryNoteStore = createNoteStore<
  RepositoryNote,
  "repositoryId"
>({
  noteType: "repository",
  foreignKeyField: "repositoryId",
  storeName: "RepositoryNoteStore",
});
