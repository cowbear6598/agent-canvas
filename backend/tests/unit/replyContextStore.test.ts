import { replyContextStore, buildReplyContextKey } from '../../src/services/integration/replyContextStore.js';
import type { RunContext } from '../../src/types/run.js';

describe('replyContextStore', () => {
    beforeEach(() => {
        // 清理 store 避免測試間互相干擾
        replyContextStore.delete('test-key-1');
        replyContextStore.delete('test-key-2');
        replyContextStore.delete('pod:pod-1');
        replyContextStore.delete('run-1:pod-1');
        replyContextStore.delete('run-2:pod-2');
    });

    it('set 後 get 應回傳正確的 ReplyContext', () => {
        const context = { senderId: 'U123', messageTs: '1234.5678', threadTs: '1111.2222' };
        replyContextStore.set('test-key-1', context);

        expect(replyContextStore.get('test-key-1')).toEqual(context);
    });

    it('delete 後 get 應回傳 undefined', () => {
        replyContextStore.set('test-key-1', { senderId: 'U123' });
        replyContextStore.delete('test-key-1');

        expect(replyContextStore.get('test-key-1')).toBeUndefined();
    });

    it('不同 key 互不干擾', () => {
        replyContextStore.set('test-key-1', { senderId: 'U111' });
        replyContextStore.set('test-key-2', { senderId: 'U222' });

        expect(replyContextStore.get('test-key-1')?.senderId).toBe('U111');
        expect(replyContextStore.get('test-key-2')?.senderId).toBe('U222');
    });

    it('get 不存在的 key 應回傳 undefined', () => {
        expect(replyContextStore.get('non-existent-key')).toBeUndefined();
    });
});

describe('buildReplyContextKey', () => {
    it('有 runContext 時應回傳 runId:podId 格式', () => {
        const runContext: RunContext = { runId: 'run-1', canvasId: 'canvas-1', sourcePodId: 'pod-0' };
        expect(buildReplyContextKey(runContext, 'pod-1')).toBe('run-1:pod-1');
    });

    it('無 runContext 時應回傳 pod:podId 格式', () => {
        expect(buildReplyContextKey(undefined, 'pod-1')).toBe('pod:pod-1');
    });

    it('不同 runId 應產生不同 key', () => {
        const runContext1: RunContext = { runId: 'run-1', canvasId: 'canvas-1', sourcePodId: 'pod-0' };
        const runContext2: RunContext = { runId: 'run-2', canvasId: 'canvas-1', sourcePodId: 'pod-0' };

        expect(buildReplyContextKey(runContext1, 'pod-1')).not.toBe(buildReplyContextKey(runContext2, 'pod-1'));
    });

    it('不同 podId 應產生不同 key', () => {
        const runContext: RunContext = { runId: 'run-1', canvasId: 'canvas-1', sourcePodId: 'pod-0' };

        expect(buildReplyContextKey(runContext, 'pod-1')).not.toBe(buildReplyContextKey(runContext, 'pod-2'));
    });
});
