import { connectionStore } from '../services/connectionStore.js';
import { podStore } from '../services/podStore.js';
import { jsonResponse, requireCanvas, requireJsonBody, UUID_REGEX } from './apiHelpers.js';
import { socketService } from '../services/socketService.js';
import { workflowStateService } from '../services/workflow/index.js';
import { logger } from '../utils/logger.js';
import { HTTP_STATUS } from '../constants.js';
import { WebSocketResponseEvents } from '../schemas/index.js';
import type { AnchorPosition, TriggerMode } from '../types/connection.js';
import type {
	ConnectionCreatedPayload,
	ConnectionDeletedPayload,
	ConnectionUpdatedPayload,
	PodScheduleSetPayload,
} from '../types/index.js';

const VALID_ANCHORS: AnchorPosition[] = ['top', 'bottom', 'left', 'right'];
const VALID_TRIGGER_MODES: TriggerMode[] = ['auto', 'ai-decide', 'direct'];

interface ValidatedCreateConnectionBody {
	sourcePodId: string;
	targetPodId: string;
	sourceAnchor: AnchorPosition;
	targetAnchor: AnchorPosition;
}

interface ValidatedUpdateConnectionBody {
	triggerMode: TriggerMode;
}

function validateCreateConnectionBody(
	data: Record<string, unknown>,
): { error: string } | ValidatedCreateConnectionBody {
	if (!data.sourcePodId || typeof data.sourcePodId !== 'string') {
		return { error: '缺少必要欄位：sourcePodId' };
	}
	if (!UUID_REGEX.test(data.sourcePodId)) {
		return { error: 'sourcePodId 格式無效' };
	}
	if (!data.targetPodId || typeof data.targetPodId !== 'string') {
		return { error: '缺少必要欄位：targetPodId' };
	}
	if (!UUID_REGEX.test(data.targetPodId)) {
		return { error: 'targetPodId 格式無效' };
	}
	if (!data.sourceAnchor || typeof data.sourceAnchor !== 'string') {
		return { error: '缺少必要欄位：sourceAnchor' };
	}
	if (!data.targetAnchor || typeof data.targetAnchor !== 'string') {
		return { error: '缺少必要欄位：targetAnchor' };
	}
	if (!VALID_ANCHORS.includes(data.sourceAnchor as AnchorPosition)) {
		return { error: `無效的 sourceAnchor 值，必須為 ${VALID_ANCHORS.join('/')}` };
	}
	if (!VALID_ANCHORS.includes(data.targetAnchor as AnchorPosition)) {
		return { error: `無效的 targetAnchor 值，必須為 ${VALID_ANCHORS.join('/')}` };
	}

	return {
		sourcePodId: data.sourcePodId,
		targetPodId: data.targetPodId,
		sourceAnchor: data.sourceAnchor as AnchorPosition,
		targetAnchor: data.targetAnchor as AnchorPosition,
	};
}

function validateUpdateConnectionBody(
	data: Record<string, unknown>,
): { error: string } | ValidatedUpdateConnectionBody {
	if (!data.triggerMode || typeof data.triggerMode !== 'string') {
		return { error: '缺少必要欄位：triggerMode' };
	}
	if (!VALID_TRIGGER_MODES.includes(data.triggerMode as TriggerMode)) {
		return { error: `無效的 triggerMode 值，必須為 ${VALID_TRIGGER_MODES.join('/')}` };
	}

	return { triggerMode: data.triggerMode as TriggerMode };
}

export function handleListConnections(_req: Request, params: Record<string, string>): Response {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const connections = connectionStore.list(canvas.id);
	return jsonResponse({ connections }, HTTP_STATUS.OK);
}

export async function handleCreateConnection(req: Request, params: Record<string, string>): Promise<Response> {
	const jsonError = requireJsonBody(req);
	if (jsonError) return jsonError;

	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const body = await req.json() as Record<string, unknown>;

	const validated = validateCreateConnectionBody(body);
	if ('error' in validated) {
		return jsonResponse({ error: validated.error }, HTTP_STATUS.BAD_REQUEST);
	}

	const { sourcePodId, targetPodId, sourceAnchor, targetAnchor } = validated;

	const sourcePod = podStore.getById(canvas.id, sourcePodId);
	if (!sourcePod) {
		return jsonResponse({ error: '來源 Pod 找不到' }, HTTP_STATUS.NOT_FOUND);
	}

	const targetPod = podStore.getById(canvas.id, targetPodId);
	if (!targetPod) {
		return jsonResponse({ error: '目標 Pod 找不到' }, HTTP_STATUS.NOT_FOUND);
	}

	const connection = connectionStore.create(canvas.id, { sourcePodId, sourceAnchor, targetPodId, targetAnchor });

	const connectionCreatedPayload: ConnectionCreatedPayload = {
		requestId: 'system',
		canvasId: canvas.id,
		success: true,
		connection,
	};
	socketService.emitToCanvas(canvas.id, WebSocketResponseEvents.CONNECTION_CREATED, connectionCreatedPayload);

	if (targetPod.schedule) {
		const result = podStore.update(canvas.id, targetPodId, { schedule: null });

		if (result) {
			const podSchedulePayload: PodScheduleSetPayload = {
				requestId: '',
				canvasId: canvas.id,
				success: true,
				pod: result.pod,
			};
			socketService.emitToCanvas(canvas.id, WebSocketResponseEvents.POD_SCHEDULE_SET, podSchedulePayload);

			logger.log('Connection', 'Create', `已清除目標 Pod「${targetPod.name}」的排程（現為下游節點）`);
		}
	}

	logger.log('Connection', 'Create', `已建立連線「${sourcePod.name} → ${targetPod.name}」`);

	return jsonResponse({ connection }, HTTP_STATUS.CREATED);
}

export async function handleDeleteConnection(_req: Request, params: Record<string, string>): Promise<Response> {
	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const { connectionId } = params;

	const connection = connectionStore.getById(canvas.id, connectionId);
	if (!connection) {
		return jsonResponse({ error: '找不到 Connection' }, HTTP_STATUS.NOT_FOUND);
	}

	workflowStateService.handleConnectionDeletion(canvas.id, connectionId);

	connectionStore.delete(canvas.id, connectionId);

	const connectionDeletedPayload: ConnectionDeletedPayload = {
		requestId: 'system',
		canvasId: canvas.id,
		success: true,
		connectionId,
	};
	socketService.emitToCanvas(canvas.id, WebSocketResponseEvents.CONNECTION_DELETED, connectionDeletedPayload);

	logger.log('Connection', 'Delete', `已刪除連線（connectionId: ${connectionId}）`);

	return jsonResponse({ success: true }, HTTP_STATUS.OK);
}

export async function handleUpdateConnection(req: Request, params: Record<string, string>): Promise<Response> {
	const jsonError = requireJsonBody(req);
	if (jsonError) return jsonError;

	const { canvas, error } = requireCanvas(params.id);
	if (error) return error;

	const { connectionId } = params;

	const connection = connectionStore.getById(canvas.id, connectionId);
	if (!connection) {
		return jsonResponse({ error: '找不到 Connection' }, HTTP_STATUS.NOT_FOUND);
	}

	const body = await req.json() as Record<string, unknown>;

	const validated = validateUpdateConnectionBody(body);
	if ('error' in validated) {
		return jsonResponse({ error: validated.error }, HTTP_STATUS.BAD_REQUEST);
	}

	const updatedConnection = connectionStore.update(canvas.id, connectionId, { triggerMode: validated.triggerMode });

	if (!updatedConnection) {
		return jsonResponse({ error: '更新 Connection 時發生內部錯誤' }, HTTP_STATUS.INTERNAL_ERROR);
	}

	const connectionUpdatedPayload: ConnectionUpdatedPayload = {
		requestId: 'system',
		canvasId: canvas.id,
		success: true,
		connection: updatedConnection,
	};
	socketService.emitToCanvas(canvas.id, WebSocketResponseEvents.CONNECTION_UPDATED, connectionUpdatedPayload);

	return jsonResponse({ connection: updatedConnection }, HTTP_STATUS.OK);
}
