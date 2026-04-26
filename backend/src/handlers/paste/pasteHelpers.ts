import type {
  Pod,
  RepositoryNote,
  CommandNote,
  McpServerNote,
  Connection,
  PasteError,
} from "../../types";
import type { BaseNote } from "../../types/baseNote.js";
import type { CanvasPastePayload, PastePodItem } from "../../schemas";
import { podStore } from "../../services/podStore.js";
import { getPodDisplayName } from "../../utils/handlerHelpers.js";
import { workspaceService } from "../../services/workspace";
import {
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
import { isPathWithinDirectory } from "../../utils/pathValidator.js";
import { config } from "../../config/index.js";
import {
  fsOperation,
  safeExecute,
  safeExecuteAsync,
} from "../../utils/operationHelpers.js";

// ─── 泛型型別宣告 ─────────────────────────────────────────────────────────────

type NoteStoreType<T extends { id: string }> = {
  create: (canvasId: string, params: Omit<T, "id">) => T;
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

// ─── 內部輔助函式 ──────────────────────────────────────────────────────────────

/**
 * 查找貼上目標 Pod 的 ID。
 * 若原始 Pod 不在 mapping 中（例如來源 canvas 的 Pod 未被貼上），回傳 null。
 */
function lookupBoundPodId(
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
  // 精確判斷是否為 I18nError 物件（非 null 且具備 key 屬性）
  const isI18n = error !== null && typeof error === "object" && "key" in error;
  const i18nOrMsg = isI18n ? (error as I18nError) : getErrorMessage(error);
  const logMessage = typeof i18nOrMsg === "string" ? i18nOrMsg : i18nOrMsg.key;

  errors.push({ type, originalId, error: i18nOrMsg });
  logger.error("Paste", "Error", `${context}：${logMessage}`);
}

async function copyClaudeDir(srcCwd: string, destCwd: string): Promise<void> {
  // 驗證來源與目標路徑必須在 canvasRoot 或 repositoriesRoot 範圍內，防止路徑穿越
  const isValidSrc =
    isPathWithinDirectory(srcCwd, config.canvasRoot) ||
    isPathWithinDirectory(srcCwd, config.repositoriesRoot);
  const isValidDest =
    isPathWithinDirectory(destCwd, config.canvasRoot) ||
    isPathWithinDirectory(destCwd, config.repositoriesRoot);

  if (!isValidSrc || !isValidDest) {
    logger.error(
      "Paste",
      "Error",
      `copyClaudeDir：路徑不在允許範圍內 src=${srcCwd} dest=${destCwd}`,
    );
    return;
  }

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

/**
 * 在記憶體中（Set 查找）決定唯一 Pod 名稱，避免 DB UNIQUE (canvas_id, name) 約束衝突。
 * 與並發建立場景配合：進入 Promise.all 前先同步決定所有名稱並寫入 Set，
 * 確保兩個 Pod 不會取到相同名稱。
 */
function resolveUniquePodName(
  existingNames: Set<string>,
  candidateName: string,
): string {
  if (!existingNames.has(candidateName)) return candidateName;
  let counter = 2;
  while (existingNames.has(`${candidateName} (${counter})`)) {
    counter++;
  }
  return `${candidateName} (${counter})`;
}

async function createSinglePod(
  canvasId: string,
  podItem: PastePodItem,
  resolvedName: string,
): Promise<{ pod: Pod; originalId: string }> {
  // 呼叫端（createPastedPods）已透過 prefetchRepositoryExistence 完成存在性驗證，
  // 此處直接使用，不重複查詢 DB
  const finalRepositoryId = podItem.repositoryId ?? null;

  const { pod } = podStore.create(canvasId, {
    name: resolvedName,
    x: podItem.x,
    y: podItem.y,
    rotation: podItem.rotation,
    provider: podItem.provider,
    providerConfig: podItem.providerConfig,
    mcpServerIds: podItem.mcpServerIds ?? [],
    pluginIds: podItem.pluginIds ?? [],
    repositoryId: finalRepositoryId,
    commandId: podItem.commandId ?? null,
  });

  const wsResult = await workspaceService.createWorkspace(pod.workspacePath);
  if (!wsResult.success) {
    throw createI18nError("errors.workspaceCreateFailed");
  }

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

/**
 * 批次預查 repositoryId 是否存在（去重，避免相同 repositoryId 重複查詢 DB）。
 * 回傳 Map<repositoryId, exists>。
 */
async function prefetchRepositoryExistence(
  pods: PastePodItem[],
): Promise<Map<string, boolean>> {
  const uniqueRepoIds = [
    ...new Set(pods.map((p) => p.repositoryId).filter(Boolean) as string[]),
  ];
  const repoExistsMap = new Map<string, boolean>();
  await Promise.all(
    uniqueRepoIds.map(async (repoId) => {
      const exists = await repositoryService.exists(repoId);
      repoExistsMap.set(repoId, exists);
    }),
  );
  return repoExistsMap;
}

/**
 * 同步決定所有 Pod 的唯一名稱，避免並發時兩個 Pod 取到相同名稱。
 * 每決定一個名稱後立即加入 existingNames，確保後續 Pod 不重複。
 */
function resolveAllPodNames(
  pods: PastePodItem[],
  existingNames: Set<string>,
): string[] {
  const resolvedNames: string[] = [];
  for (const podItem of pods) {
    const uniqueName = resolveUniquePodName(existingNames, podItem.name);
    existingNames.add(uniqueName);
    resolvedNames.push(uniqueName);
  }
  return resolvedNames;
}

export async function createPastedPods(
  canvasId: string,
  pods: PastePodItem[],
  podIdMapping: Record<string, string>,
  errors: PasteError[],
): Promise<Pod[]> {
  // 先一次性取得 canvas 所有已知 Pod 名稱，記憶體中查找避免 N 次 DB 查詢
  const existingNames = new Set<string>(
    podStore.list(canvasId).map((p) => p.name),
  );

  const repoExistsMap = await prefetchRepositoryExistence(pods);
  const resolvedPodNames = resolveAllPodNames(pods, existingNames);

  // 並發建立所有 Pod I/O
  const results = await Promise.all(
    pods.map(async (podItem, idx) => {
      const resolvedName = resolvedPodNames[idx]!;

      // 若 repositoryId 已預查過且不存在，直接失敗，不進 DB
      if (
        podItem.repositoryId &&
        repoExistsMap.get(podItem.repositoryId) === false
      ) {
        return {
          success: false as const,
          error: createI18nError("errors.repoNotExists"),
          originalId: podItem.originalId,
        };
      }

      const createResult = await safeExecuteAsync(() =>
        createSinglePod(canvasId, podItem, resolvedName),
      );

      if (!createResult.success) {
        return {
          success: false as const,
          error: createResult.error,
          originalId: podItem.originalId,
        };
      }

      return { success: true as const, data: createResult.data };
    }),
  );

  const createdPods: Pod[] = [];
  for (const result of results) {
    if (!result.success) {
      recordError(
        errors,
        "pod",
        result.originalId,
        result.error,
        "建立 Pod 失敗",
      );
      continue;
    }
    const { pod, originalId } = result.data;
    createdPods.push(pod);
    podIdMapping[originalId] = pod.id;
    logger.log("Paste", "Create", `已建立 Pod「${pod.name}」`);
  }

  return createdPods;
}

// ─── Note 貼上泛型基礎設施 ────────────────────────────────────────────────────

/**
 * 根據 idKey、item、boundToPodId 建立 Note 的 create 參數物件。
 * 抽為獨立函式，讓 makeNoteConfig 只負責組 config 物件。
 */
function buildNoteParams<K extends string>(
  idKey: K,
  item: Record<K, string> & {
    name: string;
    x: number;
    y: number;
    originalPosition: { x: number; y: number } | null;
  },
  boundToPodId: string | null,
): Omit<BaseNote, "id"> & Record<K, string> {
  // 物件字面量含動態 key（[idKey]），TypeScript 無法自動驗證其滿足 Record<K, string>，
  // 因此使用單層 cast；所有欄位均已在 BaseNote 型別約束內明確列舉
  const params: Record<string, unknown> = {
    [idKey]: item[idKey],
    name: item.name,
    x: item.x,
    y: item.y,
    boundToPodId,
    originalPosition: item.originalPosition,
  };
  return params as Omit<BaseNote, "id"> & Record<K, string>;
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

/**
 * 建立 Note 類型的貼上設定物件（config）。
 * store：對應的 note store；type：PasteError 分類；idKey：Note 上的 ID 欄位名。
 * 實際建立參數由 buildNoteParams 負責，此函式只組裝 config。
 */
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
      buildNoteParams<K>(
        idKey,
        item,
        boundToPodId,
      ) as unknown as NoteCreateParams<TNote>,
  };
}

/**
 * NOTE_PASTE_CONFIGS：宣告式設定陣列，將每種 Note 類型映射到對應 store、
 * PasteError 類型與 ID 欄位名，供 createPastedNotesByType 統一分發。
 */
const NOTE_PASTE_CONFIGS = {
  repository: makeNoteConfig(
    "repositoryId",
    repositoryNoteStore,
    "repositoryNote",
  ),
  command: makeNoteConfig("commandId", commandNoteStore, "commandNote"),
  mcpServer: makeNoteConfig("mcpServerId", mcpServerNoteStore, "mcpServerNote"),
} as const;

export type NotePasteType = keyof typeof NOTE_PASTE_CONFIGS;

interface NoteItemMap {
  repository: NoteItemWithId<"repositoryId">;
  command: NoteItemWithId<"commandId">;
  mcpServer: NoteItemWithId<"mcpServerId">;
}

interface NoteMap {
  repository: RepositoryNote;
  command: CommandNote;
  mcpServer: McpServerNote;
}

type NoteItemForType<K extends NotePasteType> = NoteItemMap[K];

type NoteForType<K extends NotePasteType> = NoteMap[K];

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
    const boundToPodId = lookupBoundPodId(
      noteItem.boundToOriginalPodId,
      podIdMapping,
    );
    const params = createParams(noteItem, boundToPodId);

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
