import {WebSocketResponseEvents} from '../schemas';
import type {SkillImportedPayload} from '../types';
import type {
    SkillImportPayload,
} from '../schemas';
import {skillService} from '../services/skillService.js';
import {skillNoteStore} from '../services/noteStores.js';
import {podStore} from '../services/podStore.js';
import {emitSuccess} from '../utils/websocketResponse.js';
import {createNoteHandlers} from './factories/createNoteHandlers.js';
import {createBindHandler} from './factories/createBindHandlers.js';
import {createListHandler, createDeleteHandler} from './factories/createResourceHandlers.js';
import {logger} from '../utils/logger.js';
import {WebSocketError} from '../middleware/wsErrorHandler.js';

export const skillNoteHandlers = createNoteHandlers({
    noteStore: skillNoteStore,
    events: {
        created: WebSocketResponseEvents.SKILL_NOTE_CREATED,
        listResult: WebSocketResponseEvents.SKILL_NOTE_LIST_RESULT,
        updated: WebSocketResponseEvents.SKILL_NOTE_UPDATED,
        deleted: WebSocketResponseEvents.SKILL_NOTE_DELETED,
    },
    foreignKeyField: 'skillId',
    entityName: 'Skill',
});

export const handleSkillList = createListHandler({
    service: skillService,
    event: WebSocketResponseEvents.SKILL_LIST_RESULT,
    responseKey: 'skills',
});

const skillBindHandler = createBindHandler({
    resourceName: 'Skill',
    idField: 'skillId',
    isMultiBind: true,
    service: skillService,
    podStoreMethod: {
        bind: (canvasId, podId, skillId) => podStore.addSkillId(canvasId, podId, skillId),
    },
    getPodResourceIds: (pod) => pod.skillIds,
    copyResourceToPod: (skillId, pod) => skillService.copySkillToPod(skillId, pod.id, pod.workspacePath),
    events: {
        bound: WebSocketResponseEvents.POD_SKILL_BOUND,
    },
});

export const handlePodBindSkill = skillBindHandler;

export const handleSkillDelete = createDeleteHandler({
    service: skillService,
    resourceName: 'Skill',
    idField: 'skillId',
    deleteConfig: {
        deleted: WebSocketResponseEvents.SKILL_DELETED,
        findPodsUsing: (canvasId, skillId) => podStore.findBySkillId(canvasId, skillId),
        deleteNotes: (canvasId, skillId) => skillNoteStore.deleteByForeignKey(canvasId, skillId),
    },
});

export async function handleSkillImport(
    connectionId: string,
    payload: SkillImportPayload,
    requestId: string
): Promise<void> {
    const {fileName, fileData, fileSize} = payload;

    let result: Awaited<ReturnType<typeof skillService.import>>;
    try {
        result = await skillService.import(fileName, fileData, fileSize);
    } catch (error) {
        const message = error instanceof Error ? error.message : '匯入 Skill 失敗';
        throw new WebSocketError('SKILL_IMPORT_ERROR', message, requestId);
    }

    logger.log('Skill', 'Create', `匯入 Skill - connectionId: ${connectionId}, 檔案名稱: ${fileName}, 檔案大小: ${fileSize}, skillId: ${result.skill.id}, 是否覆寫: ${result.isOverwrite}`);

    const response: SkillImportedPayload = {
        requestId,
        success: true,
        skill: result.skill,
        isOverwrite: result.isOverwrite,
    };

    emitSuccess(connectionId, WebSocketResponseEvents.SKILL_IMPORTED, response);
}
