import { GenericNoteStore } from "./GenericNoteStore.js";
import type { RepositoryNote } from "../types";

export const repositoryNoteStore = new GenericNoteStore<
  RepositoryNote,
  "repositoryId"
>({
  noteType: "repository",
  foreignKeyField: "repositoryId",
  storeName: "RepositoryNoteStore",
});
