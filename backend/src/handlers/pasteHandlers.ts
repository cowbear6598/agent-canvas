import {WebSocketResponseEvents} from '../schemas';
import type {
    CanvasPasteResultPayload,
    PasteError,
} from '../types';
import type {CanvasPastePayload} from '../schemas';
import {socketService} from '../services/socketService.js';
import {logger} from '../utils/logger.js';
import {withCanvasId} from '../utils/handlerHelpers.js';
import {
    createPastedPods,
    createPastedNotesByType,
    createPastedConnections,
} from './paste/pasteHelpers.js';
import {podStore} from '../services/podStore.js';

export const handleCanvasPaste = withCanvasId<CanvasPastePayload>(
    WebSocketResponseEvents.CANVAS_PASTE_RESULT,
    async (_connectionId: string, canvasId: string, payload: CanvasPastePayload, requestId: string): Promise<void> => {
        const {pods, outputStyleNotes, skillNotes, repositoryNotes, subAgentNotes, commandNotes, connections} = payload;

        const podIdMapping: Record<string, string> = {};
        const errors: PasteError[] = [];

        const createdPods = await createPastedPods(canvasId, pods, podIdMapping, errors);

        const outputStyleNotesResult = createPastedNotesByType('outputStyle', canvasId, outputStyleNotes, podIdMapping);
        const createdOutputStyleNotes = outputStyleNotesResult.notes;
        errors.push(...outputStyleNotesResult.errors);

        const skillNotesResult = createPastedNotesByType('skill', canvasId, skillNotes, podIdMapping);
        const createdSkillNotes = skillNotesResult.notes;
        errors.push(...skillNotesResult.errors);

        const repositoryNotesResult = createPastedNotesByType('repository', canvasId, repositoryNotes, podIdMapping);
        const createdRepositoryNotes = repositoryNotesResult.notes;
        errors.push(...repositoryNotesResult.errors);

        const subAgentNotesResult = createPastedNotesByType('subAgent', canvasId, subAgentNotes, podIdMapping);
        const createdSubAgentNotes = subAgentNotesResult.notes;
        errors.push(...subAgentNotesResult.errors);

        const commandNotesResult = createPastedNotesByType('command', canvasId, commandNotes ?? [], podIdMapping);
        const createdCommandNotes = commandNotesResult.notes;
        errors.push(...commandNotesResult.errors);

        const createdConnections = createPastedConnections(canvasId, connections, podIdMapping);

        for (const note of createdCommandNotes) {
            if (note.boundToPodId) {
                const pod = podStore.getById(canvasId, note.boundToPodId);
                if (pod && !pod.commandId) {
                    podStore.setCommandId(canvasId, note.boundToPodId, note.commandId);
                }
            }
        }

        const response: CanvasPasteResultPayload = {
            requestId,
            success: errors.length === 0,
            createdPods,
            createdOutputStyleNotes,
            createdSkillNotes,
            createdRepositoryNotes,
            createdSubAgentNotes,
            createdCommandNotes,
            createdConnections,
            podIdMapping,
            errors,
        };

        if (errors.length > 0) {
            response.error = `貼上完成，但有 ${errors.length} 個錯誤`;
        }

        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.CANVAS_PASTE_RESULT, response);

        logger.log(
            'Paste',
            'Complete',
            `Paste completed: ${createdPods.length} pods, ${createdOutputStyleNotes.length} output style notes, ${createdSkillNotes.length} skill notes, ${createdRepositoryNotes.length} repository notes, ${createdSubAgentNotes.length} subagent notes, ${createdCommandNotes.length} command notes, ${createdConnections.length} connections, ${errors.length} errors`
        );
    }
);
