import { connectionStore } from '../../src/services/connectionStore.js';
import { initTestDb, closeDb, resetDb } from '../../src/database/index.js';
import { resetStatements } from '../../src/database/statements.js';
import type { ConnectionStatus } from '../../src/types/connection.js';

const ALL_CONNECTION_STATUSES: ConnectionStatus[] = [
    'idle',
    'active',
    'queued',
    'waiting',
    'ai-deciding',
    'ai-approved',
    'ai-rejected',
    'ai-error',
];

describe('ConnectionStore SQLite 持久化', () => {
    const canvasId = 'test-canvas-sqlite';

    beforeEach(() => {
        resetStatements();
        const db = initTestDb();
        db.exec(`INSERT INTO canvases (id, name, sort_index) VALUES ('${canvasId}', 'test canvas', 0)`);
    });

    afterEach(() => {
        closeDb();
    });

    describe('create', () => {
        it('建立 connection 後可透過 getById 取得', () => {
            const connection = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });

            const loaded = connectionStore.getById(canvasId, connection.id);

            expect(loaded).toBeDefined();
            expect(loaded?.sourcePodId).toBe('pod-a');
            expect(loaded?.targetPodId).toBe('pod-b');
            expect(loaded?.connectionStatus).toBe('idle');
            expect(loaded?.triggerMode).toBe('auto');
            expect(loaded?.decideStatus).toBe('none');
        });

        it('指定 triggerMode 時正確儲存', () => {
            const connection = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'bottom',
                targetPodId: 'pod-b',
                targetAnchor: 'top',
                triggerMode: 'ai-decide',
            });

            const loaded = connectionStore.getById(canvasId, connection.id);
            expect(loaded?.triggerMode).toBe('ai-decide');
        });
    });

    describe('updateConnectionStatus', () => {
        it('狀態更新後立即反映到 DB', () => {
            const connection = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });

            connectionStore.updateConnectionStatus(canvasId, connection.id, 'active');

            const loaded = connectionStore.getById(canvasId, connection.id);
            expect(loaded?.connectionStatus).toBe('active');
        });

        it('connection 不存在時回傳 undefined', () => {
            const result = connectionStore.updateConnectionStatus(canvasId, 'nonexistent-id', 'active');
            expect(result).toBeUndefined();
        });
    });

    describe('所有 ConnectionStatus 值的儲存/讀取一致性', () => {
        it.each(ALL_CONNECTION_STATUSES)('status "%s" 寫入後可正確讀取', (status) => {
            const connection = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });

            connectionStore.updateConnectionStatus(canvasId, connection.id, status);

            const loaded = connectionStore.getById(canvasId, connection.id);
            expect(loaded?.connectionStatus).toBe(status);
        });
    });

    describe('list', () => {
        it('回傳該 canvas 所有 connections', () => {
            connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });
            connectionStore.create(canvasId, {
                sourcePodId: 'pod-b',
                sourceAnchor: 'bottom',
                targetPodId: 'pod-c',
                targetAnchor: 'top',
            });

            const connections = connectionStore.list(canvasId);
            expect(connections).toHaveLength(2);
        });

        it('不存在的 canvas 回傳空陣列', () => {
            const connections = connectionStore.list('nonexistent-canvas');
            expect(connections).toHaveLength(0);
        });
    });

    describe('delete', () => {
        it('刪除存在的 connection 回傳 true', () => {
            const connection = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });

            const deleted = connectionStore.delete(canvasId, connection.id);
            expect(deleted).toBe(true);
            expect(connectionStore.getById(canvasId, connection.id)).toBeUndefined();
        });

        it('刪除不存在的 connection 回傳 false', () => {
            const deleted = connectionStore.delete(canvasId, 'nonexistent-id');
            expect(deleted).toBe(false);
        });
    });

    describe('update', () => {
        it('更新 triggerMode 從 ai-decide 到 auto 時重置 decide 狀態', () => {
            const connection = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
                triggerMode: 'ai-decide',
            });

            connectionStore.update(canvasId, connection.id, {
                decideStatus: 'approved',
                decideReason: '通過審核',
            });

            connectionStore.update(canvasId, connection.id, { triggerMode: 'auto' });

            const loaded = connectionStore.getById(canvasId, connection.id);
            expect(loaded?.triggerMode).toBe('auto');
            expect(loaded?.decideStatus).toBe('none');
            expect(loaded?.decideReason).toBeNull();
            expect(loaded?.connectionStatus).toBe('idle');
        });

        it('更新 connection 不存在時回傳 undefined', () => {
            const result = connectionStore.update(canvasId, 'nonexistent-id', { triggerMode: 'auto' });
            expect(result).toBeUndefined();
        });
    });

    describe('findByPodId / findBySourcePodId / findByTargetPodId', () => {
        it('根據 podId 查詢包含 source 和 target 的 connections', () => {
            const conn1 = connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });
            const conn2 = connectionStore.create(canvasId, {
                sourcePodId: 'pod-c',
                sourceAnchor: 'bottom',
                targetPodId: 'pod-a',
                targetAnchor: 'top',
            });

            const connections = connectionStore.findByPodId(canvasId, 'pod-a');
            const ids = connections.map((c) => c.id);
            expect(ids).toContain(conn1.id);
            expect(ids).toContain(conn2.id);
        });

        it('findBySourcePodId 只回傳 source 相符的 connections', () => {
            connectionStore.create(canvasId, {
                sourcePodId: 'pod-a',
                sourceAnchor: 'right',
                targetPodId: 'pod-b',
                targetAnchor: 'left',
            });
            connectionStore.create(canvasId, {
                sourcePodId: 'pod-c',
                sourceAnchor: 'bottom',
                targetPodId: 'pod-a',
                targetAnchor: 'top',
            });

            const connections = connectionStore.findBySourcePodId(canvasId, 'pod-a');
            expect(connections).toHaveLength(1);
            expect(connections[0].sourcePodId).toBe('pod-a');
        });
    });

});
