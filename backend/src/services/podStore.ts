import {v4 as uuidv4} from 'uuid';
import {z} from 'zod';
import {WebSocketResponseEvents} from '../schemas';
import {Pod, PodStatus, CreatePodRequest, Result, ok, err, ScheduleConfig} from '../types';
import type {PersistedPod, PodSlackBinding} from '../types';
import {podPersistenceService} from './persistence/podPersistence.js';
import {socketService} from './socketService.js';
import {logger} from '../utils/logger.js';
import {canvasStore} from './canvasStore.js';
import {WriteQueue} from '../utils/writeQueue.js';
import {CanvasMapStore} from './shared/CanvasMapStore.js';

type PodUpdates = Partial<Omit<Pod, 'schedule'>> & { schedule?: ScheduleConfig | null };

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VALID_STATUSES = ['idle', 'chatting', 'summarizing', 'error'] as const;

const PersistedPodSchema = z.object({
    id: z.string().regex(ID_PATTERN),
    name: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: z.number().finite(),
    status: z.enum(VALID_STATUSES),
    skillIds: z.array(z.string().regex(ID_PATTERN)).optional().default([]),
    subAgentIds: z.array(z.string().regex(ID_PATTERN)).optional().default([]),
    mcpServerIds: z.array(z.string().regex(ID_PATTERN)).optional().default([]),
    repositoryId: z.string().regex(ID_PATTERN).nullable().optional(),
    commandId: z.string().regex(ID_PATTERN).nullable().optional(),
});

class PodStore extends CanvasMapStore<Pod> {
    private writeQueue = new WriteQueue('Pod', 'PodStore');

    flushWrites(podId: string): Promise<void> {
        return this.writeQueue.flush(podId);
    }

    private persistPodAsync(canvasId: string, pod: Pod, claudeSessionId?: string): void {
        const canvasDir = canvasStore.getCanvasDir(canvasId);
        if (!canvasDir) {
            logger.error('Pod', 'Error', `[PodStore] 找不到 Pod ${pod.id} 所屬的 Canvas`);
            return;
        }

        this.writeQueue.enqueue(pod.id, async () => {
            const result = await podPersistenceService.savePod(canvasDir, pod, claudeSessionId);
            if (!result.success) {
                logger.error('Pod', 'Error', `[PodStore] 持久化 Pod 失敗 (${pod.id}): ${result.error}`);
            }
        });
    }

    private modifyPod(canvasId: string, podId: string, updates: Partial<Pod>, persist = true, claudeSessionId?: string): Pod | undefined {
        const pods = this.getOrCreateCanvasMap(canvasId);
        const pod = pods.get(podId);
        if (!pod) {
            return undefined;
        }

        const updatedPod = {...pod, ...updates};
        pods.set(podId, updatedPod);

        if (persist) {
            this.persistPodAsync(canvasId, updatedPod, claudeSessionId);
        }

        return updatedPod;
    }

    create(canvasId: string, data: CreatePodRequest): Pod {
        const id = uuidv4();
        const canvasDir = canvasStore.getCanvasDir(canvasId);

        if (!canvasDir) {
            throw new Error(`找不到 Canvas：${canvasId}`);
        }

        const pod: Pod = {
            id,
            name: data.name,
            status: 'idle',
            workspacePath: `${canvasDir}/pod-${id}`,
            x: data.x,
            y: data.y,
            rotation: data.rotation,
            claudeSessionId: null,
            outputStyleId: data.outputStyleId ?? null,
            skillIds: data.skillIds ?? [],
            subAgentIds: data.subAgentIds ?? [],
            mcpServerIds: data.mcpServerIds ?? [],
            model: data.model ?? 'opus',
            repositoryId: data.repositoryId ?? null,
            commandId: data.commandId ?? null,
            autoClear: false,
        };

        const pods = this.getOrCreateCanvasMap(canvasId);
        pods.set(id, pod);
        this.persistPodAsync(canvasId, pod);

        return pod;
    }

    getByName(canvasId: string, name: string): Pod | undefined {
        const pods = this.getOrCreateCanvasMap(canvasId);
        for (const pod of pods.values()) {
            if (pod.name === name) {
                return pod;
            }
        }
        return undefined;
    }

    hasName(canvasId: string, name: string, excludePodId?: string): boolean {
        const pods = this.getOrCreateCanvasMap(canvasId);
        for (const [id, pod] of pods.entries()) {
            if (pod.name === name && id !== excludePodId) {
                return true;
            }
        }
        return false;
    }

    getByIdGlobal(podId: string): { canvasId: string; pod: Pod } | undefined {
        for (const [canvasId, pods] of this.dataByCanvas.entries()) {
            const pod = pods.get(podId);
            if (pod) {
                return {canvasId, pod};
            }
        }
        return undefined;
    }

    getAll(canvasId: string): Pod[] {
        return this.list(canvasId);
    }

    update(canvasId: string, id: string, updates: PodUpdates): Pod | undefined {
        const pods = this.getOrCreateCanvasMap(canvasId);
        const pod = pods.get(id);
        if (!pod) {
            return undefined;
        }

        const safeUpdates = this.buildSafeUpdates(updates);
        const updatedPod = this.handleScheduleUpdate(pod, updates, safeUpdates);

        pods.set(id, updatedPod);
        this.persistPodAsync(canvasId, updatedPod);

        return updatedPod;
    }

    private buildSafeUpdates(updates: PodUpdates): Partial<Omit<Pod, 'schedule'>> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const {id, workspacePath, schedule, ...safeUpdates} = updates as PodUpdates & Partial<Pod>;
        return safeUpdates;
    }

    private handleScheduleUpdate(
        pod: Pod,
        updates: PodUpdates,
        safeUpdates: Partial<Omit<Pod, 'schedule'>>
    ): Pod {
        if ('schedule' in updates && updates.schedule === null) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {schedule, ...restPod} = pod;
            return {...restPod, ...safeUpdates} as Pod;
        }

        const updatedPod = {...pod, ...safeUpdates};

        if (updates.schedule) {
            updatedPod.schedule = updates.schedule.lastTriggeredAt
                ? updates.schedule
                : {...updates.schedule, lastTriggeredAt: null};
        }

        return updatedPod as Pod;
    }

    delete(canvasId: string, id: string): boolean {
        const pods = this.getOrCreateCanvasMap(canvasId);
        if (!pods.delete(id)) {
            return false;
        }

        const canvasDir = canvasStore.getCanvasDir(canvasId);
        if (!canvasDir) {
            logger.error('Pod', 'Delete', `[PodStore] 找不到 Pod ${id} 所屬的 Canvas`);
            return false;
        }

        this.writeQueue.enqueue(id, async () => {
            const result = await podPersistenceService.deletePodData(canvasDir, id);
            if (!result.success) {
                logger.error('Pod', 'Delete', `[PodStore] 刪除 Pod 資料失敗 (${id}): ${result.error}`);
            }
        });
        this.writeQueue.delete(id);

        return true;
    }

    setStatus(canvasId: string, id: string, status: PodStatus): void {
        const pods = this.getOrCreateCanvasMap(canvasId);
        const pod = pods.get(id);
        if (!pod) {
            return;
        }

        const previousStatus = pod.status;
        if (previousStatus === status) {
            return;
        }

        pod.status = status;
        pods.set(id, pod);

        const payload = {
            canvasId,
            podId: id,
            status,
            previousStatus,
        };

        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_STATUS_CHANGED, payload);
    }

    setClaudeSessionId(canvasId: string, id: string, sessionId: string): void {
        this.modifyPod(canvasId, id, {claudeSessionId: sessionId}, true, sessionId);
    }

    resetClaudeSession(canvasId: string, podId: string): void {
        this.setClaudeSessionId(canvasId, podId, '');
    }

    setOutputStyleId(canvasId: string, id: string, outputStyleId: string | null): void {
        this.modifyPod(canvasId, id, {outputStyleId});
    }

    private addIdToArrayField(
        canvasId: string,
        podId: string,
        fieldName: 'skillIds' | 'subAgentIds' | 'mcpServerIds',
        id: string
    ): void {
        const pod = this.getById(canvasId, podId);
        if (!pod || pod[fieldName].includes(id)) {
            return;
        }

        this.modifyPod(canvasId, podId, {[fieldName]: [...pod[fieldName], id]});
    }

    addSkillId(canvasId: string, podId: string, skillId: string): void {
        this.addIdToArrayField(canvasId, podId, 'skillIds', skillId);
    }

    addSubAgentId(canvasId: string, podId: string, subAgentId: string): void {
        this.addIdToArrayField(canvasId, podId, 'subAgentIds', subAgentId);
    }

    private findByArrayField(canvasId: string, field: 'skillIds' | 'subAgentIds' | 'mcpServerIds', targetId: string): Pod[] {
        return this.findByPredicate(canvasId, (pod) => pod[field].includes(targetId));
    }

    private findBySingleField(canvasId: string, field: 'commandId' | 'outputStyleId' | 'repositoryId', targetId: string): Pod[] {
        return this.findByPredicate(canvasId, (pod) => pod[field] === targetId);
    }

    findBySubAgentId(canvasId: string, subAgentId: string): Pod[] {
        return this.findByArrayField(canvasId, 'subAgentIds', subAgentId);
    }

    addMcpServerId(canvasId: string, podId: string, mcpServerId: string): void {
        this.addIdToArrayField(canvasId, podId, 'mcpServerIds', mcpServerId);
    }

    removeMcpServerId(canvasId: string, podId: string, mcpServerId: string): void {
        const pod = this.getById(canvasId, podId);
        if (!pod) {
            return;
        }

        this.modifyPod(canvasId, podId, {mcpServerIds: pod.mcpServerIds.filter((id) => id !== mcpServerId)});
    }

    findByMcpServerId(canvasId: string, mcpServerId: string): Pod[] {
        return this.findByArrayField(canvasId, 'mcpServerIds', mcpServerId);
    }

    setRepositoryId(canvasId: string, id: string, repositoryId: string | null): void {
        this.modifyPod(canvasId, id, {repositoryId});
    }

    setAutoClear(canvasId: string, id: string, autoClear: boolean): void {
        this.modifyPod(canvasId, id, {autoClear});
    }

    setCommandId(canvasId: string, podId: string, commandId: string | null): void {
        this.modifyPod(canvasId, podId, {commandId});
    }

    findByCommandId(canvasId: string, commandId: string): Pod[] {
        return this.findBySingleField(canvasId, 'commandId', commandId);
    }

    findByOutputStyleId(canvasId: string, outputStyleId: string): Pod[] {
        return this.findBySingleField(canvasId, 'outputStyleId', outputStyleId);
    }

    findBySkillId(canvasId: string, skillId: string): Pod[] {
        return this.findByArrayField(canvasId, 'skillIds', skillId);
    }

    findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
        return this.findBySingleField(canvasId, 'repositoryId', repositoryId);
    }

    setSlackBinding(canvasId: string, podId: string, binding: PodSlackBinding | null): void {
        const pod = this.getById(canvasId, podId);
        if (!pod) {
            return;
        }

        if (binding === null) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {slackBinding: _, ...rest} = pod;
            const pods = this.getOrCreateCanvasMap(canvasId);
            pods.set(podId, rest as Pod);
            this.persistPodAsync(canvasId, rest as Pod);
            return;
        }

        this.modifyPod(canvasId, podId, {slackBinding: binding});
    }

    findBySlackApp(slackAppId: string): Array<{canvasId: string; pod: Pod}> {
        const result: Array<{canvasId: string; pod: Pod}> = [];

        for (const [canvasId, pods] of this.dataByCanvas.entries()) {
            for (const pod of pods.values()) {
                if (pod.slackBinding?.slackAppId === slackAppId) {
                    result.push({canvasId, pod});
                }
            }
        }

        return result;
    }

    setScheduleLastTriggeredAt(canvasId: string, podId: string, date: Date): void {
        const pod = this.getById(canvasId, podId);
        if (!pod || !pod.schedule) {
            return;
        }

        this.modifyPod(canvasId, podId, {
            schedule: {...pod.schedule, lastTriggeredAt: date},
        });
    }

    getAllWithSchedule(): Array<{ canvasId: string; pod: Pod }> {
        const result: Array<{ canvasId: string; pod: Pod }> = [];

        for (const [canvasId, pods] of this.dataByCanvas.entries()) {
            for (const pod of pods.values()) {
                if (pod.schedule && pod.schedule.enabled) {
                    result.push({canvasId, pod});
                }
            }
        }

        return result;
    }

    private validatePodData(persistedPod: PersistedPod): Result<void> {
        const result = PersistedPodSchema.safeParse(persistedPod);
        if (!result.success) {
            const errorMsg = result.error.issues[0]?.message ?? '無效的 Pod 資料';
            logger.log('Pod', 'Load', `[PodStore] 驗證失敗: ${persistedPod.id}`);
            return err(errorMsg);
        }
        return ok(undefined);
    }

    private applyPodDefaults(persistedPod: PersistedPod, canvasDir: string): Pod {
        const loadedStatus = persistedPod.status as string;

        const pod: Pod = {
            id: persistedPod.id,
            name: persistedPod.name,
            // 載入時重置為 idle，避免程式重啟後保留舊的忙碌狀態
            status: loadedStatus === 'busy' ? 'idle' : persistedPod.status,
            workspacePath: `${canvasDir}/pod-${persistedPod.id}`,
            x: persistedPod.x,
            y: persistedPod.y,
            rotation: persistedPod.rotation,
            claudeSessionId: persistedPod.claudeSessionId,
            outputStyleId: persistedPod.outputStyleId ?? null,
            skillIds: persistedPod.skillIds ?? [],
            subAgentIds: persistedPod.subAgentIds ?? [],
            mcpServerIds: persistedPod.mcpServerIds ?? [],
            model: persistedPod.model ?? 'opus',
            repositoryId: persistedPod.repositoryId ?? null,
            commandId: persistedPod.commandId ?? null,
            autoClear: persistedPod.autoClear ?? false,
        };

        if (persistedPod.schedule) {
            pod.schedule = {
                ...persistedPod.schedule,
                lastTriggeredAt: persistedPod.schedule.lastTriggeredAt
                    ? new Date(persistedPod.schedule.lastTriggeredAt)
                    : null,
            };
        }

        if (persistedPod.slackBinding) {
            pod.slackBinding = persistedPod.slackBinding;
        }

        return pod;
    }

    private deserializePod(persistedPod: PersistedPod, canvasDir: string): Pod | null {
        const validation = this.validatePodData(persistedPod);
        if (!validation.success) {
            return null;
        }

        return this.applyPodDefaults(persistedPod, canvasDir);
    }

    private async loadSinglePod(podId: string, canvasDir: string, pods: Map<string, Pod>): Promise<void> {
        const persistedPod = await podPersistenceService.loadPod(canvasDir, podId);
        if (!persistedPod) {
            return;
        }

        const pod = this.deserializePod(persistedPod, canvasDir);
        if (!pod) {
            logger.log('Pod', 'Load', `[PodStore] 跳過無效的 Pod: ${podId}`);
            return;
        }

        pods.set(pod.id, pod);
    }

    async loadFromDisk(canvasId: string, canvasDir: string): Promise<Result<void>> {
        const result = await podPersistenceService.listAllPodIds(canvasDir);
        if (!result.success) {
            return err('載入 Pod 資料失敗');
        }

        const podIds = result.data;
        const pods = this.getOrCreateCanvasMap(canvasId);

        for (const podId of podIds) {
            await this.loadSinglePod(podId, canvasDir, pods);
        }

        const canvasName = canvasStore.getNameById(canvasId);
        logger.log('Pod', 'Load', `[PodStore] 成功載入 ${pods.size} 個 Pod，畫布 ${canvasName}`);
        return ok(undefined);
    }
}

export const podStore = new PodStore();
