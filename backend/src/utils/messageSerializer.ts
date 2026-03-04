import type { WebSocketMessage, WebSocketResponse } from '../types/websocket.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { safeJsonParse } from './safeJsonParse.js';

export function serialize(message: WebSocketMessage | WebSocketResponse): string {
	return JSON.stringify(message);
}

function normalizeToString(data: string | Buffer): string {
	return typeof data === 'string' ? data : data.toString('utf-8');
}

function parseJson(jsonString: string): Record<string, unknown> {
	const parsed = safeJsonParse(jsonString);
	if (!parsed) {
		throw new Error('無效的 JSON 格式');
	}

	if (typeof parsed !== 'object') {
		throw new Error('訊息必須是 JSON 物件');
	}

	return parsed as Record<string, unknown>;
}

function validateMessageShape(obj: Record<string, unknown>): WebSocketMessage {
	if (typeof obj.type !== 'string') {
		throw new Error('訊息缺少必要欄位: type');
	}

	return {
		type: obj.type,
		requestId: (obj.requestId as string) ?? '',
		payload: obj.payload,
		ackId: obj.ackId as string | undefined,
	};
}

export function deserialize(data: string | Buffer): WebSocketMessage {
	const jsonString = normalizeToString(data);
	const obj = parseJson(jsonString);
	return validateMessageShape(obj);
}

export function tryDeserialize(data: string | Buffer): Result<WebSocketMessage> {
	try {
		return ok(deserialize(data));
	} catch (error) {
		const message = error instanceof Error ? error.message : '無效的訊息格式';
		return err(message);
	}
}
