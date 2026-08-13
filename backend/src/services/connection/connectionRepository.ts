import { getDb } from "../../database/index.js";
import { getStatements } from "../../database/statements.js";
import type {
  AnchorPosition,
  TriggerMode,
} from "../../types/index.js";
import type { ProviderName } from "../provider/index.js";
import type { ConnectionRow } from "./connectionRowMapper.js";

type ConnectionStatements = ReturnType<typeof getStatements>["connection"];

export interface InsertConnectionRowInput {
  id: string;
  canvasId: string;
  sourcePodId: string;
  sourceAnchor: AnchorPosition;
  targetPodId: string;
  targetAnchor: AnchorPosition;
  triggerMode: TriggerMode;
  summaryModel: string;
  summaryProvider: ProviderName | null;
  summaryThinkingLevel: string | null;
  direct?: boolean;
  label: string;
  description: string | null;
  /** legacy 欄位，P1.A 起不再落盤，僅保留給尚未收斂的呼叫端相容使用 */
  branchProvider: ProviderName | null;
  branchModel: string | null;
  branchThinkingLevel: string | null;
}

export type UpdateConnectionRowInput = InsertConnectionRowInput;

function normalizeDirectPersistence(input: Pick<
  InsertConnectionRowInput,
  "triggerMode" | "direct"
>): {
  persistedTriggerMode: Exclude<TriggerMode, "direct">;
  persistedDirectEnabled: number;
} {
  const persistedDirectEnabled =
    input.direct === true || input.triggerMode === "direct" ? 1 : 0;
  const persistedTriggerMode =
    input.triggerMode === "direct" ? "auto" : input.triggerMode;

  return {
    persistedTriggerMode,
    persistedDirectEnabled,
  };
}

export class ConnectionRepository {
  private get stmts(): ConnectionStatements {
    return getStatements(getDb()).connection;
  }

  insert(input: InsertConnectionRowInput): void {
    const { persistedTriggerMode, persistedDirectEnabled } =
      normalizeDirectPersistence(input);
    this.stmts.insert.run({
      $id: input.id,
      $canvasId: input.canvasId,
      $sourcePodId: input.sourcePodId,
      $sourceAnchor: input.sourceAnchor,
      $targetPodId: input.targetPodId,
      $targetAnchor: input.targetAnchor,
      $triggerMode: persistedTriggerMode,
      $summaryModel: input.summaryModel,
      $summaryProvider: input.summaryProvider,
      $summaryThinkingLevel: input.summaryThinkingLevel,
      $directEnabled: persistedDirectEnabled,
      $label: input.label,
      $description: input.description,
    });
  }

  getById(canvasId: string, id: string): ConnectionRow | undefined {
    return this.stmts.selectById.get(canvasId, id) as ConnectionRow | undefined;
  }

  list(canvasId: string): ConnectionRow[] {
    return this.stmts.selectByCanvasId.all(canvasId) as ConnectionRow[];
  }

  delete(canvasId: string, id: string): boolean {
    const result = this.stmts.deleteById.run(canvasId, id);
    return result.changes > 0;
  }

  findByPodId(canvasId: string, podId: string): ConnectionRow[] {
    return this.stmts.selectByPodId.all({
      $canvasId: canvasId,
      $podId: podId,
    }) as ConnectionRow[];
  }

  findBySourcePodId(canvasId: string, sourcePodId: string): ConnectionRow[] {
    return this.stmts.selectBySourcePodId.all({
      $canvasId: canvasId,
      $sourcePodId: sourcePodId,
    }) as ConnectionRow[];
  }

  findByTargetPodId(canvasId: string, targetPodId: string): ConnectionRow[] {
    return this.stmts.selectByTargetPodId.all({
      $canvasId: canvasId,
      $targetPodId: targetPodId,
    }) as ConnectionRow[];
  }

  updateReturning(input: UpdateConnectionRowInput): ConnectionRow | undefined {
    const { persistedTriggerMode, persistedDirectEnabled } =
      normalizeDirectPersistence(input);
    return this.stmts.updateReturning.get({
      $canvasId: input.canvasId,
      $id: input.id,
      $sourcePodId: input.sourcePodId,
      $sourceAnchor: input.sourceAnchor,
      $targetPodId: input.targetPodId,
      $targetAnchor: input.targetAnchor,
      $triggerMode: persistedTriggerMode,
      $summaryModel: input.summaryModel,
      $summaryProvider: input.summaryProvider,
      $summaryThinkingLevel: input.summaryThinkingLevel,
      $directEnabled: persistedDirectEnabled,
      $label: input.label,
      $description: input.description,
    }) as ConnectionRow | undefined;
  }

  deleteByPodId(canvasId: string, podId: string): number {
    const result = this.stmts.deleteByPodId.run({
      $canvasId: canvasId,
      $podId: podId,
    });
    return result.changes;
  }

  findByTriggerMode(
    canvasId: string,
    sourcePodId: string,
    triggerMode: TriggerMode,
  ): ConnectionRow[] {
    return this.stmts.selectByTriggerMode.all({
      $canvasId: canvasId,
      $sourcePodId: sourcePodId,
      $triggerMode: triggerMode,
    }) as ConnectionRow[];
  }
}
