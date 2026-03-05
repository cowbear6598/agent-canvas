import { WebSocketResponseEvents } from '../../schemas';
import { messageStore } from '../../services/messageStore.js';
import { canvasStore } from '../../services/canvasStore.js';
import { podStore } from '../../services/podStore.js';
import { socketService } from '../../services/socketService.js';
import { logger } from '../../utils/logger.js';

export async function clearPodMessages(connectionId: string, podId: string): Promise<void> {
	const canvasId = canvasStore.getActiveCanvas(connectionId);
	if (!canvasId) {
		const podName = podStore.getByIdGlobal(podId)?.pod.name ?? podId;
		logger.error('Repository', 'Error', `找不到使用中的 Canvas，無法清除 Pod「${podName}」的訊息`);
		return;
	}

	const podName = podStore.getById(canvasId, podId)?.name ?? podId;

	try {
		messageStore.clearMessages(podId);
		socketService.emitToConnection(connectionId, WebSocketResponseEvents.POD_MESSAGES_CLEARED, { podId });
	} catch (error) {
		logger.error('Repository', 'Error', `清除 Pod「${podName}」的訊息失敗`, error);
	}
}
