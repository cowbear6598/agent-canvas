import type {
  Pod,
  OutputStyleNote,
  SkillNote,
  RepositoryNote,
  SubAgentNote,
  CommandNote,
  Connection,
  PasteError,
} from '../../types';
import type {
  CanvasPastePayload,
  PastePodItem,
} from '../../schemas';
import { podStore } from '../../services/podStore.js';
import { getPodDisplayName } from '../../utils/handlerHelpers.js';
import { workspaceService } from '../../services/workspace';
import { noteStore, skillNoteStore, subAgentNoteStore, repositoryNoteStore, commandNoteStore } from '../../services/noteStores.js';
import { connectionStore } from '../../services/connectionStore.js';
import { repositoryService } from '../../services/repositoryService.js';
import { getErrorMessage } from '../../utils/websocketResponse.js';
import { logger } from '../../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { directoryExists } from '../../services/shared/fileResourceHelpers.js';
import { fsOperation } from '../../utils/operationHelpers.js';

function resolveBoundPodId(
  boundToOriginalPodId: string | null,
  podIdMapping: Record<string, string>
): string | null {
  if (!boundToOriginalPodId) return null;
  return podIdMapping[boundToOriginalPodId] ?? null;
}

function recordError(
  errors: PasteError[],
  type: PasteError['type'],
  originalId: string,
  error: unknown,
  context: string
): void {
  const errorMessage = getErrorMessage(error);
  errors.push({ type, originalId, error: errorMessage });
  logger.error('Paste', 'Error', `${context}：${errorMessage}`);
}

async function copyClaudeDir(srcCwd: string, destCwd: string): Promise<void> {
  const srcClaudeDir = path.join(srcCwd, '.claude');
  const destClaudeDir = path.join(destCwd, '.claude');

  const exists = await directoryExists(srcClaudeDir);
  if (!exists) {
    return;
  }

  await fsOperation(
    () => fs.cp(srcClaudeDir, destClaudeDir, { recursive: true }),
    `複製 .claude 目錄失敗`
  );
}

async function createSinglePod(
  canvasId: string,
  podItem: PastePodItem
): Promise<{ pod: Pod; originalId: string }> {
  let finalRepositoryId = podItem.repositoryId ?? null;

  if (finalRepositoryId) {
    const exists = await repositoryService.exists(finalRepositoryId);
    if (!exists) {
      throw new Error(`Repository 找不到: ${finalRepositoryId}`);
    }
  }

  const pod = podStore.create(canvasId, {
    name: podItem.name,
    x: podItem.x,
    y: podItem.y,
    rotation: podItem.rotation,
    outputStyleId: podItem.outputStyleId ?? null,
    skillIds: podItem.skillIds ?? [],
    subAgentIds: podItem.subAgentIds ?? [],
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
  errors: PasteError[]
): Promise<Pod[]> {
  const createdPods: Pod[] = [];

  for (const podItem of pods) {
    let result: { pod: Pod; originalId: string };

    try {
      result = await createSinglePod(canvasId, podItem);
    } catch (error) {
      recordError(errors, 'pod', podItem.originalId, error, '建立 Pod 失敗');
      continue;
    }

    const { pod, originalId } = result;
    createdPods.push(pod);
    podIdMapping[originalId] = pod.id;
    logger.log('Paste', 'Create', `已建立 Pod「${pod.name}」`);
  }

  return createdPods;
}

type NoteStoreType<T> = {
  create: (canvasId: string, params: {
    [K in keyof T]: T[K];
  }) => T;
};

type NoteCreateParams<T extends { id: string; name: string; x: number; y: number; boundToPodId: string | null; originalPosition: { x: number; y: number } | null }> = Omit<T, 'id'>;

function createPastedNotes<
  TNoteItem extends { boundToOriginalPodId: string | null },
  TNote extends { id: string; name: string; x: number; y: number; boundToPodId: string | null; originalPosition: { x: number; y: number } | null }
>(
  canvasId: string,
  noteItems: TNoteItem[],
  noteStore: NoteStoreType<TNote>,
  podIdMapping: Record<string, string>,
  noteType: PasteError['type'],
  getResourceId: (item: TNoteItem) => string,
  createParams: (item: TNoteItem, boundToPodId: string | null) => NoteCreateParams<TNote>
): { notes: TNote[]; errors: PasteError[] } {
  const createdNotes: TNote[] = [];
  const errors: PasteError[] = [];

  for (const noteItem of noteItems) {
    const boundToPodId = resolveBoundPodId(noteItem.boundToOriginalPodId, podIdMapping);
    const params = createParams(noteItem, boundToPodId) as Parameters<typeof noteStore.create>[1];

    let note: TNote;

    try {
      note = noteStore.create(canvasId, params);
    } catch (error) {
      const resourceId = getResourceId(noteItem);
      recordError(errors, noteType, resourceId, error, `建立${noteType}失敗`);
      continue;
    }

    createdNotes.push(note);
    logger.log('Paste', 'Create', `已建立${noteType}「${note.name}」`);
  }

  return { notes: createdNotes, errors };
}

export function createPastedConnections(
  canvasId: string,
  connections: CanvasPastePayload['connections'],
  podIdMapping: Record<string, string>
): Connection[] {
  const createdConnections: Connection[] = [];

  for (const connItem of connections ?? []) {
    const newSourcePodId = podIdMapping[connItem.originalSourcePodId];
    const newTargetPodId = podIdMapping[connItem.originalTargetPodId];

    if (!newSourcePodId || !newTargetPodId) {
      continue;
    }

    let newConnection: Connection;

    try {
      newConnection = connectionStore.create(canvasId, {
        sourcePodId: newSourcePodId,
        sourceAnchor: connItem.sourceAnchor,
        targetPodId: newTargetPodId,
        targetAnchor: connItem.targetAnchor,
        triggerMode: connItem.triggerMode ?? 'auto',
      });
    } catch (error) {
      logger.error('Paste', 'Error', `建立連線失敗：${getErrorMessage(error)}`);
      continue;
    }

    createdConnections.push(newConnection);

    logger.log('Paste', 'Create', `已建立連線「${getPodDisplayName(canvasId, newSourcePodId)} → ${getPodDisplayName(canvasId, newTargetPodId)}」`);
  }

  return createdConnections;
}

type NoteItemBase = { boundToOriginalPodId: string | null; name: string; x: number; y: number; originalPosition: { x: number; y: number } | null };
type OutputStyleNoteItem = NoteItemBase & { outputStyleId: string };
type SkillNoteItem = NoteItemBase & { skillId: string };
type RepositoryNoteItem = NoteItemBase & { repositoryId: string };
type SubAgentNoteItem = NoteItemBase & { subAgentId: string };
type CommandNoteItem = NoteItemBase & { commandId: string };

type NotePasteConfig<TNoteItem extends NoteItemBase, TNote extends { id: string; name: string; x: number; y: number; boundToPodId: string | null; originalPosition: { x: number; y: number } | null }> = {
  store: NoteStoreType<TNote>;
  type: PasteError['type'];
  getId: (item: TNoteItem) => string;
  createParams: (item: TNoteItem, boundToPodId: string | null) => NoteCreateParams<TNote>;
};

const NOTE_PASTE_CONFIGS = {
  outputStyle: {
    store: noteStore,
    type: 'outputStyleNote',
    getId: (item: OutputStyleNoteItem): string => item.outputStyleId,
    createParams: (item: OutputStyleNoteItem, boundToPodId: string | null): NoteCreateParams<OutputStyleNote> => ({
      outputStyleId: item.outputStyleId,
      name: item.name,
      x: item.x,
      y: item.y,
      boundToPodId,
      originalPosition: item.originalPosition,
    }),
  } satisfies NotePasteConfig<OutputStyleNoteItem, OutputStyleNote>,
  skill: {
    store: skillNoteStore,
    type: 'skillNote',
    getId: (item: SkillNoteItem): string => item.skillId,
    createParams: (item: SkillNoteItem, boundToPodId: string | null): NoteCreateParams<SkillNote> => ({
      skillId: item.skillId,
      name: item.name,
      x: item.x,
      y: item.y,
      boundToPodId,
      originalPosition: item.originalPosition,
    }),
  } satisfies NotePasteConfig<SkillNoteItem, SkillNote>,
  repository: {
    store: repositoryNoteStore,
    type: 'repositoryNote',
    getId: (item: RepositoryNoteItem): string => item.repositoryId,
    createParams: (item: RepositoryNoteItem, boundToPodId: string | null): NoteCreateParams<RepositoryNote> => ({
      repositoryId: item.repositoryId,
      name: item.name,
      x: item.x,
      y: item.y,
      boundToPodId,
      originalPosition: item.originalPosition,
    }),
  } satisfies NotePasteConfig<RepositoryNoteItem, RepositoryNote>,
  subAgent: {
    store: subAgentNoteStore,
    type: 'subAgentNote',
    getId: (item: SubAgentNoteItem): string => item.subAgentId,
    createParams: (item: SubAgentNoteItem, boundToPodId: string | null): NoteCreateParams<SubAgentNote> => ({
      subAgentId: item.subAgentId,
      name: item.name,
      x: item.x,
      y: item.y,
      boundToPodId,
      originalPosition: item.originalPosition,
    }),
  } satisfies NotePasteConfig<SubAgentNoteItem, SubAgentNote>,
  command: {
    store: commandNoteStore,
    type: 'commandNote',
    getId: (item: CommandNoteItem): string => item.commandId,
    createParams: (item: CommandNoteItem, boundToPodId: string | null): NoteCreateParams<CommandNote> => ({
      commandId: item.commandId,
      name: item.name,
      x: item.x,
      y: item.y,
      boundToPodId,
      originalPosition: item.originalPosition,
    }),
  } satisfies NotePasteConfig<CommandNoteItem, CommandNote>,
} as const;

export type NotePasteType = keyof typeof NOTE_PASTE_CONFIGS;

type NoteItemForType<K extends NotePasteType> =
  K extends 'outputStyle' ? OutputStyleNoteItem :
  K extends 'skill' ? SkillNoteItem :
  K extends 'repository' ? RepositoryNoteItem :
  K extends 'subAgent' ? SubAgentNoteItem :
  K extends 'command' ? CommandNoteItem :
  never;

type NoteForType<K extends NotePasteType> =
  K extends 'outputStyle' ? OutputStyleNote :
  K extends 'skill' ? SkillNote :
  K extends 'repository' ? RepositoryNote :
  K extends 'subAgent' ? SubAgentNote :
  K extends 'command' ? CommandNote :
  never;

export function createPastedNotesByType<K extends NotePasteType>(
  type: K,
  canvasId: string,
  noteItems: NoteItemForType<K>[],
  podIdMapping: Record<string, string>
): { notes: NoteForType<K>[]; errors: PasteError[] } {
  const config = NOTE_PASTE_CONFIGS[type] as unknown as NotePasteConfig<NoteItemForType<K>, NoteForType<K>>;
  return createPastedNotes(canvasId, noteItems, config.store, podIdMapping, config.type, config.getId, config.createParams);
}
