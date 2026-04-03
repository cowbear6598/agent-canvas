import type {
  Pod,
  OutputStyleNote,
  SkillNote,
  RepositoryNote,
  SubAgentNote,
  CommandNote,
  McpServerNote,
  Connection,
  PasteError,
} from "../../types";
import type { CanvasPastePayload, PastePodItem } from "../../schemas";
import { podStore } from "../../services/podStore.js";
import { getPodDisplayName } from "../../utils/handlerHelpers.js";
import { workspaceService } from "../../services/workspace";
import {
  noteStore,
  skillNoteStore,
  subAgentNoteStore,
  repositoryNoteStore,
  commandNoteStore,
  mcpServerNoteStore,
} from "../../services/noteStores.js";
import { connectionStore } from "../../services/connectionStore.js";
import { repositoryService } from "../../services/repositoryService.js";
import { getErrorMessage } from "../../utils/websocketResponse.js";
import { createI18nError, type I18nError } from "../../utils/i18nError.js";
import { logger } from "../../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import { directoryExists } from "../../services/shared/fileResourceHelpers.js";
import {
  fsOperation,
  safeExecute,
  safeExecuteAsync,
} from "../../utils/operationHelpers.js";

function resolveBoundPodId(
  boundToOriginalPodId: string | null,
  podIdMapping: Record<string, string>,
): string | null {
  if (!boundToOriginalPodId) return null;
  return podIdMapping[boundToOriginalPodId] ?? null;
}

function recordError(
  errors: PasteError[],
  type: PasteError["type"],
  originalId: string,
  error: unknown,
  context: string,
): void {
  const errorMessage =
    error instanceof Object && "key" in error
      ? (error as I18nError)
      : getErrorMessage(error);
  errors.push({ type, originalId, error: errorMessage });
  const logMessage =
    typeof errorMessage === "string" ? errorMessage : errorMessage.key;
  logger.error("Paste", "Error", `${context}：${logMessage}`);
}

async function copyClaudeDir(srcCwd: string, destCwd: string): Promise<void> {
  const srcClaudeDir = path.join(srcCwd, ".claude");
  const destClaudeDir = path.join(destCwd, ".claude");

  const exists = await directoryExists(srcClaudeDir);
  if (!exists) {
    return;
  }

  await fsOperation(
    () => fs.cp(srcClaudeDir, destClaudeDir, { recursive: true }),
    `複製 .claude 目錄失敗`,
  );
}

async function createSinglePod(
  canvasId: string,
  podItem: PastePodItem,
): Promise<{ pod: Pod; originalId: string }> {
  let finalRepositoryId = podItem.repositoryId ?? null;

  if (finalRepositoryId) {
    const exists = await repositoryService.exists(finalRepositoryId);
    if (!exists) {
      throw createI18nError("errors.repoNotExists");
    }
  }

  const { pod } = podStore.create(canvasId, {
    name: podItem.name,
    x: podItem.x,
    y: podItem.y,
    rotation: podItem.rotation,
    outputStyleId: podItem.outputStyleId ?? null,
    skillIds: podItem.skillIds ?? [],
    subAgentIds: podItem.subAgentIds ?? [],
    pluginIds: podItem.pluginIds ?? [],
    model: podItem.model,
    repositoryId: finalRepositoryId,
    commandId: podItem.commandId ?? null,
  });

  await workspaceService.createWorkspace(pod.workspacePath);

  const originalPod = podStore.getById(canvasId, podItem.originalId);
  if (originalPod) {
    const srcCwd = originalPod.repositoryId
      ? repositoryService.getRepositoryPath(originalPod.repositoryId)
      : originalPod.workspacePath;
    const destCwd = finalRepositoryId
      ? repositoryService.getRepositoryPath(finalRepositoryId)
      : pod.workspacePath;
    await copyClaudeDir(srcCwd, destCwd);
  }

  return { pod, originalId: podItem.originalId };
}

export async function createPastedPods(
  canvasId: string,
  pods: PastePodItem[],
  podIdMapping: Record<string, string>,
  errors: PasteError[],
): Promise<Pod[]> {
  const createdPods: Pod[] = [];

  for (const podItem of pods) {
    const createResult = await safeExecuteAsync(() =>
      createSinglePod(canvasId, podItem),
    );
    if (!createResult.success) {
      recordError(
        errors,
        "pod",
        podItem.originalId,
        createResult.error,
        "建立 Pod 失敗",
      );
      continue;
    }

    const { pod, originalId } = createResult.data;
    createdPods.push(pod);
    podIdMapping[originalId] = pod.id;
    logger.log("Paste", "Create", `已建立 Pod「${pod.name}」`);
  }

  return createdPods;
}

type NoteStoreType<T> = {
  create: (
    canvasId: string,
    params: {
      [K in keyof T]: T[K];
    },
  ) => T;
};

type NoteCreateParams<
  T extends {
    id: string;
    name: string;
    x: number;
    y: number;
    boundToPodId: string | null;
    originalPosition: { x: number; y: number } | null;
  },
> = Omit<T, "id">;

function createPastedNotes<
  TNoteItem extends { boundToOriginalPodId: string | null },
  TNote extends {
    id: string;
    name: string;
    x: number;
    y: number;
    boundToPodId: string | null;
    originalPosition: { x: number; y: number } | null;
  },
>(
  canvasId: string,
  noteItems: TNoteItem[],
  noteStore: NoteStoreType<TNote>,
  podIdMapping: Record<string, string>,
  noteType: PasteError["type"],
  getResourceId: (item: TNoteItem) => string,
  createParams: (
    item: TNoteItem,
    boundToPodId: string | null,
  ) => NoteCreateParams<TNote>,
): { notes: TNote[]; errors: PasteError[] } {
  const createdNotes: TNote[] = [];
  const errors: PasteError[] = [];

  for (const noteItem of noteItems) {
    const boundToPodId = resolveBoundPodId(
      noteItem.boundToOriginalPodId,
      podIdMapping,
    );
    const params = createParams(noteItem, boundToPodId) as Parameters<
      typeof noteStore.create
    >[1];

    const noteResult = safeExecute(() => noteStore.create(canvasId, params));
    if (!noteResult.success) {
      const resourceId = getResourceId(noteItem);
      recordError(
        errors,
        noteType,
        resourceId,
        noteResult.error,
        `建立${noteType}失敗`,
      );
      continue;
    }

    const note = noteResult.data;
    createdNotes.push(note);
    logger.log("Paste", "Create", `已建立${noteType}「${note.name}」`);
  }

  return { notes: createdNotes, errors };
}

export function createPastedConnections(
  canvasId: string,
  connections: CanvasPastePayload["connections"],
  podIdMapping: Record<string, string>,
): Connection[] {
  const createdConnections: Connection[] = [];

  for (const connItem of connections ?? []) {
    const newSourcePodId = podIdMapping[connItem.originalSourcePodId];
    const newTargetPodId = podIdMapping[connItem.originalTargetPodId];

    if (!newSourcePodId || !newTargetPodId) {
      continue;
    }

    const connResult = safeExecute(() =>
      connectionStore.create(canvasId, {
        sourcePodId: newSourcePodId,
        sourceAnchor: connItem.sourceAnchor,
        targetPodId: newTargetPodId,
        targetAnchor: connItem.targetAnchor,
        triggerMode: connItem.triggerMode ?? "auto",
      }),
    );

    if (!connResult.success) {
      logger.error("Paste", "Error", `建立連線失敗：${connResult.error}`);
      continue;
    }

    createdConnections.push(connResult.data);

    logger.log(
      "Paste",
      "Create",
      `已建立連線「${getPodDisplayName(canvasId, newSourcePodId)} → ${getPodDisplayName(canvasId, newTargetPodId)}」`,
    );
  }

  return createdConnections;
}

type NoteItemBase = {
  boundToOriginalPodId: string | null;
  name: string;
  x: number;
  y: number;
  originalPosition: { x: number; y: number } | null;
};
type NoteItemWithId<K extends string> = NoteItemBase & Record<K, string>;

type NotePasteConfig<
  TNoteItem extends NoteItemBase,
  TNote extends {
    id: string;
    name: string;
    x: number;
    y: number;
    boundToPodId: string | null;
    originalPosition: { x: number; y: number } | null;
  },
> = {
  store: NoteStoreType<TNote>;
  type: PasteError["type"];
  getId: (item: TNoteItem) => string;
  createParams: (
    item: TNoteItem,
    boundToPodId: string | null,
  ) => NoteCreateParams<TNote>;
};

function makeNoteConfig<
  K extends string,
  TNote extends {
    id: string;
    name: string;
    x: number;
    y: number;
    boundToPodId: string | null;
    originalPosition: { x: number; y: number } | null;
  } & Record<K, string>,
>(
  idKey: K,
  store: NoteStoreType<TNote>,
  type: PasteError["type"],
): NotePasteConfig<NoteItemWithId<K>, TNote> {
  return {
    store,
    type,
    getId: (item) => item[idKey],
    createParams: (item, boundToPodId) =>
      ({
        [idKey]: item[idKey],
        name: item.name,
        x: item.x,
        y: item.y,
        boundToPodId,
        originalPosition: item.originalPosition,
      }) as NoteCreateParams<TNote>,
  };
}

const NOTE_PASTE_CONFIGS = {
  outputStyle: makeNoteConfig("outputStyleId", noteStore, "outputStyleNote"),
  skill: makeNoteConfig("skillId", skillNoteStore, "skillNote"),
  repository: makeNoteConfig(
    "repositoryId",
    repositoryNoteStore,
    "repositoryNote",
  ),
  subAgent: makeNoteConfig("subAgentId", subAgentNoteStore, "subAgentNote"),
  command: makeNoteConfig("commandId", commandNoteStore, "commandNote"),
  mcpServer: makeNoteConfig("mcpServerId", mcpServerNoteStore, "mcpServerNote"),
} as const;

export type NotePasteType = keyof typeof NOTE_PASTE_CONFIGS;

interface NoteItemMap {
  outputStyle: NoteItemWithId<"outputStyleId">;
  skill: NoteItemWithId<"skillId">;
  repository: NoteItemWithId<"repositoryId">;
  subAgent: NoteItemWithId<"subAgentId">;
  command: NoteItemWithId<"commandId">;
  mcpServer: NoteItemWithId<"mcpServerId">;
}

interface NoteMap {
  outputStyle: OutputStyleNote;
  skill: SkillNote;
  repository: RepositoryNote;
  subAgent: SubAgentNote;
  command: CommandNote;
  mcpServer: McpServerNote;
}

type NoteItemForType<K extends NotePasteType> = NoteItemMap[K];

type NoteForType<K extends NotePasteType> = NoteMap[K];

export function createPastedNotesByType<K extends NotePasteType>(
  type: K,
  canvasId: string,
  noteItems: NoteItemForType<K>[],
  podIdMapping: Record<string, string>,
): { notes: NoteForType<K>[]; errors: PasteError[] } {
  const config = NOTE_PASTE_CONFIGS[type] as unknown as NotePasteConfig<
    NoteItemForType<K>,
    NoteForType<K>
  >;
  return createPastedNotes(
    canvasId,
    noteItems,
    config.store,
    podIdMapping,
    config.type,
    config.getId,
    config.createParams,
  );
}
