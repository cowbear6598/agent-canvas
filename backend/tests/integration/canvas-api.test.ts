import {
	waitForEvent,
	setupIntegrationTest,
} from '../setup';
import { createCanvas, patchCanvas, postCanvas } from '../helpers';
import { canvasStore } from '../../src/services/canvasStore.js';

describe('Canvas REST API', () => {
	const { getServer, getClient } = setupIntegrationTest();

	describe('GET /api/canvas/list', () => {
		it('成功取得畫布列表', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas/list`);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('application/json');

			const body = await response.json();
			expect(Array.isArray(body.canvases)).toBe(true);
		});

		it('回傳資料包含正確欄位', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas/list`);
			const body = await response.json();

			expect(body.canvases.length).toBeGreaterThan(0);

			const canvas = body.canvases[0];
			expect(typeof canvas.id).toBe('string');
			expect(typeof canvas.name).toBe('string');
			expect(typeof canvas.sortIndex).toBe('number');
		});

		it('回傳資料按 sortIndex 排序', async () => {
			const server = getServer();
			const client = getClient();
			await createCanvas(client, 'Api Test Canvas A');
			await createCanvas(client, 'Api Test Canvas B');

			const response = await fetch(`${server.baseUrl}/api/canvas/list`);
			const body = await response.json();

			const sortIndexes: number[] = body.canvases.map((c: { sortIndex: number }) => c.sortIndex);
			for (let i = 1; i < sortIndexes.length; i++) {
				expect(sortIndexes[i]).toBeGreaterThanOrEqual(sortIndexes[i - 1]);
			}
		});
	});

	describe('POST /api/canvas', () => {
		it('成功建立 Canvas 並回傳 201 與正確欄位', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, { name: 'rest-api-test' });
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.canvas).toBeDefined();
			expect(body.canvas.id).toBeTypeOf('string');
			expect(body.canvas.name).toBe('rest-api-test');
			expect(body.canvas.sortIndex).toBeTypeOf('number');
		});

		it('成功建立後透過 WebSocket 廣播 canvas:created 事件', async () => {
			const server = getServer();
			const client = getClient();
			const eventPromise = waitForEvent(client, 'canvas:created', 5000);
			const response = await postCanvas(server.baseUrl, { name: 'ws-broadcast-test' });
			expect(response.status).toBe(201);
			const event = await eventPromise;
			expect(event.success).toBe(true);
			expect(event.canvas).toBeDefined();
			expect(event.canvas.name).toBe('ws-broadcast-test');
			expect(event.requestId).toBe('system');
		});

		it('缺少 name 欄位回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, {});
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能為空');
		});

		it('name 為空字串回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, { name: '   ' });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能為空');
		});

		it('name 包含非法字元回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, { name: 'test@canvas!' });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱只能包含英文字母、數字、底線、連字號和空格');
		});

		it('name 超過 50 字元回傳 400', async () => {
			const server = getServer();
			const longName = 'a'.repeat(51);
			const response = await postCanvas(server.baseUrl, { name: longName });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能超過 50 個字元');
		});

		it('重複名稱回傳 400', async () => {
			const server = getServer();
			await postCanvas(server.baseUrl, { name: 'duplicate-test' });
			const response = await postCanvas(server.baseUrl, { name: 'duplicate-test' });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBeTruthy();
		});

		it('request body 非 JSON 格式回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, 'not json', 'text/plain');
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('無效的請求格式');
		});

		it('name 為 null 回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, { name: null });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能為空');
		});

		it('name 為非字串型別回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, { name: 123 });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能為空');
		});

		it('Windows 保留名稱回傳 400', async () => {
			const server = getServer();
			const response = await postCanvas(server.baseUrl, { name: 'CON' });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱為系統保留名稱');
		});

		it('name 剛好 50 字元應成功建立', async () => {
			const server = getServer();
			const name50 = 'a'.repeat(50);
			const response = await postCanvas(server.baseUrl, { name: name50 });
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.canvas.name).toBe(name50);
		});

		it('不帶 body 回傳 400', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			});
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('無效的請求格式');
		});

		it('建立後 GET /api/canvas/list 應包含新 Canvas', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'list-verify-test' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();

			const listResponse = await fetch(`${server.baseUrl}/api/canvas/list`);
			const listBody = await listResponse.json();
			const found = listBody.canvases.find((c: { id: string }) => c.id === created.canvas.id);
			expect(found).toBeDefined();
			expect(found.name).toBe('list-verify-test');
		});

		it('canvasStore.create 拋出例外時回傳 500', async () => {
			const server = getServer();
			const spy = vi.spyOn(canvasStore, 'create').mockRejectedValueOnce(new Error('模擬錯誤'));
			const response = await postCanvas(server.baseUrl, { name: 'error-test' });
			expect(response.status).toBe(500);
			const body = await response.json();
			expect(body.error).toBe('伺服器內部錯誤');
			spy.mockRestore();
		});
	});

	describe('DELETE /api/canvas/:id', () => {
		it('成功刪除 Canvas 回傳 200', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'delete-test-canvas' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await fetch(`${server.baseUrl}/api/canvas/${canvasId}`, { method: 'DELETE' });
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.success).toBe(true);
		});

		it('成功刪除後透過 WebSocket 廣播 canvas:deleted 事件', async () => {
			const server = getServer();
			const client = getClient();
			const createResponse = await postCanvas(server.baseUrl, { name: 'delete-ws-test' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const eventPromise = waitForEvent(client, 'canvas:deleted', 5000);
			const response = await fetch(`${server.baseUrl}/api/canvas/${canvasId}`, { method: 'DELETE' });
			expect(response.status).toBe(200);

			const event = await eventPromise;
			expect(event.success).toBe(true);
			expect(event.canvasId).toBe(canvasId);
			expect(event.requestId).toBe('system');
		});

		it('刪除後 GET /api/canvas/list 不包含已刪除的 Canvas', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'delete-list-verify' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			await fetch(`${server.baseUrl}/api/canvas/${canvasId}`, { method: 'DELETE' });

			const listResponse = await fetch(`${server.baseUrl}/api/canvas/list`);
			const listBody = await listResponse.json();
			const found = listBody.canvases.find((c: { id: string }) => c.id === canvasId);
			expect(found).toBeUndefined();
		});

		it('刪除不存在的 Canvas 回傳 404', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas/00000000-0000-4000-8000-000000000000`, { method: 'DELETE' });
			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error).toBe('找不到 Canvas');
		});

		it('用 canvas name 刪除 Canvas 成功', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'delete-by-name-test' });
			expect(createResponse.status).toBe(201);

			const response = await fetch(`${server.baseUrl}/api/canvas/delete-by-name-test`, { method: 'DELETE' });
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.success).toBe(true);
		});

		it('找不到的 canvas name 回傳 404', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas/non-existent-canvas`, { method: 'DELETE' });
			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error).toBe('找不到 Canvas');
		});

		it('canvasStore.delete 失敗時回傳 500', async () => {
			const server = getServer();
			const client = getClient();
			const created = await createCanvas(client, 'delete-error-test');
			const spy = vi.spyOn(canvasStore, 'delete').mockResolvedValueOnce({ success: false, error: '模擬刪除失敗' });

			const response = await fetch(`${server.baseUrl}/api/canvas/${created.id}`, { method: 'DELETE' });
			expect(response.status).toBe(500);
			const body = await response.json();
			expect(body.error).toBe('刪除 Canvas 時發生錯誤');

			spy.mockRestore();
		});

		it('重複刪除同一個 Canvas 回傳 404', async () => {
			const server = getServer();
			const client = getClient();
			const created = await createCanvas(client, 'double-delete-test');

			const first = await fetch(`${server.baseUrl}/api/canvas/${created.id}`, { method: 'DELETE' });
			expect(first.status).toBe(200);

			const second = await fetch(`${server.baseUrl}/api/canvas/${created.id}`, { method: 'DELETE' });
			expect(second.status).toBe(404);
			const body = await second.json();
			expect(body.error).toBe('找不到 Canvas');
		});
	});

	describe('錯誤處理', () => {
		it('呼叫錯誤路徑回傳 404', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas`);

			expect(response.status).toBe(404);
			expect(response.headers.get('content-type')).toBe('application/json');

			const body = await response.json();
			expect(body.error).toBe('找不到 API 路徑');
		});

		it('呼叫錯誤 HTTP method 回傳 404', async () => {
			const server = getServer();
			const response = await fetch(`${server.baseUrl}/api/canvas/list`, {
				method: 'POST',
			});

			expect(response.status).toBe(404);
			expect(response.headers.get('content-type')).toBe('application/json');

			const body = await response.json();
			expect(body.error).toBe('找不到 API 路徑');
		});

		it('handler 拋出例外時回傳 500', async () => {
			const server = getServer();
			const { canvasStore } = await import('../../src/services/canvasStore.js');
			vi.spyOn(canvasStore, 'list').mockImplementationOnce(() => {
				throw new Error('模擬資料庫錯誤');
			});

			const response = await fetch(`${server.baseUrl}/api/canvas/list`);

			expect(response.status).toBe(500);
			expect(response.headers.get('content-type')).toBe('application/json');

			const body = await response.json();
			expect(body.error).toBe('伺服器內部錯誤');

			vi.restoreAllMocks();
		});
	});

	describe('空列表情境', () => {
		it('沒有畫布時回傳空陣列', async () => {
			const server = getServer();
			const { canvasStore } = await import('../../src/services/canvasStore.js');
			vi.spyOn(canvasStore, 'list').mockReturnValueOnce([]);

			const response = await fetch(`${server.baseUrl}/api/canvas/list`);

			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.canvases).toEqual([]);

			vi.restoreAllMocks();
		});
	});

	describe('PATCH /api/canvas/:id', () => {

		it('成功重新命名 Canvas 回傳 200 並包含 canvas 物件', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'patch-rename-test' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, { name: 'new-name' });
			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.canvas.id).toBe(canvasId);
			expect(body.canvas.name).toBe('new-name');
		});

		it('重新命名後 GET /api/canvas/list 確認名稱已更新', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-list-verify' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			await patchCanvas(server.baseUrl, canvasId, { name: 'renamed-list-verify' });

			const listResponse = await fetch(`${server.baseUrl}/api/canvas/list`);
			const listBody = await listResponse.json();
			const found = listBody.canvases.find((c: { id: string }) => c.id === canvasId);
			expect(found).toBeDefined();
			expect(found.name).toBe('renamed-list-verify');
		});

		it('重新命名後透過 WebSocket 廣播 canvas:renamed 事件', async () => {
			const server = getServer();
			const client = getClient();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-ws-test' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const eventPromise = waitForEvent(client, 'canvas:renamed', 5000);
			const response = await patchCanvas(server.baseUrl, canvasId, { name: 'rename-ws-renamed' });
			expect(response.status).toBe(200);

			const event = await eventPromise;
			expect(event.success).toBe(true);
			expect(event.requestId).toBe('system');
			expect(event.canvasId).toBe(canvasId);
			expect(event.newName).toBe('rename-ws-renamed');
			expect(event.canvas.id).toBe(canvasId);
			expect(event.canvas.name).toBe('rename-ws-renamed');
		});

		it('用 Canvas name 重新命名成功', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-by-name-test' });
			expect(createResponse.status).toBe(201);

			const response = await patchCanvas(server.baseUrl, 'rename-by-name-test', { name: 'rename-by-name-result' });
			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.canvas.name).toBe('rename-by-name-result');
		});

		it('缺少 name 欄位回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-missing-name' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, {});
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能為空');
		});

		it('name 為空字串回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-empty-name' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, { name: '   ' });
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能為空');
		});

		it('name 超過 50 字元回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-long-name' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, { name: 'a'.repeat(51) });
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱不能超過 50 個字元');
		});

		it('name 包含非法字元回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-invalid-char' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, { name: 'test@canvas!' });
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱只能包含英文字母、數字、底線、連字號和空格');
		});

		it('Canvas 不存在回傳 404', async () => {
			const server = getServer();
			const response = await patchCanvas(server.baseUrl, '00000000-0000-4000-8000-000000000000', { name: 'new-name' });
			expect(response.status).toBe(404);

			const body = await response.json();
			expect(body.error).toBe('找不到 Canvas');
		});

		it('無效 JSON body 回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-invalid-json' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await fetch(`${server.baseUrl}/api/canvas/${canvasId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'text/plain' },
				body: 'not json',
			});
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBe('無效的請求格式');
		});

		it('重複名稱回傳 400', async () => {
			const server = getServer();
			const createAResponse = await postCanvas(server.baseUrl, { name: 'rename-dup-a' });
			expect(createAResponse.status).toBe(201);
			const createBResponse = await postCanvas(server.baseUrl, { name: 'rename-dup-b' });
			expect(createBResponse.status).toBe(201);
			const createdB = await createBResponse.json();

			const response = await patchCanvas(server.baseUrl, createdB.canvas.id, { name: 'rename-dup-a' });
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBeTruthy();
		});

		it('重新命名為自己目前名稱回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-self-test' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, { name: 'rename-self-test' });
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBeTruthy();
		});

		it('name 為 Windows 保留名稱回傳 400', async () => {
			const server = getServer();
			const createResponse = await postCanvas(server.baseUrl, { name: 'rename-win-reserved' });
			expect(createResponse.status).toBe(201);
			const created = await createResponse.json();
			const canvasId = created.canvas.id;

			const response = await patchCanvas(server.baseUrl, canvasId, { name: 'CON' });
			expect(response.status).toBe(400);

			const body = await response.json();
			expect(body.error).toBe('Canvas 名稱為系統保留名稱');
		});
	});
});
