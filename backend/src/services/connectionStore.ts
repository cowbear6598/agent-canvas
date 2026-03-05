import { v4 as uuidv4 } from 'uuid';
import type { Connection, AnchorPosition, TriggerMode, DecideStatus, ConnectionStatus } from '../types';
import { getDb } from '../database/index.js';
import { getStatements } from '../database/statements.js';

interface CreateConnectionData {
    sourcePodId: string;
    sourceAnchor: AnchorPosition;
    targetPodId: string;
    targetAnchor: AnchorPosition;
    triggerMode?: TriggerMode;
}

function shouldResetDecideState(oldMode: string, newMode: string): boolean {
    return oldMode === 'ai-decide' && (newMode === 'auto' || newMode === 'direct');
}

interface ConnectionRow {
    id: string;
    canvas_id: string;
    source_pod_id: string;
    source_anchor: string;
    target_pod_id: string;
    target_anchor: string;
    trigger_mode: string;
    decide_status: string;
    decide_reason: string | null;
    connection_status: string;
}

function rowToConnection(row: ConnectionRow): Connection {
    return {
        id: row.id,
        sourcePodId: row.source_pod_id,
        sourceAnchor: row.source_anchor as AnchorPosition,
        targetPodId: row.target_pod_id,
        targetAnchor: row.target_anchor as AnchorPosition,
        triggerMode: row.trigger_mode as TriggerMode,
        decideStatus: row.decide_status as DecideStatus,
        decideReason: row.decide_reason,
        connectionStatus: row.connection_status as ConnectionStatus,
    };
}

class ConnectionStore {
    private get stmts(): ReturnType<typeof getStatements>['connection'] {
        return getStatements(getDb()).connection;
    }

    create(canvasId: string, data: CreateConnectionData): Connection {
        const id = uuidv4();

        this.stmts.insert.run({
            $id: id,
            $canvasId: canvasId,
            $sourcePodId: data.sourcePodId,
            $sourceAnchor: data.sourceAnchor,
            $targetPodId: data.targetPodId,
            $targetAnchor: data.targetAnchor,
            $triggerMode: data.triggerMode ?? 'auto',
            $decideStatus: 'none',
            $decideReason: null,
            $connectionStatus: 'idle',
        });

        return this.getById(canvasId, id) as Connection;
    }

    getById(canvasId: string, id: string): Connection | undefined {
        const row = this.stmts.selectById.get(id) as ConnectionRow | undefined;
        if (!row) return undefined;
        return rowToConnection(row);
    }

    list(canvasId: string): Connection[] {
        const rows = this.stmts.selectByCanvasId.all(canvasId) as ConnectionRow[];
        return rows.map(rowToConnection);
    }

    delete(canvasId: string, id: string): boolean {
        const result = this.stmts.deleteById.run(id);
        return result.changes > 0;
    }

    findByPodId(canvasId: string, podId: string): Connection[] {
        const rows = this.stmts.selectByPodId.all({ $canvasId: canvasId, $podId: podId }) as ConnectionRow[];
        return rows.map(rowToConnection);
    }

    findBySourcePodId(canvasId: string, sourcePodId: string): Connection[] {
        const rows = this.stmts.selectBySourcePodId.all({ $canvasId: canvasId, $sourcePodId: sourcePodId }) as ConnectionRow[];
        return rows.map(rowToConnection);
    }

    findByTargetPodId(canvasId: string, targetPodId: string): Connection[] {
        const rows = this.stmts.selectByTargetPodId.all({ $canvasId: canvasId, $targetPodId: targetPodId }) as ConnectionRow[];
        return rows.map(rowToConnection);
    }

    update(
        canvasId: string,
        id: string,
        updates: Partial<{ triggerMode: TriggerMode; decideStatus: DecideStatus; decideReason: string | null }>,
    ): Connection | undefined {
        const existing = this.getById(canvasId, id);
        if (!existing) return undefined;

        let newTriggerMode = existing.triggerMode;
        let newDecideStatus = existing.decideStatus;
        let newDecideReason = existing.decideReason;
        let newConnectionStatus = existing.connectionStatus;

        if (updates.triggerMode !== undefined) {
            if (shouldResetDecideState(existing.triggerMode, updates.triggerMode)) {
                newDecideStatus = 'none';
                newDecideReason = null;
                newConnectionStatus = 'idle';
            }
            newTriggerMode = updates.triggerMode;
        }

        if (updates.decideStatus !== undefined) {
            newDecideStatus = updates.decideStatus;
        }

        if (updates.decideReason !== undefined) {
            newDecideReason = updates.decideReason;
        }

        this.stmts.update.run({
            $id: id,
            $sourcePodId: existing.sourcePodId,
            $sourceAnchor: existing.sourceAnchor,
            $targetPodId: existing.targetPodId,
            $targetAnchor: existing.targetAnchor,
            $triggerMode: newTriggerMode,
            $decideStatus: newDecideStatus,
            $decideReason: newDecideReason,
            $connectionStatus: newConnectionStatus,
        });

        return this.getById(canvasId, id);
    }

    updateConnectionStatus(canvasId: string, connectionId: string, status: ConnectionStatus): Connection | undefined {
        const existing = this.getById(canvasId, connectionId);
        if (!existing) return undefined;

        this.stmts.updateConnectionStatus.run({
            $id: connectionId,
            $connectionStatus: status,
        });

        return this.getById(canvasId, connectionId);
    }

    updateDecideStatus(
        canvasId: string,
        connectionId: string,
        status: DecideStatus,
        reason: string | null,
    ): Connection | undefined {
        return this.update(canvasId, connectionId, { decideStatus: status, decideReason: reason });
    }

    deleteByPodId(canvasId: string, podId: string): number {
        const result = this.stmts.deleteByPodId.run({ $canvasId: canvasId, $podId: podId });
        return result.changes;
    }

    clearDecideStatusByPodId(canvasId: string, podId: string): void {
        this.stmts.clearDecideStatusByPodId.run({ $canvasId: canvasId, $podId: podId });
    }

    findByTriggerMode(canvasId: string, sourcePodId: string, triggerMode: TriggerMode): Connection[] {
        const rows = this.stmts.selectByTriggerMode.all({
            $canvasId: canvasId,
            $sourcePodId: sourcePodId,
            $triggerMode: triggerMode,
        }) as ConnectionRow[];
        return rows.map(rowToConnection);
    }

}

export const connectionStore = new ConnectionStore();
