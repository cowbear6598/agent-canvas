import type { WebSocketMessage } from '../types/websocket.js';
import { handleWebSocketError } from '../middleware/wsErrorHandler.js';
import { logger } from '../utils/logger.js';
import { authGuard } from './auth/authGuard.js';

/**
 * 事件處理器類型
 */
export type EventHandler = (connectionId: string, payload: unknown, requestId: string) => Promise<void>;

interface RegisteredHandler {
	handler: EventHandler;
	responseEvent: string;
}

/**
 * 事件路由器
 * 負責將 WebSocket 訊息路由到對應的處理器
 */
class EventRouter {
	private handlers: Map<string, RegisteredHandler> = new Map();

	/**
	 * 註冊事件處理器
	 */
	register(event: string, handler: EventHandler, responseEvent: string): void {
		this.handlers.set(event, { handler, responseEvent });
	}

	getRegisteredEvents(): string[] {
		return [...this.handlers.keys()];
	}

	/**
	 * 路由訊息到對應的處理器
	 */
	async route(connectionId: string, message: WebSocketMessage): Promise<void> {
		const registeredHandler = this.handlers.get(message.type);

		if (!registeredHandler) {
			logger.log('WebSocket', 'Error', `未知的事件類型：${message.type}`);
			throw new Error(`未知的事件類型：${message.type}`);
		}

		try {
			authGuard.assertAccess(connectionId, message.type, message.payload);
		} catch (error) {
			handleWebSocketError({
				connectionId,
				responseEvent: registeredHandler.responseEvent,
				error,
				requestId: message.requestId,
			});
			return;
		}

		await registeredHandler.handler(connectionId, message.payload, message.requestId);
	}
}

export const eventRouter = new EventRouter();
