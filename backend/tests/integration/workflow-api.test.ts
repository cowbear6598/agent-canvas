import { setupIntegrationTest } from '../setup';
import { postCanvas, postPod } from '../helpers';
import { v4 as uuidv4 } from 'uuid';

async function createConnectionRest(
	baseUrl: string,
	canvasId: string,
	sourcePodId: string,
	targetPodId: string,
) {
	return fetch(`${baseUrl}/api/canvas/${canvasId}/connections`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			sourcePodId,
			targetPodId,
			sourceAnchor: 'right',
			targetAnchor: 'left',
		}),
	});
}

async function fetchWorkflows(baseUrl: string, canvasId: string) {
	return fetch(`${baseUrl}/api/canvas/${canvasId}/workflows`);
}

async function postWorkflowChat(
	baseUrl: string,
	canvasId: string,
	podId: string,
	body: unknown,
	contentType = 'application/json',
) {
	return fetch(`${baseUrl}/api/canvas/${canvasId}/workflows/${encodeURIComponent(podId)}/chat`, {
		method: 'POST',
		headers: { 'Content-Type': contentType },
		body: contentType === 'application/json' ? JSON.stringify(body) : String(body),
	});
}

async function postWorkflowStop(baseUrl: string, canvasId: string, podId: string) {
	return fetch(`${baseUrl}/api/canvas/${canvasId}/workflows/${encodeURIComponent(podId)}/stop`, {
		method: 'POST',
	});
}

describe('GET /api/canvas/:id/workflows', () => {
	const { getServer } = setupIntegrationTest();

	it('沒有 Pod 時回傳空陣列', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-empty-canvas' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(Array.isArray(body.workflows)).toBe(true);
		expect(body.workflows).toHaveLength(0);
	});

	it('單一獨立 Pod 視為一個 workflow', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-single-pod' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(1);
		expect(body.workflows[0].workflowId).toBe(pod.id);
		expect(body.workflows[0].entryPod.id).toBe(pod.id);
		expect(body.workflows[0].nodes.children).toHaveLength(0);
	});

	it('兩個獨立 Pod 回傳兩個 workflow', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-two-pods' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 100, y: 0 });

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(2);
	});

	it('A → B 線性鏈路，僅回傳 A 作為入口', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-linear-ab' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podARes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		const { pod: podA } = await podARes.json();
		const podBRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 100, y: 0 });
		const { pod: podB } = await podBRes.json();

		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podB.id);

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(1);
		expect(body.workflows[0].entryPod.id).toBe(podA.id);
		expect(body.workflows[0].nodes.children).toHaveLength(1);
		expect(body.workflows[0].nodes.children[0].pod.id).toBe(podB.id);
	});

	it('A → B → C 多層鏈路，僅回傳 A 作為入口', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-linear-abc' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podARes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		const { pod: podA } = await podARes.json();
		const podBRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 100, y: 0 });
		const { pod: podB } = await podBRes.json();
		const podCRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod C', x: 200, y: 0 });
		const { pod: podC } = await podCRes.json();

		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podB.id);
		await createConnectionRest(server.baseUrl, canvas.id, podB.id, podC.id);

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(1);
		expect(body.workflows[0].entryPod.id).toBe(podA.id);

		const nodesB = body.workflows[0].nodes.children[0];
		expect(nodesB.pod.id).toBe(podB.id);
		expect(nodesB.children[0].pod.id).toBe(podC.id);
	});

	it('兩條獨立鏈路 A → B 和 C → D，回傳兩個 workflow', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-two-chains' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podARes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		const { pod: podA } = await podARes.json();
		const podBRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 100, y: 0 });
		const { pod: podB } = await podBRes.json();
		const podCRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod C', x: 200, y: 0 });
		const { pod: podC } = await podCRes.json();
		const podDRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod D', x: 300, y: 0 });
		const { pod: podD } = await podDRes.json();

		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podB.id);
		await createConnectionRest(server.baseUrl, canvas.id, podC.id, podD.id);

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(2);

		const entryIds = body.workflows.map((w: { entryPod: { id: string } }) => w.entryPod.id);
		expect(entryIds).toContain(podA.id);
		expect(entryIds).toContain(podC.id);
	});

	it('扇出結構 A → B, A → C，僅回傳 A 作為入口，有 2 個 children', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-fanout' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podARes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		const { pod: podA } = await podARes.json();
		const podBRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 100, y: 0 });
		const { pod: podB } = await podBRes.json();
		const podCRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod C', x: 100, y: 100 });
		const { pod: podC } = await podCRes.json();

		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podB.id);
		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podC.id);

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(1);
		expect(body.workflows[0].entryPod.id).toBe(podA.id);
		expect(body.workflows[0].nodes.children).toHaveLength(2);

		const childIds = body.workflows[0].nodes.children.map((c: { pod: { id: string } }) => c.pod.id);
		expect(childIds).toContain(podB.id);
		expect(childIds).toContain(podC.id);
	});

	it('匯流結構 A → C, B → C，回傳 A 和 B 各為獨立 workflow 的入口', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-merge' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podARes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		const { pod: podA } = await podARes.json();
		const podBRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 0, y: 100 });
		const { pod: podB } = await podBRes.json();
		const podCRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod C', x: 200, y: 50 });
		const { pod: podC } = await podCRes.json();

		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podC.id);
		await createConnectionRest(server.baseUrl, canvas.id, podB.id, podC.id);

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(2);

		const entryIds = body.workflows.map((w: { entryPod: { id: string } }) => w.entryPod.id);
		expect(entryIds).toContain(podA.id);
		expect(entryIds).toContain(podB.id);

		for (const workflow of body.workflows) {
			expect(workflow.nodes.children).toHaveLength(1);
			expect(workflow.nodes.children[0].pod.id).toBe(podC.id);
		}
	});

	it('有 slackBinding 的 Pod 不出現在 workflow list 中', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-slack-binding' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Slack Pod', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		await podStoreModule.setSlackBinding(canvas.id, pod.id, {
			slackAppId: 'test-slack-app-id',
			slackChannelId: 'test-channel-id',
		});

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(0);
	});

	it('有 telegramBinding 的 Pod 不出現在 workflow list 中', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-telegram-binding' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Telegram Pod', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		await podStoreModule.setTelegramBinding(canvas.id, pod.id, {
			telegramBotId: 'test-bot-id',
			telegramChatId: 123456789,
			chatType: 'private',
		});

		const response = await fetchWorkflows(server.baseUrl, canvas.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.workflows).toHaveLength(0);
	});

	it('Canvas 不存在回傳 404', async () => {
		const server = getServer();
		const response = await fetchWorkflows(server.baseUrl, uuidv4());
		expect(response.status).toBe(404);

		const body = await response.json();
		expect(body.error).toBe('找不到 Canvas');
	});

	it('使用 Canvas name 查詢成功', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-by-name' });
		expect(createRes.status).toBe(201);

		const response = await fetchWorkflows(server.baseUrl, 'workflow-by-name');
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(Array.isArray(body.workflows)).toBe(true);
	});
});

describe('POST /api/canvas/:id/workflows/:podId/chat', () => {
	const { getServer } = setupIntegrationTest();

	it('成功發送 string 訊息回傳 202', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-202' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: 'hello' });
		expect(response.status).toBe(202);

		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.podId).toBe(pod.id);
	});

	it('body 包含 ContentBlock[] 類型 message 成功', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-content-block' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const contentBlocks = [{ type: 'text', text: 'hello from content block' }];
		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: contentBlocks });
		expect(response.status).toBe(202);

		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.podId).toBe(pod.id);
	});

	it('Canvas 不存在回傳 404', async () => {
		const server = getServer();
		const response = await postWorkflowChat(server.baseUrl, uuidv4(), uuidv4(), { message: 'hello' });
		expect(response.status).toBe(404);

		const body = await response.json();
		expect(body.error).toBe('找不到 Canvas');
	});

	it('Pod 不存在回傳 404', async () => {
		const server = getServer();
		const response = await postWorkflowChat(server.baseUrl, server.canvasId, uuidv4(), { message: 'hello' });
		expect(response.status).toBe(404);

		const body = await response.json();
		expect(body.error).toBe('找不到 Pod');
	});

	it('Pod 不是入口 Pod 回傳 400', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-not-entry' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podARes = await postPod(server.baseUrl, canvas.id, { name: 'Pod A', x: 0, y: 0 });
		const { pod: podA } = await podARes.json();
		const podBRes = await postPod(server.baseUrl, canvas.id, { name: 'Pod B', x: 100, y: 0 });
		const { pod: podB } = await podBRes.json();

		await createConnectionRest(server.baseUrl, canvas.id, podA.id, podB.id);

		const response = await postWorkflowChat(server.baseUrl, canvas.id, podB.id, { message: 'hello' });
		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.error).toContain('不是 Workflow 入口');
	});

	it('Pod 正在 chatting 狀態回傳 409', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-chatting' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		podStoreModule.setStatus(canvas.id, pod.id, 'chatting');

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: 'hello' });
		expect(response.status).toBe(409);

		const body = await response.json();
		expect(body.error).toBe('Pod 目前正在忙碌中，請稍後再試');

		podStoreModule.setStatus(canvas.id, pod.id, 'idle');
	});

	it('Pod 正在 summarizing 狀態回傳 409', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-summarizing' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		podStoreModule.setStatus(canvas.id, pod.id, 'summarizing');

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: 'hello' });
		expect(response.status).toBe(409);

		const body = await response.json();
		expect(body.error).toBe('Pod 目前正在忙碌中，請稍後再試');

		podStoreModule.setStatus(canvas.id, pod.id, 'idle');
	});

	it('缺少 message 欄位回傳 400', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-no-msg' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, {});
		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.error).toBe('訊息格式錯誤');
	});

	it('message 為空字串回傳 400', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-empty-msg' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: '' });
		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.error).toBe('訊息格式錯誤');
	});

	it('無效 JSON body 回傳 400', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-invalid-json' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Entry Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, 'not json', 'text/plain');
		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.error).toBe('無效的請求格式');
	});

	it('Pod 有 slackBinding 時回傳 400', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-slack-binding' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Slack Pod', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		await podStoreModule.setSlackBinding(canvas.id, pod.id, {
			slackAppId: 'test-slack-app-id',
			slackChannelId: 'test-channel-id',
		});

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: 'hello' });
		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.error).toContain('Slack');
	});

	it('Pod 有 telegramBinding 時回傳 400', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-telegram-binding' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Telegram Pod', x: 0, y: 0 });
		expect(podRes.status).toBe(201);
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		await podStoreModule.setTelegramBinding(canvas.id, pod.id, {
			telegramBotId: 'test-bot-id',
			telegramChatId: 123456789,
			chatType: 'private',
		});

		const response = await postWorkflowChat(server.baseUrl, canvas.id, pod.id, { message: 'hello' });
		expect(response.status).toBe(400);

		const body = await response.json();
		expect(body.error).toContain('Telegram');
	});

	it('使用 Canvas name 和 Pod name 發送成功', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-chat-by-name' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		await postPod(server.baseUrl, canvas.id, { name: 'Named Entry Pod', x: 0, y: 0 });

		const response = await postWorkflowChat(
			server.baseUrl,
			'workflow-chat-by-name',
			'Named Entry Pod',
			{ message: 'hello' },
		);
		expect(response.status).toBe(202);

		const body = await response.json();
		expect(body.success).toBe(true);
	});
});

describe('POST /api/canvas/:id/workflows/:podId/stop', () => {
	const { getServer } = setupIntegrationTest();

	it('Canvas 不存在回傳 404', async () => {
		const server = getServer();
		const response = await postWorkflowStop(server.baseUrl, uuidv4(), uuidv4());
		expect(response.status).toBe(404);

		const body = await response.json();
		expect(body.error).toBe('找不到 Canvas');
	});

	it('Pod 不存在回傳 404', async () => {
		const server = getServer();
		const response = await postWorkflowStop(server.baseUrl, server.canvasId, uuidv4());
		expect(response.status).toBe(404);

		const body = await response.json();
		expect(body.error).toBe('找不到 Pod');
	});

	it('Pod 不在 chatting 狀態回傳 409', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-stop-idle' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Idle Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const response = await postWorkflowStop(server.baseUrl, canvas.id, pod.id);
		expect(response.status).toBe(409);

		const body = await response.json();
		expect(body.error).toBe('Pod 目前不在對話中，無法中斷');
	});

	it('使用 Canvas name 和 Pod name 操作成功', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-stop-by-name' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Stop Pod By Name', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		podStoreModule.setStatus(canvas.id, pod.id, 'chatting');

		const response = await postWorkflowStop(server.baseUrl, 'workflow-stop-by-name', 'Stop Pod By Name');
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.success).toBe(true);
	});

	it('成功中斷對話回傳 200', async () => {
		const server = getServer();
		const createRes = await postCanvas(server.baseUrl, { name: 'workflow-stop-success' });
		expect(createRes.status).toBe(201);
		const { canvas } = await createRes.json();

		const podRes = await postPod(server.baseUrl, canvas.id, { name: 'Chatting Pod', x: 0, y: 0 });
		const { pod } = await podRes.json();

		const { podStore: podStoreModule } = await import('../../src/services/podStore.js');
		podStoreModule.setStatus(canvas.id, pod.id, 'chatting');

		const response = await postWorkflowStop(server.baseUrl, canvas.id, pod.id);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.success).toBe(true);
	});
});
