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
import { slackConnectionManager } from '../services/slack/slackConnectionManager.js';
import { slackMessageQueue } from '../services/slack/slackMessageQueue.js';
import { podStore } from '../services/podStore.js';
import { socketService } from '../services/socketService.js';
import { emitError } from '../utils/websocketResponse.js';
import { logger } from '../utils/logger.js';
import { fireAndForget } from '../utils/operationHelpers.js';
import { emitPodUpdated } from '../utils/handlerHelpers.js';

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
        emitError(connectionId, responseEvent, `找不到 Slack App：${slackAppId}`, requestId, undefined, 'NOT_FOUND');
        return null;
    }
    return app;
}

export async function handleSlackAppCreate(
    connectionId: string,
    payload: SlackAppCreatePayload,
    requestId: string
): Promise<void> {
    const {name, botToken, appToken} = payload;

    const existing = slackAppStore.getByBotToken(botToken);
    if (existing) {
        emitError(connectionId, WebSocketResponseEvents.SLACK_APP_CREATED, '已存在使用相同 Bot Token 的 Slack App', requestId, undefined, 'DUPLICATE_TOKEN');
        return;
    }

    const result = slackAppStore.create(name, botToken, appToken);
    if (!result.success) {
        emitError(connectionId, WebSocketResponseEvents.SLACK_APP_CREATED, result.error, requestId, undefined, 'INTERNAL_ERROR');
        return;
    }

    const app = result.data;

    logger.log('Slack', 'Create', `建立 Slack App「${app.name}」`);

    fireAndForget(
        slackConnectionManager.connect(app),
        'Slack',
        `Slack App「${app.name}」連線失敗`
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

    await slackConnectionManager.disconnect(slackAppId);

    const boundPods = podStore.findBySlackApp(slackAppId);
    for (const {canvasId, pod} of boundPods) {
        podStore.setSlackBinding(canvasId, pod.id, null);
        slackMessageQueue.clear(pod.id);
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
    socketService.emitToConnection(connectionId, WebSocketResponseEvents.SLACK_APP_LIST_RESULT, {
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

    socketService.emitToConnection(connectionId, WebSocketResponseEvents.SLACK_APP_GET_RESULT, {
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

    socketService.emitToConnection(connectionId, WebSocketResponseEvents.SLACK_APP_CHANNELS_RESULT, {
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

    const result = await slackConnectionManager.refreshChannels(slackAppId);
    if (!result.success) {
        emitError(connectionId, WebSocketResponseEvents.SLACK_APP_CHANNELS_REFRESHED, result.error ?? '重新取得頻道失敗', requestId, undefined, 'INTERNAL_ERROR');
        return;
    }

    logger.log('Slack', 'Complete', `Slack App「${app.name}」頻道已重新整理`);

    socketService.emitToConnection(connectionId, WebSocketResponseEvents.SLACK_APP_CHANNELS_REFRESHED, {
        requestId,
        success: true,
        slackAppId,
        channels: result.data,
    });
}

export async function handlePodBindSlack(
    connectionId: string,
    payload: PodBindSlackPayload,
    requestId: string
): Promise<void> {
    const {canvasId, podId, slackAppId, slackChannelId} = payload;

    const pod = podStore.getById(canvasId, podId);
    if (!pod) {
        emitError(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, `找不到 Pod：${podId}`, requestId, undefined, 'NOT_FOUND');
        return;
    }

    const app = slackAppStore.getById(slackAppId);
    if (!app) {
        emitError(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, `找不到 Slack App：${slackAppId}`, requestId, undefined, 'NOT_FOUND');
        return;
    }

    if (app.connectionStatus !== 'connected') {
        emitError(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, `Slack App「${app.name}」尚未連線`, requestId, undefined, 'NOT_CONNECTED');
        return;
    }

    const channel = app.channels.find((ch) => ch.id === slackChannelId);
    if (!channel) {
        emitError(connectionId, WebSocketResponseEvents.POD_SLACK_BOUND, `找不到頻道：${slackChannelId}`, requestId, undefined, 'NOT_FOUND');
        return;
    }

    podStore.setSlackBinding(canvasId, podId, {slackAppId, slackChannelId});

    logger.log('Slack', 'Create', `Pod「${pod.name}」已綁定 Slack App「${app.name}」頻道「${channel.name}」`);

    emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_SLACK_BOUND);
}

export async function handlePodUnbindSlack(
    connectionId: string,
    payload: PodUnbindSlackPayload,
    requestId: string
): Promise<void> {
    const {canvasId, podId} = payload;

    const pod = podStore.getById(canvasId, podId);
    if (!pod) {
        emitError(connectionId, WebSocketResponseEvents.POD_SLACK_UNBOUND, `找不到 Pod：${podId}`, requestId, undefined, 'NOT_FOUND');
        return;
    }

    if (!pod.slackBinding) {
        emitError(connectionId, WebSocketResponseEvents.POD_SLACK_UNBOUND, `Pod「${pod.name}」尚未綁定 Slack`, requestId, undefined, 'NOT_BOUND');
        return;
    }

    podStore.setSlackBinding(canvasId, podId, null);
    slackMessageQueue.clear(podId);

    logger.log('Slack', 'Delete', `Pod「${pod.name}」已解除 Slack 綁定`);

    emitPodUpdated(canvasId, podId, requestId, WebSocketResponseEvents.POD_SLACK_UNBOUND);
}
