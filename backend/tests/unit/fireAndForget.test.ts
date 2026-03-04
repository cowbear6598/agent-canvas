import { fireAndForget, createPostChatCompleteCallback } from '../../src/utils/operationHelpers.js';
import { logger } from '../../src/utils/logger.js';

describe('fireAndForget', () => {
    beforeEach(() => {
        vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    it('Promise resolve 時不應呼叫 logger.error', async () => {
        fireAndForget(Promise.resolve(), 'Chat', '成功情境測試');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(logger.error).not.toHaveBeenCalled();
    });

    it('Promise reject 時應呼叫 logger.error 並帶正確的 category 和 context', async () => {
        const error = new Error('發生錯誤');
        fireAndForget(Promise.reject(error), 'Chat', '失敗情境測試');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(logger.error).toHaveBeenCalledWith('Chat', 'Error', '失敗情境測試', error);
    });
});

describe('createPostChatCompleteCallback', () => {
    beforeEach(() => {
        vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    it('呼叫後應分別呼叫 autoClearOnPodComplete 和 checkAndTriggerWorkflows', async () => {
        const autoClearOnPodComplete = vi.fn().mockResolvedValue(undefined);
        const checkAndTriggerWorkflows = vi.fn().mockResolvedValue(undefined);

        const callback = createPostChatCompleteCallback(autoClearOnPodComplete, checkAndTriggerWorkflows, 'Chat');
        await callback('canvas-1', 'pod-1');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(autoClearOnPodComplete).toHaveBeenCalledWith('canvas-1', 'pod-1');
        expect(checkAndTriggerWorkflows).toHaveBeenCalledWith('canvas-1', 'pod-1');
    });

    it('autoClearOnPodComplete 拋出錯誤時不應拋出（fire-and-forget 模式）', async () => {
        const autoClearOnPodComplete = vi.fn().mockRejectedValue(new Error('自動清除失敗'));
        const checkAndTriggerWorkflows = vi.fn().mockResolvedValue(undefined);

        const callback = createPostChatCompleteCallback(autoClearOnPodComplete, checkAndTriggerWorkflows, 'Chat');

        await expect(callback('canvas-1', 'pod-1')).resolves.toBeUndefined();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(logger.error).toHaveBeenCalled();
    });

    it('checkAndTriggerWorkflows 拋出錯誤時不應拋出（fire-and-forget 模式）', async () => {
        const autoClearOnPodComplete = vi.fn().mockResolvedValue(undefined);
        const checkAndTriggerWorkflows = vi.fn().mockRejectedValue(new Error('觸發 Workflow 失敗'));

        const callback = createPostChatCompleteCallback(autoClearOnPodComplete, checkAndTriggerWorkflows, 'Chat');

        await expect(callback('canvas-1', 'pod-1')).resolves.toBeUndefined();

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(logger.error).toHaveBeenCalled();
    });
});
