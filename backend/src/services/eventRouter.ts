import type { WebSocketMessage } from '../types/websocket.js';
import { logger } from '../utils/logger.js';
import { authGuard } from './auth/authGuard.js';

/**
 * 事件處理器類型
 */
export type EventHandler = (connectionId: string, payload: unknown, requestId: string) => Promise<void>;

/**
 * 事件路由器
 * 負責將 WebSocket 訊息路由到對應的處理器
 */
class EventRouter {
	private handlers: Map<string, EventHandler> = new Map();

	/**
	 * 註冊事件處理器
	 */
	register(event: string, handler: EventHandler): void {
		this.handlers.set(event, handler);
	}

	/**
	 * 路由訊息到對應的處理器
	 */
	async route(connectionId: string, message: WebSocketMessage): Promise<void> {
		const handler = this.handlers.get(message.type);

		if (!handler) {
			logger.log('WebSocket', 'Error', `未知的事件類型：${message.type}`);
			throw new Error(`未知的事件類型：${message.type}`);
		}

		authGuard.assertAccess(connectionId, message.type, message.payload);
		await handler(connectionId, message.payload, message.requestId);
	}
}

export const eventRouter = new EventRouter();
