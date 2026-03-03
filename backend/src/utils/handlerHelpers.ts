import type { WebSocketResponseEvents } from '../schemas/index.js';
import type { Pod, Result } from '../types/index.js';
import { podStore } from '../services/podStore.js';
import { canvasStore } from '../services/canvasStore.js';
import { socketService } from '../services/socketService.js';
import { emitError, emitNotFound } from './websocketResponse.js';
import { logger, type LogCategory } from './logger.js';

export function handleResultError<T>(
	result: Result<T>,
	connectionId: string,
	event: WebSocketResponseEvents,
	requestId: string,
	fallbackError: string,
	errorCode?: string
): result is { success: false; error: string } {
	if (!result.success) {
		emitError(connectionId, event, result.error ?? fallbackError, requestId, undefined, errorCode ?? 'INTERNAL_ERROR');
		return true;
	}
	return false;
}

export function getCanvasId(
	connectionId: string,
	responseEvent: WebSocketResponseEvents,
	requestId: string
): string | undefined {
	const canvasId = canvasStore.getActiveCanvas(connectionId);

	if (!canvasId) {
		emitError(connectionId, responseEvent, '找不到使用中的 Canvas', requestId, undefined, 'INTERNAL_ERROR');
		return undefined;
	}

	return canvasId;
}

export type HandlerWithCanvasId<TPayload = unknown> = (
	connectionId: string,
	canvasId: string,
	payload: TPayload,
	requestId: string
) => Promise<void>;

export type StandardHandler<TPayload = unknown> = (
	connectionId: string,
	payload: TPayload,
	requestId: string
) => Promise<void>;

export function withCanvasId<TPayload = unknown>(
	responseEvent: WebSocketResponseEvents,
	handler: HandlerWithCanvasId<TPayload>
): StandardHandler<TPayload> {
	return async (connectionId: string, payload: TPayload, requestId: string): Promise<void> => {
		const canvasId = getCanvasId(connectionId, responseEvent, requestId);
		if (!canvasId) {
			return;
		}

		await handler(connectionId, canvasId, payload, requestId);
	};
}

export function validatePod(
	connectionId: string,
	podId: string,
	responseEvent: WebSocketResponseEvents,
	requestId: string
): Pod | undefined {
	const canvasId = getCanvasId(connectionId, responseEvent, requestId);
	if (!canvasId) {
		return undefined;
	}

	const pod = podStore.getById(canvasId, podId);

	if (!pod) {
		emitNotFound(connectionId, responseEvent, 'Pod', podId, requestId);
		return undefined;
	}

	return pod;
}

interface ResourceDeleteConfig {
	connectionId: string;
	requestId: string;
	resourceId: string;
	resourceName: LogCategory;
	responseEvent: WebSocketResponseEvents;
	existsCheck: () => Promise<boolean>;
	findPodsUsing: (canvasId: string) => Pod[];
	deleteNotes: (canvasId: string) => string[];
	deleteResource: () => Promise<void>;
	idFieldName?: string;
}

export function getPodDisplayName(canvasId: string, podId: string): string {
	return podStore.getById(canvasId, podId)?.name ?? podId;
}

export function emitPodUpdated(canvasId: string, podId: string, requestId: string, event: WebSocketResponseEvents): void {
	const updatedPod = podStore.getById(canvasId, podId);
	socketService.emitToCanvas(canvasId, event, {
		requestId,
		canvasId,
		success: true,
		pod: updatedPod,
	});
}

export async function handleResourceDelete(config: ResourceDeleteConfig): Promise<void> {
	const {
		connectionId,
		requestId,
		resourceId,
		resourceName,
		responseEvent,
		existsCheck,
		findPodsUsing,
		deleteNotes,
		deleteResource,
		idFieldName,
	} = config;

	const canvasId = getCanvasId(connectionId, responseEvent, requestId);
	if (!canvasId) {
		return;
	}

	const exists = await existsCheck();
	if (!exists) {
		emitNotFound(connectionId, responseEvent, resourceName, resourceId, requestId);
		return;
	}

	const podsUsing = findPodsUsing(canvasId);
	if (podsUsing.length > 0) {
		emitError(
			connectionId,
			responseEvent,
			`${resourceName} 正在被 ${podsUsing.length} 個 Pod 使用中，無法刪除`,
			requestId,
			undefined,
			'IN_USE'
		);
		return;
	}

	const deletedNoteIds = deleteNotes(canvasId);
	await deleteResource();

	const fieldName = idFieldName ?? `${resourceName.toLowerCase()}Id`;
	const response = {
		requestId,
		success: true,
		[fieldName]: resourceId,
		deletedNoteIds,
	};

	socketService.emitToAll(responseEvent, response);

	logger.log(resourceName, 'Delete', `已刪除 ${resourceName.toLowerCase()}「${resourceId}」及 ${deletedNoteIds.length} 個 Note`);
}
