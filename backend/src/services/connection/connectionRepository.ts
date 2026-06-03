import { getDb } from "../../database/index.js";
import { getStatements } from "../../database/statements.js";
import type {
  AnchorPosition,
  ConnectionStatus,
  DecideStatus,
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
  decideStatus: DecideStatus;
  decideReason: string | null;
  connectionStatus: ConnectionStatus;
  summaryModel: string;
  summaryProvider: ProviderName | null;
  summaryThinkingLevel: string | null;
  label: string;
  description: string | null;
  branchProvider: ProviderName | null;
  branchModel: string | null;
  branchThinkingLevel: string | null;
}

export type UpdateConnectionRowInput = InsertConnectionRowInput;

export class ConnectionRepository {
  private get stmts(): ConnectionStatements {
    return getStatements(getDb()).connection;
  }

  insert(input: InsertConnectionRowInput): void {
    this.stmts.insert.run({
      $id: input.id,
      $canvasId: input.canvasId,
      $sourcePodId: input.sourcePodId,
      $sourceAnchor: input.sourceAnchor,
      $targetPodId: input.targetPodId,
      $targetAnchor: input.targetAnchor,
      $triggerMode: input.triggerMode,
      $decideStatus: input.decideStatus,
      $decideReason: input.decideReason,
      $connectionStatus: input.connectionStatus,
      $summaryModel: input.summaryModel,
      $summaryProvider: input.summaryProvider,
      $summaryThinkingLevel: input.summaryThinkingLevel,
      $label: input.label,
      $description: input.description,
      $branchProvider: input.branchProvider,
      $branchModel: input.branchModel,
      $branchThinkingLevel: input.branchThinkingLevel,
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
    return this.stmts.updateReturning.get({
      $canvasId: input.canvasId,
      $id: input.id,
      $sourcePodId: input.sourcePodId,
      $sourceAnchor: input.sourceAnchor,
      $targetPodId: input.targetPodId,
      $targetAnchor: input.targetAnchor,
      $triggerMode: input.triggerMode,
      $decideStatus: input.decideStatus,
      $decideReason: input.decideReason,
      $connectionStatus: input.connectionStatus,
      $summaryModel: input.summaryModel,
      $summaryProvider: input.summaryProvider,
      $summaryThinkingLevel: input.summaryThinkingLevel,
      $label: input.label,
      $description: input.description,
      $branchProvider: input.branchProvider,
      $branchModel: input.branchModel,
      $branchThinkingLevel: input.branchThinkingLevel,
    }) as ConnectionRow | undefined;
  }

  updateConnectionStatusReturning(
    canvasId: string,
    id: string,
    connectionStatus: ConnectionStatus,
  ): ConnectionRow | undefined {
    return this.stmts.updateConnectionStatusReturning.get({
      $canvasId: canvasId,
      $id: id,
      $connectionStatus: connectionStatus,
    }) as ConnectionRow | undefined;
  }

  deleteByPodId(canvasId: string, podId: string): number {
    const result = this.stmts.deleteByPodId.run({
      $canvasId: canvasId,
      $podId: podId,
    });
    return result.changes;
  }

  clearDecideStatusByPodId(canvasId: string, podId: string): void {
    this.stmts.clearDecideStatusByPodId.run({
      $canvasId: canvasId,
      $podId: podId,
    });
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
