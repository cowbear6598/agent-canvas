import {v4 as uuidv4} from 'uuid';
import {
    emitAndWaitResponse,
    setupIntegrationTest,
} from '../setup';
import {
    createCanvas,
    getCanvasId,
    listCanvases,
    reorderCanvases,
} from '../helpers';
import {FAKE_UUID} from '../helpers';
import {
    WebSocketRequestEvents,
    WebSocketResponseEvents,
    type CanvasCreatePayload,
    type CanvasListPayload,
    type CanvasRenamePayload,
    type CanvasDeletePayload,
    type CanvasSwitchPayload,
    type CanvasReorderPayload,
} from '../../src/schemas';
import {
    type CanvasCreatedPayload,
    type CanvasListResultPayload,
    type CanvasRenamedPayload,
    type CanvasDeletedPayload,
    type CanvasSwitchedPayload,
    type CanvasReorderedPayload,
} from '../../src/types';

describe('Canvas 管理', () => {
    const { getClient } = setupIntegrationTest();

    describe('Canvas 建立', () => {
        it('使用有效名稱成功建立', async () => {
            const client = getClient();
            const canvas = await createCanvas(client, 'Test Canvas');

            expect(canvas.id).toBeDefined();
            expect(canvas.name).toBe('Test Canvas');
        });

        it('空白名稱時建立失敗', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasCreatePayload, CanvasCreatedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_CREATE,
                WebSocketResponseEvents.CANVAS_CREATED,
                {requestId: uuidv4(), name: ''}
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('無效名稱時建立失敗', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasCreatePayload, CanvasCreatedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_CREATE,
                WebSocketResponseEvents.CANVAS_CREATED,
                {requestId: uuidv4(), name: 'Invalid@Name!'}
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });
    });

    describe('Canvas 列表', () => {
        it('成功回傳所有 Canvas', async () => {
            const client = getClient();
            await createCanvas(client, 'List Canvas 1');
            await createCanvas(client, 'List Canvas 2');

            const response = await emitAndWaitResponse<CanvasListPayload, CanvasListResultPayload>(
                client,
                WebSocketRequestEvents.CANVAS_LIST,
                WebSocketResponseEvents.CANVAS_LIST_RESULT,
                {requestId: uuidv4()}
            );

            expect(response.success).toBe(true);
            const names = response.canvases!.map((c) => c.name);
            expect(names).toContain('List Canvas 1');
            expect(names).toContain('List Canvas 2');
        });

        it('成功回傳陣列格式', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasListPayload, CanvasListResultPayload>(
                client,
                WebSocketRequestEvents.CANVAS_LIST,
                WebSocketResponseEvents.CANVAS_LIST_RESULT,
                {requestId: uuidv4()}
            );

            expect(response.success).toBe(true);
            expect(Array.isArray(response.canvases)).toBe(true);
        });
    });

    describe('Canvas 重命名', () => {
        it('成功重命名', async () => {
            const client = getClient();
            const canvas = await createCanvas(client, 'Original Name');

            const response = await emitAndWaitResponse<CanvasRenamePayload, CanvasRenamedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_RENAME,
                WebSocketResponseEvents.CANVAS_RENAMED,
                {requestId: uuidv4(), canvasId: canvas.id, newName: 'Renamed Canvas'}
            );

            expect(response.success).toBe(true);
            expect(response.canvas!.id).toBe(canvas.id);
            expect(response.canvas!.name).toBe('Renamed Canvas');
        });

        it('不存在的 ID 時重命名失敗', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasRenamePayload, CanvasRenamedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_RENAME,
                WebSocketResponseEvents.CANVAS_RENAMED,
                {requestId: uuidv4(), canvasId: FAKE_UUID, newName: 'New Name'}
            );

            expect(response.success).toBe(false);
            expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
        });

        it('空白名稱時重命名失敗', async () => {
            const client = getClient();
            const canvas = await createCanvas(client, 'Valid Name');

            const response = await emitAndWaitResponse<CanvasRenamePayload, CanvasRenamedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_RENAME,
                WebSocketResponseEvents.CANVAS_RENAMED,
                {requestId: uuidv4(), canvasId: canvas.id, newName: ''}
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('無效名稱時重命名失敗', async () => {
            const client = getClient();
            const createResponse = await emitAndWaitResponse<CanvasCreatePayload, CanvasCreatedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_CREATE,
                WebSocketResponseEvents.CANVAS_CREATED,
                {requestId: uuidv4(), name: 'Valid_Name_2'}
            );

            expect(createResponse.success).toBe(true);
            const canvas = createResponse.canvas!;

            const response = await emitAndWaitResponse<CanvasRenamePayload, CanvasRenamedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_RENAME,
                WebSocketResponseEvents.CANVAS_RENAMED,
                {requestId: uuidv4(), canvasId: canvas.id, newName: 'Invalid@Name!'}
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('重複名稱時重命名失敗', async () => {
            const client = getClient();
            await createCanvas(client, 'Canvas_One');
            const canvas2 = await createCanvas(client, 'Canvas_Two');
            const response = await emitAndWaitResponse<CanvasRenamePayload, CanvasRenamedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_RENAME,
                WebSocketResponseEvents.CANVAS_RENAMED,
                {requestId: uuidv4(), canvasId: canvas2.id, newName: 'Canvas_One'}
            );

            expect(response.success).toBe(false);
            expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
        });
    });

    describe('Canvas 刪除', () => {
        it('成功刪除', async () => {
            const client = getClient();
            const canvas = await createCanvas(client, 'To Delete');

            const response = await emitAndWaitResponse<CanvasDeletePayload, CanvasDeletedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_DELETE,
                WebSocketResponseEvents.CANVAS_DELETED,
                {requestId: uuidv4(), canvasId: canvas.id}
            );

            expect(response.success).toBe(true);
            expect(response.canvasId).toBe(canvas.id);
        });

        it('不存在的 ID 時刪除失敗', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasDeletePayload, CanvasDeletedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_DELETE,
                WebSocketResponseEvents.CANVAS_DELETED,
                {requestId: uuidv4(), canvasId: FAKE_UUID}
            );

            expect(response.success).toBe(false);
            expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
        });

        it('使用中時刪除失敗', async () => {
            const client = getClient();
            const activeCanvasId = await getCanvasId(client);

            const response = await emitAndWaitResponse<CanvasDeletePayload, CanvasDeletedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_DELETE,
                WebSocketResponseEvents.CANVAS_DELETED,
                {requestId: uuidv4(), canvasId: activeCanvasId}
            );

            expect(response.success).toBe(false);
            expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
        });
    });

    describe('Canvas 切換', () => {
        it('成功切換', async () => {
            const client = getClient();
            const canvas = await createCanvas(client, 'Switch Target');

            const response = await emitAndWaitResponse<CanvasSwitchPayload, CanvasSwitchedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_SWITCH,
                WebSocketResponseEvents.CANVAS_SWITCHED,
                {requestId: uuidv4(), canvasId: canvas.id}
            );

            expect(response.success).toBe(true);
            expect(response.canvasId).toBe(canvas.id);
        });

        it('不存在的 ID 時切換失敗', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasSwitchPayload, CanvasSwitchedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_SWITCH,
                WebSocketResponseEvents.CANVAS_SWITCHED,
                {requestId: uuidv4(), canvasId: FAKE_UUID}
            );

            expect(response.success).toBe(false);
            expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
        });
    });

    describe('Canvas 排序', () => {
        it('成功重新排序', async () => {
            const client = getClient();
            await listCanvases(client);
            const canvasA = await createCanvas(client, 'Canvas A');
            const canvasB = await createCanvas(client, 'Canvas B');
            const canvasC = await createCanvas(client, 'Canvas C');
            const allCanvases = await listCanvases(client);
            const allIds = allCanvases.map(c => c.id);
            const otherIds = allIds.filter(id => id !== canvasA.id && id !== canvasB.id && id !== canvasC.id);
            const newOrder = [canvasC.id, canvasA.id, canvasB.id, ...otherIds];
            const reorderResponse = await reorderCanvases(client, newOrder);
            expect(reorderResponse.success).toBe(true);
            const canvases = await listCanvases(client);
            const ids = canvases.map(c => c.id);
            expect(ids.indexOf(canvasC.id)).toBeLessThan(ids.indexOf(canvasA.id));
            expect(ids.indexOf(canvasA.id)).toBeLessThan(ids.indexOf(canvasB.id));
        });

        it('列表回傳排序後的順序', async () => {
            const client = getClient();
            const canvas1 = await createCanvas(client, 'Canvas 1');
            const canvas2 = await createCanvas(client, 'Canvas 2');
            const canvas3 = await createCanvas(client, 'Canvas 3');
            const allCanvases = await listCanvases(client);
            const allIds = allCanvases.map(c => c.id);
            const otherIds = allIds.filter(id => id !== canvas1.id && id !== canvas2.id && id !== canvas3.id);
            const newOrder = [canvas3.id, canvas1.id, canvas2.id, ...otherIds];
            await reorderCanvases(client, newOrder);
            const canvases = await listCanvases(client);

            for (let i = 0; i < canvases.length - 1; i++) {
                expect(canvases[i].sortIndex).toBeLessThan(canvases[i + 1].sortIndex);
            }
        });

        it('新 Canvas 新增到最後', async () => {
            const client = getClient();
            const canvas1 = await createCanvas(client, 'Canvas X');
            const canvas2 = await createCanvas(client, 'Canvas Y');
            const allCanvases1 = await listCanvases(client);
            const allIds1 = allCanvases1.map(c => c.id);
            const otherIds1 = allIds1.filter(id => id !== canvas1.id && id !== canvas2.id);
            await reorderCanvases(client, [canvas2.id, canvas1.id, ...otherIds1]);
            const newCanvas = await createCanvas(client, 'Canvas Z');
            const canvases = await listCanvases(client);
            const newCanvasInList = canvases.find(c => c.id === newCanvas.id);
            expect(newCanvasInList).toBeDefined();
            const maxSortIndex = Math.max(...canvases.map(c => c.sortIndex));
            expect(newCanvasInList!.sortIndex).toBe(maxSortIndex);
            expect(canvases[canvases.length - 1].id).toBe(newCanvas.id);
        });

        it('無效 ID 時排序失敗', async () => {
            const client = getClient();
            const canvas = await createCanvas(client, 'Valid Canvas');
            const response = await emitAndWaitResponse<CanvasReorderPayload, CanvasReorderedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_REORDER,
                WebSocketResponseEvents.CANVAS_REORDERED,
                {requestId: uuidv4(), canvasIds: [canvas.id, FAKE_UUID]}
            );

            expect(response.success).toBe(false);
            expect(response.error).toBeDefined();
        });

        it('空陣列時排序失敗', async () => {
            const client = getClient();
            const response = await emitAndWaitResponse<CanvasReorderPayload, CanvasReorderedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_REORDER,
                WebSocketResponseEvents.CANVAS_REORDERED,
                {requestId: uuidv4(), canvasIds: []}
            );

            expect(response.success).toBe(false);
        });

        it('部分 ID 時成功排序', async () => {
            const client = getClient();
            // 建立 3 個 Canvas
            const canvasP1 = await createCanvas(client, 'Partial_1');
            const canvasP2 = await createCanvas(client, 'Partial_2');
            const canvasP3 = await createCanvas(client, 'Partial_3');

            // 取得所有 Canvas
            await listCanvases(client);

            // 只排序其中 2 個 Canvas（P2, P1），P3 和其他 Canvas 保持原順序
            const partialOrder = [canvasP2.id, canvasP1.id];

            // 重新排序
            const reorderResponse = await reorderCanvases(client, partialOrder);
            expect(reorderResponse.success).toBe(true);

            // 取得列表並驗證順序
            const canvases = await listCanvases(client);
            const ids = canvases.map(c => c.id);

            // P2 應該在 P1 之前
            expect(ids.indexOf(canvasP2.id)).toBeLessThan(ids.indexOf(canvasP1.id));

            // P3 應該在 P1 和 P2 之後（因為沒被包含在排序中）
            expect(ids.indexOf(canvasP1.id)).toBeLessThan(ids.indexOf(canvasP3.id));
        });

        it('重複 ID 時排序失敗', async () => {
            const client = getClient();
            // 建立 1 個 Canvas
            const canvas = await createCanvas(client, 'Duplicate_Test');

            // 嘗試用包含重複 ID 的陣列排序
            const response = await emitAndWaitResponse<CanvasReorderPayload, CanvasReorderedPayload>(
                client,
                WebSocketRequestEvents.CANVAS_REORDER,
                WebSocketResponseEvents.CANVAS_REORDERED,
                {requestId: uuidv4(), canvasIds: [canvas.id, canvas.id]}
            );

            expect(response.success).toBe(false);
            expect(response.error).toEqual(expect.objectContaining({ key: expect.any(String) }));
        });
    });
});
