import type { Mock } from 'vitest';

vi.mock('../../src/services/integration/integrationAppStore.js', () => ({
    integrationAppStore: {
        getById: vi.fn(),
        updateStatus: vi.fn(),
    },
}));

vi.mock('../../src/services/socketService.js', () => ({
    socketService: {
        emitToAll: vi.fn(),
    },
}));

vi.mock('../../src/utils/logger.js', () => ({
    logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { beforeEach, describe, expect, it } from 'vitest';
import {
    broadcastConnectionStatus,
    destroyProvider,
    initializeProvider,
    formatIntegrationMessage,
    parseWebhookBody,
} from '../../src/services/integration/integrationHelpers.js';
import { integrationAppStore } from '../../src/services/integration/integrationAppStore.js';
import { socketService } from '../../src/services/socketService.js';
import { logger } from '../../src/utils/logger.js';
import { WebSocketResponseEvents } from '../../src/schemas/events.js';
import type { IntegrationApp } from '../../src/services/integration/types.js';

function asMock(fn: unknown): Mock<any> {
    return fn as Mock<any>;
}

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
    return {
        id: 'app-test-1',
        name: 'Test App',
        provider: 'slack',
        config: {},
        connectionStatus: 'disconnected',
        resources: [],
        ...overrides,
    };
}

describe('broadcastConnectionStatus', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('App 不存在時應提早 return，不呼叫 emitToAll', () => {
        asMock(integrationAppStore.getById).mockReturnValue(undefined);

        broadcastConnectionStatus('slack', 'app-not-found');

        expect(socketService.emitToAll).not.toHaveBeenCalled();
    });

    it('App 存在時應呼叫 emitToAll 並帶正確的 payload', () => {
        const app = makeApp({
            id: 'app-test-1',
            connectionStatus: 'connected',
            resources: [{ id: 'C001', name: 'general' }],
        });
        asMock(integrationAppStore.getById).mockReturnValue(app);

        broadcastConnectionStatus('slack', 'app-test-1');

        expect(socketService.emitToAll).toHaveBeenCalledWith(
            WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
            {
                provider: 'slack',
                appId: 'app-test-1',
                connectionStatus: 'connected',
                resources: [{ id: 'C001', name: 'general' }],
            },
        );
    });
});

describe('destroyProvider', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('應從 clients Map 移除 appId', () => {
        const app = makeApp({ connectionStatus: 'connected' });
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const clients = new Map<string, unknown>([['app-test-1', {}]]);

        destroyProvider(clients, 'app-test-1', 'slack', 'Slack');

        expect(clients.has('app-test-1')).toBe(false);
    });

    it('應呼叫 updateStatus 設為 disconnected', () => {
        const app = makeApp({ connectionStatus: 'connected' });
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const clients = new Map<string, unknown>([['app-test-1', {}]]);

        destroyProvider(clients, 'app-test-1', 'slack', 'Slack');

        expect(integrationAppStore.updateStatus).toHaveBeenCalledWith('app-test-1', 'disconnected');
    });

    it('應呼叫 broadcastConnectionStatus（透過 emitToAll 確認）', () => {
        const app = makeApp({ connectionStatus: 'disconnected' });
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const clients = new Map<string, unknown>([['app-test-1', {}]]);

        destroyProvider(clients, 'app-test-1', 'slack', 'Slack');

        expect(socketService.emitToAll).toHaveBeenCalled();
    });

    it('應呼叫 logger.log', () => {
        const app = makeApp({ connectionStatus: 'disconnected' });
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const clients = new Map<string, unknown>([['app-test-1', {}]]);

        destroyProvider(clients, 'app-test-1', 'slack', 'Slack');

        expect(logger.log).toHaveBeenCalledWith('Slack', 'Complete', expect.stringContaining('app-test-1'));
    });
});

describe('initializeProvider', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('validateAndSetupFn 回傳 false 時，App 設為 error 並 broadcast', async () => {
        const app = makeApp();
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const validateFn = vi.fn().mockResolvedValue(false);
        const fetchFn = vi.fn().mockResolvedValue(undefined);

        await initializeProvider(app, validateFn, fetchFn, 'Slack');

        expect(integrationAppStore.updateStatus).toHaveBeenCalledWith('app-test-1', 'error');
        expect(socketService.emitToAll).toHaveBeenCalled();
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('validateAndSetupFn 回傳 true 時，執行 fetchResourcesFn、設為 connected 並 broadcast', async () => {
        const app = makeApp();
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const validateFn = vi.fn().mockResolvedValue(true);
        const fetchFn = vi.fn().mockResolvedValue(undefined);

        await initializeProvider(app, validateFn, fetchFn, 'Slack');

        expect(fetchFn).toHaveBeenCalled();
        expect(integrationAppStore.updateStatus).toHaveBeenCalledWith('app-test-1', 'connected');
        expect(socketService.emitToAll).toHaveBeenCalled();
    });

    it('fetchResourcesFn 自行攔截錯誤（不拋出）時，connected 狀態仍正常設定', async () => {
        const app = makeApp();
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const validateFn = vi.fn().mockResolvedValue(true);
        // fetchResourcesFn 需自行處理錯誤，不應拋出例外（由 caller 保證）
        const fetchFn = vi.fn().mockResolvedValue(undefined);

        await initializeProvider(app, validateFn, fetchFn, 'Slack');

        expect(integrationAppStore.updateStatus).toHaveBeenCalledWith('app-test-1', 'connected');
    });

    it('初始化成功時 broadcastConnectionStatus 收到的 provider 為小寫', async () => {
        const app = makeApp({ provider: 'slack' });
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const validateFn = vi.fn().mockResolvedValue(true);
        const fetchFn = vi.fn().mockResolvedValue(undefined);

        await initializeProvider(app, validateFn, fetchFn, 'Slack');

        expect(socketService.emitToAll).toHaveBeenCalledWith(
            WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
            expect.objectContaining({ provider: 'slack' }),
        );
    });

    it('初始化失敗時 broadcastConnectionStatus 收到的 provider 為小寫', async () => {
        const app = makeApp({ provider: 'slack' });
        asMock(integrationAppStore.getById).mockReturnValue(app);
        const validateFn = vi.fn().mockResolvedValue(false);
        const fetchFn = vi.fn().mockResolvedValue(undefined);

        await initializeProvider(app, validateFn, fetchFn, 'Slack');

        expect(socketService.emitToAll).toHaveBeenCalledWith(
            WebSocketResponseEvents.INTEGRATION_CONNECTION_STATUS_CHANGED,
            expect.objectContaining({ provider: 'slack' }),
        );
    });
});

describe('formatIntegrationMessage', () => {
    it('一般輸入應產生正確格式', () => {
        const result = formatIntegrationMessage('Slack', 'john', 'hello world');

        expect(result).toBe('[Slack: @john] <user_data>hello world</user_data>');
    });

    it('含 < 和 > 特殊字元的輸入應被 escape', () => {
        const result = formatIntegrationMessage('Slack', 'user<admin>', '<script>alert(1)</script>');

        expect(result).not.toContain('<admin>');
        expect(result).not.toContain('<script>');
        expect(result).toContain('＜');
        expect(result).toContain('＞');
    });
});

describe('parseWebhookBody', () => {
    const MAX_SIZE = 1000;

    it('Content-Length 超過 maxBodySize 時回傳 413', async () => {
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            headers: { 'content-length': String(MAX_SIZE + 1) },
            body: '{}',
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(413);
    });

    it('Content-Length 為負值時回傳 413', async () => {
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            headers: { 'content-length': '-1' },
            body: '{}',
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(413);
    });

    it('Content-Length 為 NaN 時回傳 413', async () => {
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            headers: { 'content-length': 'not-a-number' },
            body: '{}',
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(413);
    });

    it('rawBody 實際長度超過 maxBodySize 時回傳 413', async () => {
        const bigBody = JSON.stringify({ data: 'x'.repeat(MAX_SIZE + 1) });
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            body: bigBody,
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(413);
    });

    it('JSON 解析失敗時回傳 400', async () => {
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            body: 'not-valid-json',
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).toBeInstanceOf(Response);
        expect((result as Response).status).toBe(400);
    });

    it('正常 JSON 時回傳 { rawBody, payload }', async () => {
        const body = { type: 'test', value: 42 };
        const rawBody = JSON.stringify(body);
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            headers: { 'content-length': String(rawBody.length) },
            body: rawBody,
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).not.toBeInstanceOf(Response);
        const parsed = result as { rawBody: string; payload: unknown };
        expect(parsed.rawBody).toBe(rawBody);
        expect(parsed.payload).toEqual(body);
    });

    it('無 Content-Length header 且 body 正常時回傳 { rawBody, payload }', async () => {
        const body = { hello: 'world' };
        const rawBody = JSON.stringify(body);
        const req = new Request('http://localhost/webhook', {
            method: 'POST',
            body: rawBody,
        });

        const result = await parseWebhookBody(req, MAX_SIZE);

        expect(result).not.toBeInstanceOf(Response);
        const parsed = result as { rawBody: string; payload: unknown };
        expect(parsed.rawBody).toBe(rawBody);
        expect(parsed.payload).toEqual(body);
    });
});
