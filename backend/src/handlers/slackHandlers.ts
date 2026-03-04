import { WebSocketResponseEvents } from '../schemas';
import type {
    SlackAppCreatePayload,
    SlackAppDeletePayload,
    SlackAppGetPayload,
    SlackAppChannelsPayload,
    SlackAppChannelsRefreshPayload,
    PodBindSlackPayload,
    PodUnbindSlackPayload,
} from '../schemas';
import type { SlackApp } from '../types/index.js';
import { slackAppStore } from '../services/slack/slackAppStore.js';
import { slackClientManager } from '../services/slack/slackClientManager.js';
import { podStore } from '../services/podStore.js';
import { socketService } from '../services/socketService.js';
import { emitError, emitNotFound, emitSuccess } from '../utils/websocketResponse.js';
import { logger } from '../utils/logger.js';
import { fireAndForget } from '../utils/operationHelpers.js';
import { emitPodUpdated, handleResultError, getPodDisplayName, validatePod, withCanvasId } from '../utils/handlerHelpers.js';

interface SanitizedSlackApp {
    id: string;
    name: string;
    connectionStatus: SlackApp['connectionStatus'];
    channels: SlackApp['channels'];
    botUserId: string;
}

function sanitizeSlackApp(app: SlackApp): SanitizedSlackApp {
    return {id: app.id, name: app.name, connectionStatus: app.connectionStatus, channels: app.channels, botUserId: app.botUserId};
}

function getSlackAppOrEmitError(connectionId: string, slackAppId: string, responseEvent: WebSocketResponseEvents, requestId: string): SlackApp | null {
    const app = slackAppStore.getById(slackAppId);
    if (!app) {
        emitNotFound(connectionId, responseEvent, 'Slack App', slackAppId, requestId);
        return null;
    }
    return app;
}

export async function handleSlackAppCreate(
    connectionId: string,
    payload: SlackAppCreatePayload,
    requestId: string
): Promise<void> {
    const {name, botToken, signingSecret} = payload;

    const existing = slackAppStore.getByBotToken(botToken);
    if (existing) {
        emitError(connectionId, WebSocketResponseEvents.SLACK_APP_CREATED, '已存在使用相同 Bot Token 的 Slack App', requestId, undefined, 'DUPLICATE_TOKEN');
        return;
    }

    const result = slackAppStore.create(name, botToken, signingSecret);
    if (handleResultError(result, connectionId, WebSocketResponseEvents.SLACK_APP_CREATED, requestId, '建立 Slack App 失敗')) return;

    const app = result.data;

    logger.log('Slack', 'Create', `建立 Slack App「${app.name}」`);

    fireAndForget(
        slackClientManager.initialize(app),
        'Slack',
        `Slack App「${app.name}」初始化失敗`
    );

    socketService.emitToAll(WebSocketResponseEvents.SLACK_APP_CREATED, {
        requestId,
        success: true,
        slackApp: sanitizeSlackApp(app),
    });
}

export async function handleSlackAppDelete(
    connectionId: string,
    payload: SlackAppDeletePayload,
    requestId: string
): Promise<void> {
    const {slackAppId} = payload;

    const app = getSlackAppOrEmitError(connectionId, slackAppId, WebSocketResponseEvents.SLACK_APP_DELETED, requestId);
    if (!app) return;

    slackClientManager.remove(slackAppId);

    const boundPods = podStore.findBySlackApp(slackAppId);
    for (const {canvasId, pod} of boundPods) {
        podStore.setSlackBinding(canvasId, pod.id, null);
        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_SLACK_UNBOUND, {
            canvasId,
            podId: pod.id,
        });
        logger.log('Slack', 'Delete', `清除 Pod「${pod.name}」的 Slack 綁定`);
    }

    slackAppStore.delete(slackAppId);

    logger.log('Slack', 'Delete', `已刪除 Slack App「${app.name}」`);

    socketService.emitToAll(WebSocketResponseEvents.SLACK_APP_DELETED, {
        requestId,
        success: true,
        slackAppId,
    });
}

export async function handleSlackAppList(
    connectionId: string,
    _payload: unknown,
    requestId: string
): Promise<void> {
    const apps = slackAppStore.list();
    emitSuccess(connectionId, WebSocketResponseEvents.SLACK_APP_LIST_RESULT, {
        requestId,
        success: true,
        slackApps: apps.map(sanitizeSlackApp),
    });
}

export async function handleSlackAppGet(
    connectionId: string,
    payload: SlackAppGetPayload,
    requestId: string
): Promise<void> {
    const {slackAppId} = payload;

    const app = getSlackAppOrEmitError(connectionId, slackAppId, WebSocketResponseEvents.SLACK_APP_GET_RESULT, requestId);
    if (!app) return;

    emitSuccess(connectionId, WebSocketResponseEvents.SLACK_APP_GET_RESULT, {
        requestId,
        success: true,
        slackApp: sanitizeSlackApp(app),
    });
}

export async function handleSlackAppChannels(
    connectionId: string,
    payload: SlackAppChannelsPayload,
    requestId: string
): Promise<void> {
    const {slackAppId} = payload;

    const app = getSlackAppOrEmitError(connectionId, slackAppId, WebSocketResponseEvents.SLACK_APP_CHANNELS_RESULT, requestId);
    if (!app) return;

    emitSuccess(connectionId, WebSocketResponseEvents.SLACK_APP_CHANNELS_RESULT, {
        requestId,
        success: true,
        slackAppId,
        channels: app.channels,
    });
}

export async function handleSlackAppChannelsRefresh(
    connectionId: string,
    payload: SlackAppChannelsRefreshPayload,
    requestId: string
): Promise<void> {
    const {slackAppId} = payload;

    const app = getSlackAppOrEmitError(connectionId, slackAppId, WebSocketResponseEvents.SLACK_APP_CHANNELS_REFRESHED, requestId);
    if (!app) return;

    const result = await slackClientManager.refreshChannels(slackAppId);
    if (handleResultError(result, connectionId, WebSocketResponseEvents.SLACK_APP_CHANNELS_REFRESHED, requestId, '重新取得頻道失敗')) return;

    logger.log('Slack', 'Complete', `Slack App「${app.name}」頻道已重新整理`);

    emitSuccess(connectionId, WebSocketResponseEvents.SLACK_APP_CHANNELS_REFRESHED, {
        requestId,
        success: true,
        slackAppId,
        channels: result.data,
    });
}

export const handlePodBindSlack = withCanvasId<PodBindSlackPayload>(
    WebSocketResponseEvents.POD_SLACK_BOUND,
    async (connectionId: string, canvasId: string, payload: PodBindSlackPayload, requestId: string): Promise<void> => {
        const {podId, slackAppId, slackChannelId} = payload;

        const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_SLACK_BOUND, requestId);
        if (!pod) return;

        const app = slackAppStore.getById(slackAppId);
        if (!app) {
            emitNotFound(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, 'Slack App', slackAppId, requestId);
            return;
        }

        if (app.connectionStatus !== 'connected') {
            emitError(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, `Slack App「${app.name}」尚未連線`, requestId, undefined, 'NOT_CONNECTED');
            return;
        }

        const channel = app.channels.find((ch) => ch.id === slackChannelId);
        if (!channel) {
            emitNotFound(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, '頻道', slackChannelId, requestId);
            return;
        }

        podStore.setSlackBinding(canvasId, podId, {slackAppId, slackChannelId});

        logger.log('Slack', 'Create', `Pod「${pod.name}」已綁定 Slack App「${app.name}」頻道「${channel.name}」`);

        emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_SLACK_BOUND);
    }
);

export const handlePodUnbindSlack = withCanvasId<PodUnbindSlackPayload>(
    WebSocketResponseEvents.POD_SLACK_UNBOUND,
    async (connectionId: string, canvasId: string, payload: PodUnbindSlackPayload, requestId: string): Promise<void> => {
        const {podId} = payload;

        const pod = validatePod(connectionId, podId, WebSocketResponseEvents.POD_SLACK_UNBOUND, requestId);
        if (!pod) return;

        if (!pod.slackBinding) {
            emitError(connectionId, WebSocketResponseEvents.POD_SLACK_UNBOUND, `Pod「${getPodDisplayName(canvasId, podId)}」尚未綁定 Slack`, requestId, undefined, 'NOT_BOUND');
            return;
        }

        podStore.setSlackBinding(canvasId, podId, null);

        logger.log('Slack', 'Delete', `Pod「${getPodDisplayName(canvasId, podId)}」已解除 Slack 綁定`);

        emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_SLACK_UNBOUND);
    }
);
