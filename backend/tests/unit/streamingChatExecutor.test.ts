import type { Mock } from 'vitest';

vi.mock('../../src/services/claude/claudeService.js', () => ({
    claudeService: {
        sendMessage: vi.fn(() => Promise.resolve({})),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToCanvas: vi.fn(() => {}),
    },
}));

vi.mock('../../src/services/messageStore.js', () => ({
    messageStore: {
        upsertMessage: vi.fn(() => {}),
    },
}));

vi.mock('../../src/services/podStore.js', () => ({
    podStore: {
        setStatus: vi.fn(() => {}),
        getById: vi.fn(() => undefined),
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        log: vi.fn(() => {}),
        warn: vi.fn(() => {}),
        error: vi.fn(() => {}),
    },
}));

import {executeStreamingChat} from '../../src/services/claude/streamingChatExecutor.js';
import {claudeService} from '../../src/services/claude/claudeService.js';
import {socketService} from '../../src/services/socketService.js';
import {messageStore} from '../../src/services/messageStore.js';
import {podStore} from '../../src/services/podStore.js';
import {logger} from '../../src/utils/logger.js';
import {WebSocketResponseEvents} from '../../src/schemas';
import {AbortError} from '@anthropic-ai/claude-agent-sdk';

/** 取得 mock 函式的型別化引用，避免重複的 `as Mock<any>` 轉型 */
function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

describe('executeStreamingChat', () => {
    const canvasId = 'test-canvas';
    const podId = 'test-pod';
    const message = 'test message';

    // Helper: 設定 sendMessage mock 來產生特定事件序列
    function mockSendMessageWithEvents(events: Array<{type: string; [key: string]: unknown}>) {
        asMock(claudeService.sendMessage).mockImplementation(
            async (...args: any[]) => {
                const callback = args[2] as (event: any) => void;
                for (const event of events) {
                    callback(event);
                }
                return {};
            }
        );
    }

    // Helper: 設定 sendMessage mock 拋出 AbortError
    function mockSendMessageWithAbort(eventsBeforeAbort: Array<{type: string; [key: string]: unknown}> = []) {
        asMock(claudeService.sendMessage).mockImplementation(
            async (...args: any[]) => {
                const callback = args[2] as (event: any) => void;
                for (const event of eventsBeforeAbort) {
                    callback(event);
                }
                const error = new Error('查詢已被中斷');
                error.name = 'AbortError';
                throw error;
            }
        );
    }

    // Helper: 設定 sendMessage mock 拋出一般錯誤
    function mockSendMessageWithError(error: Error) {
        asMock(claudeService.sendMessage).mockImplementation(
            async () => {
                throw error;
            }
        );
    }

    beforeEach(() => {
        // 重置所有 mock
        asMock(claudeService.sendMessage).mockClear();
        asMock(socketService.emitToCanvas).mockClear();
        asMock(messageStore.upsertMessage).mockClear();
        asMock(podStore.setStatus).mockClear();
        asMock(logger.log).mockClear();
        asMock(logger.error).mockClear();

        asMock(claudeService.sendMessage).mockImplementation(() => Promise.resolve({}));
    });

    describe('streaming event 處理', () => {
        it('text event 正確累積內容並廣播 POD_CLAUDE_CHAT_MESSAGE', async () => {
            mockSendMessageWithEvents([
                {type: 'text', content: 'Hello'},
                {type: 'text', content: ' World'},
                {type: 'complete'},
            ]);

            const result = await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(socketService.emitToCanvas).toHaveBeenCalledTimes(3); // 2 text + 1 complete

            expect(socketService.emitToCanvas).toHaveBeenNthCalledWith(
                1,
                canvasId,
                WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
                expect.objectContaining({
                    canvasId,
                    podId,
                    messageId: expect.any(String),
                    content: 'Hello',
                    isPartial: true,
                    role: 'assistant',
                })
            );

            expect(socketService.emitToCanvas).toHaveBeenNthCalledWith(
                2,
                canvasId,
                WebSocketResponseEvents.POD_CLAUDE_CHAT_MESSAGE,
                expect.objectContaining({
                    canvasId,
                    podId,
                    messageId: expect.any(String),
                    content: 'Hello World',
                    isPartial: true,
                    role: 'assistant',
                })
            );

            expect(result.content).toBe('Hello World');
            expect(result.hasContent).toBe(true);
            expect(result.aborted).toBe(false);
        });

        it('tool_use event 正確處理並廣播 POD_CHAT_TOOL_USE', async () => {
            mockSendMessageWithEvents([
                {type: 'tool_use', toolUseId: 'tu1', toolName: 'Read', input: {path: '/test'}},
                {type: 'complete'},
            ]);

            await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(socketService.emitToCanvas).toHaveBeenCalledWith(
                canvasId,
                WebSocketResponseEvents.POD_CHAT_TOOL_USE,
                expect.objectContaining({
                    canvasId,
                    podId,
                    messageId: expect.any(String),
                    toolUseId: 'tu1',
                    toolName: 'Read',
                    input: {path: '/test'},
                })
            );
        });

        it('tool_result event 正確處理並廣播 POD_CHAT_TOOL_RESULT', async () => {
            mockSendMessageWithEvents([
                {type: 'tool_use', toolUseId: 'tu1', toolName: 'Read', input: {path: '/test'}},
                {type: 'tool_result', toolUseId: 'tu1', toolName: 'Read', output: 'file content'},
                {type: 'complete'},
            ]);

            await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(socketService.emitToCanvas).toHaveBeenCalledWith(
                canvasId,
                WebSocketResponseEvents.POD_CHAT_TOOL_RESULT,
                expect.objectContaining({
                    canvasId,
                    podId,
                    messageId: expect.any(String),
                    toolUseId: 'tu1',
                    toolName: 'Read',
                    output: 'file content',
                })
            );
        });

        it('complete event 觸發 flush 並廣播 POD_CHAT_COMPLETE', async () => {
            mockSendMessageWithEvents([
                {type: 'text', content: 'Hello'},
                {type: 'complete'},
            ]);

            await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(socketService.emitToCanvas).toHaveBeenCalledWith(
                canvasId,
                WebSocketResponseEvents.POD_CHAT_COMPLETE,
                expect.objectContaining({
                    canvasId,
                    podId,
                    messageId: expect.any(String),
                    fullContent: 'Hello',
                })
            );
        });

        it('每個 streaming event 都呼叫 persistStreamingMessage（upsert）', async () => {
            mockSendMessageWithEvents([
                {type: 'text', content: 'Hello'},
                {type: 'tool_use', toolUseId: 'tu1', toolName: 'Read', input: {path: '/test'}},
                {type: 'tool_result', toolUseId: 'tu1', toolName: 'Read', output: 'file content'},
                {type: 'complete'},
            ]);

            await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            // streaming 中 3 次（text, tool_use, tool_result）+ 完成後最終 persist 1 次
            expect(messageStore.upsertMessage).toHaveBeenCalledTimes(4);
        });

        it('error event 記錄 logger 但不中斷', async () => {
            mockSendMessageWithEvents([
                {type: 'error', error: '測試錯誤'},
                {type: 'text', content: 'Hello'},
                {type: 'complete'},
            ]);

            const result = await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(logger.error).toHaveBeenCalledWith(
                'Chat',
                'Error',
                'Pod test-pod streaming 過程發生錯誤'
            );

            expect(result.hasContent).toBe(true);
            expect(result.content).toBe('Hello');
        });
    });

    describe('成功完成', () => {
        it('完成後正確呼叫 upsertMessage + setStatus idle', async () => {
            mockSendMessageWithEvents([
                {type: 'text', content: 'Hello'},
                {type: 'complete'},
            ]);

            await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(messageStore.upsertMessage).toHaveBeenCalled();
            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'idle');
        });

        it('完成後正確呼叫 onComplete callback', async () => {
            mockSendMessageWithEvents([
                {type: 'text', content: 'Hello'},
                {type: 'complete'},
            ]);

            const onComplete = vi.fn(() => {});

            await executeStreamingChat(
                {
                    canvasId,
                    podId,
                    message,
                    abortable: false,
                },
                {
                    onComplete,
                }
            );

            expect(onComplete).toHaveBeenCalledWith(canvasId, podId);
        });

        it('無 assistant content 時不呼叫 upsertMessage', async () => {
            mockSendMessageWithEvents([
                {type: 'complete'},
            ]);

            await executeStreamingChat({
                canvasId,
                podId,
                message,
                abortable: false,
            });

            expect(messageStore.upsertMessage).not.toHaveBeenCalled();
            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'idle');
        });
    });

    describe('AbortError 處理', () => {
        it('AbortError + abortable=true 時正確處理', async () => {
            mockSendMessageWithAbort([
                {type: 'text', content: 'Hello'},
            ]);

            const onAborted = vi.fn(() => {});

            const result = await executeStreamingChat(
                {
                    canvasId,
                    podId,
                    message,
                    abortable: true,
                },
                {
                    onAborted,
                }
            );

            expect(result.aborted).toBe(true);
            expect(result.content).toBe('Hello');
            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'idle');
            expect(messageStore.upsertMessage).toHaveBeenCalled();
            expect(onAborted).toHaveBeenCalledWith(canvasId, podId, expect.any(String));
        });

        it('AbortError + abortable=false 時 re-throw', async () => {
            mockSendMessageWithAbort();

            const onAborted = vi.fn(() => {});

            await expect(
                executeStreamingChat(
                    {
                        canvasId,
                        podId,
                        message,
                        abortable: false,
                    },
                    {
                        onAborted,
                    }
                )
            ).rejects.toThrow('查詢已被中斷');

            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'idle');
            expect(onAborted).not.toHaveBeenCalled();
        });

        it('SDK AbortError 實例也正確處理', async () => {
            asMock(claudeService.sendMessage).mockImplementation(
                async (...args: any[]) => {
                    const callback = args[2] as (event: any) => void;
                    callback({type: 'text', content: 'Hello'});
                    throw new AbortError('SDK abort');
                }
            );

            const onAborted = vi.fn(() => {});

            const result = await executeStreamingChat(
                {
                    canvasId,
                    podId,
                    message,
                    abortable: true,
                },
                {
                    onAborted,
                }
            );

            expect(result.aborted).toBe(true);
            expect(onAborted).toHaveBeenCalled();
        });
    });

    describe('一般錯誤處理', () => {
        it('一般錯誤時呼叫 onError callback 並 re-throw', async () => {
            const testError = new Error('Claude API 錯誤');
            mockSendMessageWithError(testError);

            const onError = vi.fn(() => {});

            await expect(
                executeStreamingChat(
                    {
                        canvasId,
                        podId,
                        message,
                        abortable: false,
                    },
                    {
                        onError,
                    }
                )
            ).rejects.toThrow('Claude API 錯誤');

            expect(podStore.setStatus).toHaveBeenCalledWith(canvasId, podId, 'idle');
            expect(onError).toHaveBeenCalledWith(
                canvasId,
                podId,
                expect.objectContaining({message: 'Claude API 錯誤'})
            );
        });
    });
});
