import {describe, it, expect, beforeEach} from 'vitest';
import {initTestDb, resetDb} from '../../src/database/index.js';
import {resetStatements} from '../../src/database/statements.js';
import {McpServerStore} from '../../src/services/mcpServerStore.js';
import {mcpServerCreateSchema, mcpServerUpdateSchema, podBindMcpServerSchema, podUnbindMcpServerSchema} from '../../src/schemas/mcpServerSchemas.js';
import type {StdioMcpServerConfig, HttpMcpServerConfig} from '../../src/types/mcpServer.js';

describe('McpServerStore', () => {
    let store: McpServerStore;
    const stdioConfig: StdioMcpServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {NODE_ENV: 'test'},
    };
    const httpConfig: HttpMcpServerConfig = {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {'Authorization': 'Bearer token'},
    };

    beforeEach(() => {
        initTestDb();
        resetStatements();
        store = new McpServerStore();
    });

    afterEach(() => {
        resetDb();
    });

    describe('建立 MCP Server', () => {
        it('建立 stdio 模式的 MCP Server，驗證回傳的 id、name、config 正確', () => {
            const server = store.create('test-stdio', stdioConfig);

            expect(server.id).toBeTruthy();
            expect(server.name).toBe('test-stdio');
            expect(server.config).toEqual(stdioConfig);
        });

        it('建立 http 模式的 MCP Server，驗證 type、url、headers 正確', () => {
            const server = store.create('test-http', httpConfig);

            expect(server.id).toBeTruthy();
            expect(server.name).toBe('test-http');
            expect(server.config).toEqual(httpConfig);
        });
    });

    describe('列出所有 MCP Server', () => {
        it('建立多個 MCP Server 後，驗證 list() 回傳所有項目', () => {
            store.create('server-1', stdioConfig);
            store.create('server-2', httpConfig);

            const list = store.list();
            expect(list).toHaveLength(2);
        });
    });

    describe('取得單一 MCP Server', () => {
        it('驗證 getById 取得正確的 MCP Server', () => {
            const created = store.create('my-server', stdioConfig);
            const found = store.getById(created.id);

            expect(found).toBeDefined();
            expect(found?.id).toBe(created.id);
            expect(found?.name).toBe('my-server');
        });

        it('不存在的 ID 回傳 undefined', () => {
            const found = store.getById('non-existent-id');
            expect(found).toBeUndefined();
        });
    });

    describe('exists', () => {
        it('存在的 ID 回傳 true', async () => {
            const server = store.create('server', stdioConfig);
            const result = await store.exists(server.id);
            expect(result).toBe(true);
        });

        it('不存在的 ID 回傳 false', async () => {
            const result = await store.exists('non-existent-id');
            expect(result).toBe(false);
        });
    });

    describe('更新 MCP Server', () => {
        it('更新 config 後驗證新值', () => {
            const server = store.create('old-name', stdioConfig);
            const newConfig: HttpMcpServerConfig = {type: 'sse', url: 'https://new.example.com/mcp'};
            const updated = store.update(server.id, 'new-name', newConfig);

            expect(updated).toBeDefined();
            expect(updated?.name).toBe('new-name');
            expect(updated?.config).toEqual(newConfig);
        });

        it('不存在的 ID 回傳 undefined', () => {
            const result = store.update('non-existent-id', 'name', stdioConfig);
            expect(result).toBeUndefined();
        });
    });

    describe('刪除 MCP Server', () => {
        it('刪除後 getById 回傳 undefined', () => {
            const server = store.create('to-delete', stdioConfig);
            store.delete(server.id);

            expect(store.getById(server.id)).toBeUndefined();
        });

        it('刪除不存在的 ID 回傳 false', () => {
            const result = store.delete('non-existent-id');
            expect(result).toBe(false);
        });
    });

    describe('批次取得多個 MCP Server', () => {
        it('驗證 getByIds 回傳的數量和內容', () => {
            const s1 = store.create('server-1', stdioConfig);
            const s2 = store.create('server-2', httpConfig);
            store.create('server-3', stdioConfig);

            const results = store.getByIds([s1.id, s2.id]);
            expect(results).toHaveLength(2);
            expect(results.map((s) => s.id)).toContain(s1.id);
            expect(results.map((s) => s.id)).toContain(s2.id);
        });

        it('空陣列回傳空結果', () => {
            store.create('server-1', stdioConfig);
            const results = store.getByIds([]);
            expect(results).toHaveLength(0);
        });
    });
});

describe('Schema 驗證', () => {
    const validRequestId = '550e8400-e29b-41d4-a716-446655440001';
    const validCanvasId = '550e8400-e29b-41d4-a716-446655440002';
    const validPodId = '550e8400-e29b-41d4-a716-446655440003';
    const validMcpServerId = '550e8400-e29b-41d4-a716-446655440004';

    describe('mcpServerCreateSchema', () => {
        it('驗證 stdio 模式的 payload 通過驗證', () => {
            const payload = {
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: 'my-stdio-server',
                config: {
                    command: 'node',
                    args: ['server.js'],
                },
            };

            const result = mcpServerCreateSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        it('驗證 http 模式的 payload 通過驗證', () => {
            const payload = {
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: 'my-http-server',
                config: {
                    type: 'http',
                    url: 'https://example.com/mcp',
                },
            };

            const result = mcpServerCreateSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });

        it('驗證缺少必要欄位時拒絕', () => {
            const payload = {
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: 'no-config-server',
            };

            const result = mcpServerCreateSchema.safeParse(payload);
            expect(result.success).toBe(false);
        });

        it('name 為空字串時拒絕', () => {
            const result = mcpServerCreateSchema.safeParse({
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: '',
                config: {command: 'node'},
            });
            expect(result.success).toBe(false);
        });

        it('name 超過 100 字元時拒絕', () => {
            const result = mcpServerCreateSchema.safeParse({
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: 'a'.repeat(101),
                config: {command: 'node'},
            });
            expect(result.success).toBe(false);
        });

        it('name 含特殊字元時拒絕', () => {
            const result = mcpServerCreateSchema.safeParse({
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: 'invalid name!',
                config: {command: 'node'},
            });
            expect(result.success).toBe(false);
        });
    });

    describe('mcpServerUpdateSchema', () => {
        it('正確 payload 通過驗證', () => {
            const result = mcpServerUpdateSchema.safeParse({
                requestId: validRequestId,
                canvasId: validCanvasId,
                mcpServerId: validMcpServerId,
                name: 'updated-server',
                config: {command: 'python', args: ['server.py']},
            });
            expect(result.success).toBe(true);
        });

        it('缺少 mcpServerId 時拒絕', () => {
            const result = mcpServerUpdateSchema.safeParse({
                requestId: validRequestId,
                canvasId: validCanvasId,
                name: 'updated-server',
                config: {command: 'python'},
            });
            expect(result.success).toBe(false);
        });

        it('缺少 config 時拒絕', () => {
            const result = mcpServerUpdateSchema.safeParse({
                requestId: validRequestId,
                canvasId: validCanvasId,
                mcpServerId: validMcpServerId,
                name: 'updated-server',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('podBindMcpServerSchema', () => {
        it('驗證正確的 payload 通過驗證', () => {
            const payload = {
                requestId: validRequestId,
                canvasId: validCanvasId,
                podId: validPodId,
                mcpServerId: validMcpServerId,
            };

            const result = podBindMcpServerSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });
    });

    describe('podUnbindMcpServerSchema', () => {
        it('驗證正確的 payload 通過驗證', () => {
            const payload = {
                requestId: validRequestId,
                canvasId: validCanvasId,
                podId: validPodId,
                mcpServerId: validMcpServerId,
            };

            const result = podUnbindMcpServerSchema.safeParse(payload);
            expect(result.success).toBe(true);
        });
    });
});

describe('MCP Server 到 Claude SDK 選項組裝', () => {
    let store: McpServerStore;

    beforeEach(() => {
        initTestDb();
        resetStatements();
        store = new McpServerStore();
    });

    afterEach(() => {
        resetDb();
    });

    it('給定多個 MCP Server ID，驗證組裝出的 mcpServers 物件格式正確', () => {
        const s1 = store.create('server-one', {command: 'node', args: ['a.js']});
        const s2 = store.create('server-two', {type: 'http', url: 'https://example.com'});

        const servers = store.getByIds([s1.id, s2.id]);
        const mcpServers: Record<string, unknown> = {};
        for (const server of servers) {
            mcpServers[server.name] = server.config;
        }

        expect(mcpServers['server-one']).toEqual({command: 'node', args: ['a.js']});
        expect(mcpServers['server-two']).toEqual({type: 'http', url: 'https://example.com'});
    });

    it('給定空的 mcpServerIds，getByIds 回傳空陣列', () => {
        store.create('server-1', {command: 'node', args: ['a.js']});

        const servers = store.getByIds([]);
        expect(servers).toHaveLength(0);
    });
});
