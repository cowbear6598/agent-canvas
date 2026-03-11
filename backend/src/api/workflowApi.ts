import { jsonResponse, requireCanvas, resolvePod, requireJsonBody } from './apiHelpers.js';
import { podStore } from '../services/podStore.js';
import { connectionStore } from '../services/connectionStore.js';
import { claudeService } from '../services/claude/claudeService.js';
import { executeStreamingChat } from '../services/claude/streamingChatExecutor.js';
import { onChatComplete, onChatAborted } from '../utils/chatCallbacks.js';
import { injectUserMessage } from '../utils/chatHelpers.js';
import { logger } from '../utils/logger.js';
import { HTTP_STATUS } from '../constants.js';
import type { Pod, ContentBlock } from '../types/index.js';
import { isPodBusy } from '../types/index.js';
import type { Connection } from '../types/connection.js';

interface WorkflowNode {
	pod: Pod;
	connections: Connection[];
	children: WorkflowNode[];
}

interface WorkflowInfo {
	workflowId: string;
	entryPod: Pod;
	nodes: WorkflowNode;
}

function buildWorkflowNode(
	pod: Pod,
	adjacencyMap: Map<string, Connection[]>,
	podMap: Map<string, Pod>,
	visited: Set<string>,
): WorkflowNode {
	visited.add(pod.id);

	const outboundConnections = adjacencyMap.get(pod.id) ?? [];
	const children: WorkflowNode[] = [];

	for (const connection of outboundConnections) {
		const targetPod = podMap.get(connection.targetPodId);
		if (!targetPod || visited.has(targetPod.id)) continue;

		children.push(buildWorkflowNode(targetPod, adjacencyMap, podMap, visited));
	}

	return { pod, connections: outboundConnections, children };
}

export function buildWorkflows(canvasId: string): WorkflowInfo[] {
	const pods = podStore.list(canvasId);
	const connections = connectionStore.list(canvasId);

	const podMap = new Map<string, Pod>(pods.map(p => [p.id, p]));

	const adjacencyMap = new Map<string, Connection[]>();
	const inboundSet = new Set<string>();

	for (const connection of connections) {
		const existing = adjacencyMap.get(connection.sourcePodId) ?? [];
		existing.push(connection);
		adjacencyMap.set(connection.sourcePodId, existing);
		inboundSet.add(connection.targetPodId);
	}

	const entryPods = pods.filter(p => !inboundSet.has(p.id) && !p.integrationBindings?.length);

	return entryPods.map(entryPod => {
		const visited = new Set<string>();
		const nodes = buildWorkflowNode(entryPod, adjacencyMap, podMap, visited);
		return {
			workflowId: entryPod.id,
			entryPod,
			nodes,
		};
	});
}


function validateMessage(message: unknown): string | null {
	if (message === undefined || message === null) {
		return '訊息格式錯誤';
	}
	if (typeof message === 'string') {
		if (message.length === 0) return '訊息格式錯誤';
		if (message.length > 10000) return '訊息格式錯誤';
		return null;
	}
	if (Array.isArray(message)) {
		if (message.length === 0) return '訊息格式錯誤';
		for (const block of message) {
			if (!block || typeof block !== 'object') return '訊息格式錯誤';
			const typedBlock = block as Record<string, unknown>;
			if (typedBlock.type !== 'text' && typedBlock.type !== 'image') return '訊息格式錯誤';
		}
		return null;
	}
	return '訊息格式錯誤';
}

export function handleListWorkflows(_req: Request, params: Record<string, string>): Response {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const workflows = buildWorkflows(canvas.id);
	return jsonResponse({ workflows }, HTTP_STATUS.OK);
}

export async function handleWorkflowChat(req: Request, params: Record<string, string>): Promise<Response> {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const jsonError = requireJsonBody(req);
	if (jsonError) return jsonError;

	const pod = resolvePod(canvas.id, decodeURIComponent(params.podId));
	if (!pod) {
		return jsonResponse({ error: '找不到 Pod' }, HTTP_STATUS.NOT_FOUND);
	}

	const inboundConnections = connectionStore.findByTargetPodId(canvas.id, pod.id);
	if (inboundConnections.length > 0) {
		return jsonResponse({ error: '此 Pod 不是 Workflow 入口，無法直接發送訊息' }, HTTP_STATUS.BAD_REQUEST);
	}

	if (pod.integrationBindings?.length) {
		return jsonResponse({ error: 'Pod 已連接外部服務，無法手動發送訊息' }, HTTP_STATUS.BAD_REQUEST);
	}

	if (isPodBusy(pod.status)) {
		return jsonResponse({ error: 'Pod 目前正在忙碌中，請稍後再試' }, HTTP_STATUS.CONFLICT);
	}

	const body = await req.json() as Record<string, unknown>;
	const { message } = body;

	const messageError = validateMessage(message);
	if (messageError) {
		return jsonResponse({ error: messageError }, HTTP_STATUS.BAD_REQUEST);
	}

	const typedMessage = message as string | ContentBlock[];
	const podName = pod.name;
	const canvasId = canvas.id;
	const podId = pod.id;

	void (async (): Promise<void> => {
		try {
			await injectUserMessage({ canvasId, podId, content: typedMessage });

			await executeStreamingChat(
				{ canvasId, podId, message: typedMessage, abortable: true },
				{
					onComplete: onChatComplete,
					onAborted: (abortedCanvasId, abortedPodId, messageId) =>
						onChatAborted(abortedCanvasId, abortedPodId, messageId, podName),
				},
			);
		} catch (err) {
			logger.error('Chat', 'Error', `Pod「${podName}」REST API 發送訊息失敗`, err);
			try {
				podStore.setStatus(canvasId, podId, 'idle');
			} catch {
				// 忽略 setStatus 失敗，避免在伺服器關閉時產生 unhandled rejection
			}
		}
	})();

	return jsonResponse({ success: true, podId: pod.id }, HTTP_STATUS.ACCEPTED);
}

export function handleWorkflowStop(_req: Request, params: Record<string, string>): Response {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const pod = resolvePod(canvas.id, decodeURIComponent(params.podId));
	if (!pod) {
		return jsonResponse({ error: '找不到 Pod' }, HTTP_STATUS.NOT_FOUND);
	}

	if (pod.status !== 'chatting') {
		return jsonResponse({ error: 'Pod 目前不在對話中，無法中斷' }, HTTP_STATUS.CONFLICT);
	}

	const aborted = claudeService.abortQuery(pod.id);

	if (!aborted) {
		podStore.setStatus(canvas.id, pod.id, 'idle');
		return jsonResponse(
			{ success: true, message: '找不到活躍的查詢，已重設 Pod 狀態' },
			HTTP_STATUS.OK,
		);
	}

	return jsonResponse({ success: true }, HTTP_STATUS.OK);
}
