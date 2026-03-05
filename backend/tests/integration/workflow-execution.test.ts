import {
    createTestServer,
    closeTestServer,
    createSocketClient,
    waitForEvent,
    disconnectSocket,
    type TestServerInstance, TestWebSocketClient,
} from '../setup';
import {createPod, getCanvasId} from '../helpers';
import {createConnection} from '../helpers';
import {seedPodMessages} from '../helpers';
import { v4 as uuidv4 } from 'uuid';
import {WebSocketResponseEvents} from '../../src/schemas';
import type {
    WorkflowAutoTriggeredPayload,
    WorkflowPendingPayload,
    WorkflowSourcesMergedPayload,
    PodChatCompletePayload,
} from '../../src/types';
import {workflowAutoTriggerService} from '../../src/services/workflow';

async function* mockQuery(): AsyncGenerator<any> {
    yield {
        type: 'system',
        subtype: 'init',
        session_id: `test-session-${Date.now()}`,
    };

    await new Promise((resolve) => setTimeout(resolve, 50));

    yield {
        type: 'assistant',
        message: {
            content: [{text: 'Test workflow response'}],
        },
    };

    await new Promise((resolve) => setTimeout(resolve, 100));

    yield {
        type: 'result',
        subtype: 'success',
        result: 'Test workflow response',
    };
}

// ESM 模組的 namespace 是 readonly，無法用 vi.spyOn 修改，因此使用 vi.mock()
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...original,
    query: vi.fn((..._args: any[]) => mockQuery()),
  };
});

import * as claudeSDK from '@anthropic-ai/claude-agent-sdk';

describe('WorkflowExecution 服務', () => {
    let server: TestServerInstance;
    let client: TestWebSocketClient;

    beforeAll(async () => {
        server = await createTestServer();
    });

    afterAll(async () => {
        if (server) await closeTestServer(server);
    });

    beforeEach(async () => {
        (claudeSDK.query as any).mockClear();

        client = await createSocketClient(server.baseUrl, server.canvasId);
    });

    afterEach(async () => {
        if (client?.connected) await disconnectSocket(client);

        vi.restoreAllMocks();
    });

    describe('測試 checkAndTriggerWorkflows 的 auto-trigger 邏輯', () => {
        it('自動觸發成功啟動目標 Pod', async () => {
            const canvasId = await getCanvasId(client);

            const sourcePod = await createPod(client, {name: 'Source Pod', x: 0, y: 0});
            const targetPod = await createPod(client, {name: 'Target Pod', x: 300, y: 0});
            const connection = await createConnection(client, sourcePod.id, targetPod.id, {
                triggerMode: 'auto',
            });

            expect(connection.triggerMode).toBe('auto');

            const autoTriggeredPromise = waitForEvent<WorkflowAutoTriggeredPayload>(
                client,
                WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
                10000
            );

            const workflowCompletePromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Workflow complete timeout'));
                }, 10000);

                const handler = (event: any) => {
                    if (event.targetPodId === targetPod.id && event.success) {
                        clearTimeout(timeout);
                        client.off(WebSocketResponseEvents.WORKFLOW_COMPLETE, handler);
                        resolve(event);
                    }
                };
                client.on(WebSocketResponseEvents.WORKFLOW_COMPLETE, handler);
            });

            await seedPodMessages(client, sourcePod.id, [
                {role: 'user', content: 'Test message to trigger workflow'},
            ]);

            const autoTriggeredEvent = await autoTriggeredPromise;
            expect(autoTriggeredEvent.sourcePodId).toBe(sourcePod.id);
            expect(autoTriggeredEvent.targetPodId).toBe(targetPod.id);
            expect(autoTriggeredEvent.connectionId).toBe(connection.id);
            expect(autoTriggeredEvent.transferredContent).toBeDefined();

            await workflowCompletePromise;

            const {podStore} = await import('../../src/services/podStore.js');
            const targetPodAfter = podStore.getById(canvasId, targetPod.id);
            expect(targetPodAfter?.status).toBe('idle');
        });

        it('目標 Pod 忙碌時跳過自動觸發', async () => {
            const canvasId = await getCanvasId(client);

            // 準備：建立 sourcePod、targetPod
            const id = uuidv4();
            const sourcePod = await createPod(client, {name: `source-pod-${id}`, x: 0, y: 0});
            const targetPod = await createPod(client, {name: `target-pod-${id}`, x: 300, y: 0});

            await createConnection(client, sourcePod.id, targetPod.id, {
                triggerMode: 'auto',
            });

            const {podStore} = await import('../../src/services/podStore.js');
            podStore.setStatus(canvasId, targetPod.id, 'chatting');

            await seedPodMessages(client, sourcePod.id, [
                {role: 'user', content: 'Test message while target is busy'},
            ]);

            await new Promise((resolve) => setTimeout(resolve, 500));

            const targetPodAfter = podStore.getById(canvasId, targetPod.id);
            expect(targetPodAfter?.status).toBe('chatting');

            // 避免 scheduleQueueRetry 污染後續測試
            const {workflowQueueService} = await import('../../src/services/workflow/index.js');
            while (workflowQueueService.getQueueSize(targetPod.id) > 0) workflowQueueService.dequeue(targetPod.id);
            podStore.setStatus(canvasId, targetPod.id, 'idle');
        });
    });

    describe('測試 multi-input 情境（多個 source 連接到同一 target）', () => {
        it('等待所有 source 完成後觸發', async () => {
            await getCanvasId(client);

            const id = uuidv4();
            const sourceA = await createPod(client, {name: `source-a-${id}`, x: 0, y: 0});
            const sourceB = await createPod(client, {name: `source-b-${id}`, x: 0, y: 200});
            const targetPod = await createPod(client, {name: `target-pod-${id}`, x: 400, y: 100});

            await createConnection(client, sourceA.id, targetPod.id, {
                triggerMode: 'auto',
            });

            await createConnection(client, sourceB.id, targetPod.id, {
                triggerMode: 'auto',
            });

            const pendingPromise = waitForEvent<WorkflowPendingPayload>(
                client,
                WebSocketResponseEvents.WORKFLOW_PENDING,
                10000
            );

            await seedPodMessages(client, sourceA.id, [
                {role: 'user', content: 'Message from source A'},
            ]);

            const pendingEvent = await pendingPromise;
            expect(pendingEvent.targetPodId).toBe(targetPod.id);
            expect(pendingEvent.completedSourcePodIds).toContain(sourceA.id);
            expect(pendingEvent.pendingSourcePodIds).toContain(sourceB.id);
            expect(pendingEvent.completedCount).toBe(1);
            expect(pendingEvent.totalSources).toBe(2);

            // 監聽 sources merged 和 auto-triggered 事件
            const mergedPromise = waitForEvent<WorkflowSourcesMergedPayload>(
                client,
                WebSocketResponseEvents.WORKFLOW_SOURCES_MERGED,
                10000
            );
            const autoTriggeredPromise = waitForEvent<WorkflowAutoTriggeredPayload>(
                client,
                WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
                10000
            );

            await seedPodMessages(client, sourceB.id, [
                {role: 'user', content: 'Message from source B'},
            ]);

            const mergedEvent = await mergedPromise;
            expect(mergedEvent.targetPodId).toBe(targetPod.id);
            expect(mergedEvent.sourcePodIds).toContain(sourceA.id);
            expect(mergedEvent.sourcePodIds).toContain(sourceB.id);
            expect(mergedEvent.mergedContentPreview).toBeDefined();

            const autoTriggeredEvent = await autoTriggeredPromise;
            expect(autoTriggeredEvent.targetPodId).toBe(targetPod.id);
            expect(autoTriggeredEvent.isSummarized).toBe(true);
        });

        it('未完成時不會提前觸發', async () => {
            const canvasId = await getCanvasId(client);

            const id = uuidv4();
            const sourceA = await createPod(client, {name: `source-a-${id}`, x: 0, y: 0});
            const sourceB = await createPod(client, {name: `source-b-${id}`, x: 0, y: 200});
            const targetPod = await createPod(client, {name: `target-pod-${id}`, x: 400, y: 100});

            await createConnection(client, sourceA.id, targetPod.id, {
                triggerMode: 'auto',
            });
            await createConnection(client, sourceB.id, targetPod.id, {
                triggerMode: 'auto',
            });

            let autoTriggered = false;
            client.on(WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED, () => {
                autoTriggered = true;
            });

            await seedPodMessages(client, sourceA.id, [
                {role: 'user', content: 'Only source A completes'},
            ]);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // sourceB 尚未完成，不應觸發 auto-triggered
            expect(autoTriggered).toBe(false);

            const {podStore} = await import('../../src/services/podStore.js');
            const targetPodAfter = podStore.getById(canvasId, targetPod.id);
            expect(targetPodAfter?.status).toBe('idle');
        });
    });

    describe('測試 workflow 鏈式觸發（A -> B -> C）', () => {
        it('鏈式觸發依序執行', async () => {
            const canvasId = await getCanvasId(client);

            // 準備：建立三個 Pod 的鏈式連接
            const podA = await createPod(client, {name: 'Pod A', x: 0, y: 0});
            const podB = await createPod(client, {name: 'Pod B', x: 300, y: 0});
            const podC = await createPod(client, {name: 'Pod C', x: 600, y: 0});

            const connAB = await createConnection(client, podA.id, podB.id, {
                triggerMode: 'auto',
            });
            const connBC = await createConnection(client, podB.id, podC.id, {
                triggerMode: 'auto',
            });

            const autoTriggeredEvents: WorkflowAutoTriggeredPayload[] = [];
            client.on(WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED, (event) => {
                autoTriggeredEvents.push(event);
            });

            const podCCompletePromise = new Promise<PodChatCompletePayload>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Pod C complete timeout'));
                }, 15000);

                const completedPods = new Set<string>();
                const handler = (event: PodChatCompletePayload) => {
                    completedPods.add(event.podId);
                    if (completedPods.has(podA.id) && completedPods.has(podB.id) && completedPods.has(podC.id)) {
                        clearTimeout(timeout);
                        client.off(WebSocketResponseEvents.POD_CHAT_COMPLETE, handler);
                        resolve(event);
                    }
                };
                client.on(WebSocketResponseEvents.POD_CHAT_COMPLETE, handler);
            });

            await seedPodMessages(client, podA.id, [
                {role: 'user', content: 'Start the workflow chain'},
            ]);

            const podCComplete = await podCCompletePromise;
            expect(podCComplete).toBeDefined();

            await new Promise((resolve) => setTimeout(resolve, 500));

            expect(autoTriggeredEvents.length).toBeGreaterThanOrEqual(2);

            const triggerToB = autoTriggeredEvents.find(
                (e) => e.sourcePodId === podA.id && e.targetPodId === podB.id
            );
            const triggerToC = autoTriggeredEvents.find(
                (e) => e.sourcePodId === podB.id && e.targetPodId === podC.id
            );

            expect(triggerToB).toBeDefined();
            expect(triggerToC).toBeDefined();
            expect(triggerToB?.connectionId).toBe(connAB.id);
            expect(triggerToC?.connectionId).toBe(connBC.id);

            const {podStore} = await import('../../src/services/podStore.js');
            expect(podStore.getById(canvasId, podA.id)?.status).toBe('idle');
            expect(podStore.getById(canvasId, podB.id)?.status).toBe('idle');
            expect(podStore.getById(canvasId, podC.id)?.status).toBe('idle');
        }, 20000);

        it('多分支鏈式觸發成功執行', async () => {
            await getCanvasId(client);

            const id = uuidv4();
            const podA = await createPod(client, {name: `pod-a-${id}`, x: 0, y: 0});
            const podB = await createPod(client, {name: `pod-b-${id}`, x: 300, y: -100});
            const podC = await createPod(client, {name: `pod-c-${id}`, x: 300, y: 100});
            const podD = await createPod(client, {name: `pod-d-${id}`, x: 600, y: -100});

            await createConnection(client, podA.id, podB.id, {triggerMode: 'auto'});
            await createConnection(client, podA.id, podC.id, {triggerMode: 'auto'});
            await createConnection(client, podB.id, podD.id, {triggerMode: 'auto'});

            const autoTriggeredEvents: WorkflowAutoTriggeredPayload[] = [];
            client.on(WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED, (event) => {
                autoTriggeredEvents.push(event);
            });

            const completedPods = new Set<string>();
            client.on(WebSocketResponseEvents.POD_CHAT_COMPLETE, (event) => {
                completedPods.add(event.podId);
            });

            await seedPodMessages(client, podA.id, [
                {role: 'user', content: 'Start branching workflow'},
            ]);

            const startTime = Date.now();
            while (completedPods.size < 4 && Date.now() - startTime < 15000) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            expect(completedPods.has(podA.id)).toBe(true);
            expect(completedPods.has(podB.id)).toBe(true);
            expect(completedPods.has(podC.id)).toBe(true);
            expect(completedPods.has(podD.id)).toBe(true);

            expect(autoTriggeredEvents.length).toBeGreaterThanOrEqual(3);
            expect(autoTriggeredEvents.some((e) => e.sourcePodId === podA.id && e.targetPodId === podB.id)).toBe(true);
            expect(autoTriggeredEvents.some((e) => e.sourcePodId === podA.id && e.targetPodId === podC.id)).toBe(true);
            expect(autoTriggeredEvents.some((e) => e.sourcePodId === podB.id && e.targetPodId === podD.id)).toBe(true);
        });
    });

    describe('測試 triggerWorkflowWithSummary 的 pre-generated summary 處理', () => {
        it('使用預生成摘要成功觸發', async () => {
            const canvasId = await getCanvasId(client);

            const id = uuidv4();
            const sourcePod = await createPod(client, {name: `source-pod-${id}`, x: 0, y: 0});
            const targetPod = await createPod(client, {name: `target-pod-${id}`, x: 300, y: 0});

            // 先 seed 訊息再建立 connection，避免 seedPodMessages 觸發 auto workflow 干擾後續斷言
            await seedPodMessages(client, sourcePod.id, [
                {role: 'user', content: 'Initial message for summary test'},
            ]);

            const connection = await createConnection(client, sourcePod.id, targetPod.id, {
                triggerMode: 'auto',
            });

            const preGeneratedSummary = 'This is a pre-generated summary for testing purposes.';

            const autoTriggeredPromise = waitForEvent<WorkflowAutoTriggeredPayload>(
                client,
                WebSocketResponseEvents.WORKFLOW_AUTO_TRIGGERED,
                10000
            );

            const targetCompletePromise = new Promise<PodChatCompletePayload>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Target complete timeout'));
                }, 10000);

                const handler = (event: PodChatCompletePayload) => {
                    if (event.podId === targetPod.id) {
                        clearTimeout(timeout);
                        client.off(WebSocketResponseEvents.POD_CHAT_COMPLETE, handler);
                        resolve(event);
                    }
                };
                client.on(WebSocketResponseEvents.POD_CHAT_COMPLETE, handler);
            });

            const {workflowExecutionService} = await import('../../src/services/workflow/workflowExecutionService.js');
            await workflowExecutionService.triggerWorkflowWithSummary({
                canvasId,
                connectionId: connection.id,
                summary: preGeneratedSummary,
                isSummarized: true,
                participatingConnectionIds: undefined,
                strategy: workflowAutoTriggerService,
            });

            const autoTriggeredEvent = await autoTriggeredPromise;
            expect(autoTriggeredEvent.sourcePodId).toBe(sourcePod.id);
            expect(autoTriggeredEvent.targetPodId).toBe(targetPod.id);
            expect(autoTriggeredEvent.transferredContent).toBe(preGeneratedSummary);
            expect(autoTriggeredEvent.isSummarized).toBe(true);

            await targetCompletePromise;

            const {messageStore} = await import('../../src/services/messageStore.js');
            const targetMessages = messageStore.getMessages(targetPod.id);
            const userMessage = targetMessages.find((m) => m.role === 'user');
            expect(userMessage).toBeDefined();
            expect(userMessage?.content).toContain(preGeneratedSummary);
        });

        it('多個 source 使用預生成摘要成功觸發', async () => {
            const canvasId = await getCanvasId(client);

            const id = uuidv4();
            const sourceA = await createPod(client, {name: `source-a-${id}`, x: 0, y: 0});
            const sourceB = await createPod(client, {name: `source-b-${id}`, x: 0, y: 200});
            const targetPod = await createPod(client, {name: `target-pod-${id}`, x: 400, y: 100});

            await seedPodMessages(client, sourceA.id, [
                {role: 'user', content: 'Message from A'},
            ]);
            await seedPodMessages(client, sourceB.id, [
                {role: 'user', content: 'Message from B'},
            ]);

            // 先 seed 訊息再建立 connection，避免 seedPodMessages 觸發 auto workflow 干擾後續斷言
            const connA = await createConnection(client, sourceA.id, targetPod.id, {
                triggerMode: 'auto',
            });

            const mergedSummary = `## Source: Source A
Content from Source A

---

## Source: Source B
Content from Source B`;

            const targetCompletePromise = new Promise<PodChatCompletePayload>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Target complete timeout'));
                }, 10000);

                const handler = (event: PodChatCompletePayload) => {
                    if (event.podId === targetPod.id) {
                        clearTimeout(timeout);
                        client.off(WebSocketResponseEvents.POD_CHAT_COMPLETE, handler);
                        resolve(event);
                    }
                };
                client.on(WebSocketResponseEvents.POD_CHAT_COMPLETE, handler);
            });

            const {workflowExecutionService} = await import('../../src/services/workflow/workflowExecutionService.js');
            await workflowExecutionService.triggerWorkflowWithSummary({
                canvasId,
                connectionId: connA.id,
                summary: mergedSummary,
                isSummarized: true,
                participatingConnectionIds: undefined,
                strategy: workflowAutoTriggerService,
            });

            await targetCompletePromise;

            const {messageStore} = await import('../../src/services/messageStore.js');
            const targetMessages = messageStore.getMessages(targetPod.id);
            const userMessages = targetMessages.filter((m) => m.role === 'user');
            expect(userMessages.length).toBeGreaterThanOrEqual(1);

            const lastUserMessage = userMessages[userMessages.length - 1];
            expect(lastUserMessage).toBeDefined();
            expect(lastUserMessage.content).toContain('---');
        });
    });
});
