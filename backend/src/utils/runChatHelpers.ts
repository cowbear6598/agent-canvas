import { v4 as uuidv4 } from 'uuid';
import type { RunContext } from '../types/run.js';
import type { ContentBlock } from '../types/index.js';
import { WebSocketResponseEvents } from '../schemas/index.js';
import { runStore } from '../services/runStore.js';
import { socketService } from '../services/socketService.js';
import { extractDisplayContent } from './chatHelpers.js';

export async function injectRunUserMessage(
    runContext: RunContext,
    podId: string,
    content: string | ContentBlock[]
): Promise<void> {
    const displayContent = extractDisplayContent(content);

    // 不呼叫 podStore.setStatus（pod 全域狀態不變）
    await runStore.addRunMessage(runContext.runId, podId, 'user', displayContent);

    socketService.emitToCanvas(runContext.canvasId, WebSocketResponseEvents.RUN_MESSAGE, {
        runId: runContext.runId,
        canvasId: runContext.canvasId,
        podId,
        messageId: uuidv4(),
        content: displayContent,
        isPartial: false,
        role: 'user',
    });
}
