import { socketService } from '../services/socketService.js';
import { logger } from '../utils/logger.js';

export class WebSocketError extends Error {
	code: string;
	requestId?: string;
	podId?: string;

	constructor(code: string, message: string, requestId?: string, podId?: string) {
		super(message);
		this.name = 'WebSocketError';
		this.code = code;
		this.requestId = requestId;
		this.podId = podId;
	}
}

export interface WebSocketErrorContext {
	connectionId: string;
	responseEvent: string;
	error: unknown;
	requestId?: string;
	podId?: string;
}

export function handleWebSocketError(context: WebSocketErrorContext): void {
	let errorMessage: string;
	let errorCode: string;
	let { requestId, podId } = context;
	const { connectionId, responseEvent, error } = context;

	if (error instanceof WebSocketError) {
		errorMessage = error.message;
		errorCode = error.code;
		requestId = requestId || error.requestId;
		podId = podId || error.podId;
	} else if (error instanceof Error) {
		logger.error('WebSocket', 'Error', `內部錯誤詳細訊息: ${error.message}`);
		errorMessage = '伺服器內部錯誤';
		errorCode = 'INTERNAL_ERROR';
	} else {
		errorMessage = '發生未知錯誤';
		errorCode = 'UNKNOWN_ERROR';
	}

	const errorPayload: {
		requestId: string | undefined;
		success: false;
		error: string;
		code: string;
		podId?: string;
	} = {
		requestId,
		success: false,
		error: errorMessage,
		code: errorCode,
	};

	if (podId) {
		errorPayload.podId = podId;
	}

	socketService.emitToConnection(connectionId, responseEvent, errorPayload);

	logger.error('WebSocket', 'Error', `事件: ${responseEvent}, 錯誤碼: ${errorCode}, 訊息: ${errorMessage}`);
}
