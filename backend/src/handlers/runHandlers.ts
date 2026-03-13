import {WebSocketResponseEvents} from '../schemas';
import type {RunDeletePayload, RunLoadHistoryPayload, RunLoadPodMessagesPayload} from '../schemas';
import {runExecutionService} from '../services/workflow/runExecutionService.js';
import {runStore} from '../services/runStore.js';
import {podStore} from '../services/podStore.js';
import {emitSuccess} from '../utils/websocketResponse.js';
import {withCanvasId} from '../utils/handlerHelpers.js';

export const handleRunDelete = withCanvasId<RunDeletePayload>(
    WebSocketResponseEvents.RUN_DELETED,
    async (_connectionId: string, _canvasId: string, payload: RunDeletePayload, _requestId: string): Promise<void> => {
        const {runId} = payload;
        runExecutionService.deleteRun(runId);
    }
);

export const handleRunLoadHistory = withCanvasId<RunLoadHistoryPayload>(
    WebSocketResponseEvents.RUN_HISTORY_LOADED,
    async (connectionId: string, canvasId: string, _payload: RunLoadHistoryPayload, requestId: string): Promise<void> => {
        const runs = runStore.getRunsByCanvasId(canvasId);

        const runsWithInstances = runs.map((run) => {
            const instances = runStore.getPodInstancesByRunId(run.id);
            const sourcePod = podStore.getById(canvasId, run.sourcePodId);
            const sourcePodName = sourcePod?.name ?? run.sourcePodId;

            const podInstances = instances.map((instance) => {
                const pod = podStore.getById(canvasId, instance.podId);
                return {
                    ...instance,
                    podName: pod?.name ?? instance.podId,
                };
            });

            return {...run, podInstances, sourcePodName};
        });

        emitSuccess(connectionId, WebSocketResponseEvents.RUN_HISTORY_LOADED, {
            requestId,
            success: true,
            runs: runsWithInstances,
        });
    }
);

export const handleRunLoadPodMessages = withCanvasId<RunLoadPodMessagesPayload>(
    WebSocketResponseEvents.RUN_POD_MESSAGES_LOADED,
    async (connectionId: string, _canvasId: string, payload: RunLoadPodMessagesPayload, requestId: string): Promise<void> => {
        const {runId, podId} = payload;
        const messages = runStore.getRunMessages(runId, podId);

        emitSuccess(connectionId, WebSocketResponseEvents.RUN_POD_MESSAGES_LOADED, {
            requestId,
            success: true,
            messages,
        });
    }
);
