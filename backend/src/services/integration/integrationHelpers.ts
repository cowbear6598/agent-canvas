import { socketService } from '../socketService.js';
import { WebSocketResponseEvents } from '../../schemas/events.js';
import { integrationAppStore } from './integrationAppStore.js';
import { escapeUserInput } from '../../utils/escapeInput.js';
import { logger } from '../../utils/logger.js';
import type { LogCategory } from '../../utils/logger.js';
import type { IntegrationApp } from './types.js';

export function broadcastConnectionStatus(providerName: string, appId: string): void {
    const app = integrationAppStore.getById(appId);
    if (!app) return;

    socketService.emitToAll(WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED, {
        provider: providerName,
        appId,
        connectionStatus: app.connectionStatus,
        resources: app.resources,
    });
}

export function destroyProvider(
    clients: Map<string, unknown>,
    appId: string,
    logCategory: LogCategory,
): void {
    clients.delete(appId);
    integrationAppStore.updateStatus(appId, 'disconnected');
    broadcastConnectionStatus(logCategory, appId);
    logger.log(logCategory, 'Complete', `${logCategory} App ${appId} 已移除`);
}

/**
 * 封裝共用的 Provider 初始化流程：驗證 + 建立 client → fetchResources → 更新狀態 + broadcast
 * validateAndSetupFn 負責驗證 config 並建立 client，失敗時回傳 false，成功時回傳 true。
 * fetchResourcesFn 需自行處理錯誤（catch 後記錄警告），不應拋出例外。
 */
export async function initializeProvider(
    app: IntegrationApp,
    validateAndSetupFn: () => Promise<boolean>,
    fetchResourcesFn: () => Promise<void>,
    logCategory: LogCategory,
): Promise<void> {
    const isValid = await validateAndSetupFn();
    if (!isValid) {
        integrationAppStore.updateStatus(app.id, 'error');
        broadcastConnectionStatus(logCategory, app.id);
        return;
    }

    await fetchResourcesFn();

    integrationAppStore.updateStatus(app.id, 'connected');
    broadcastConnectionStatus(logCategory, app.id);
    logger.log(logCategory, 'Complete', `${logCategory} App ${app.id} 初始化成功`);
}

// 第一層：escapeUserInput 處理特殊字元；第二層：<user_data> 標籤作為結構性隔離
export function formatIntegrationMessage(providerName: string, userName: string, content: string): string {
    const escapedUserName = escapeUserInput(userName);
    const escapedContent = escapeUserInput(content);
    return `[${providerName}: @${escapedUserName}] <user_data>${escapedContent}</user_data>`;
}

export async function parseWebhookBody(
    req: Request,
    maxBodySize: number,
): Promise<{ rawBody: string; payload: unknown } | Response> {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
        return new Response('Payload Too Large', { status: 413 });
    }

    const rawBody = await req.text();

    if (rawBody.length > maxBodySize) {
        return new Response('Payload Too Large', { status: 413 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return new Response('無效的 JSON body', { status: 400 });
    }

    return { rawBody, payload };
}
