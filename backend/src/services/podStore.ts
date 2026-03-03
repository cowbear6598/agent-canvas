import {v4 as uuidv4} from 'uuid';
import {WebSocketResponseEvents} from '../schemas';
import {Pod, PodStatus, CreatePodRequest, Result, ok, err, ScheduleConfig} from '../types';
import type {PersistedPod, PodSlackBinding} from '../types';

type PodUpdates = Partial<Omit<Pod, 'schedule'>> & { schedule?: ScheduleConfig | null };
import {podPersistenceService} from './persistence/podPersistence.js';
import {socketService} from './socketService.js';
import {logger} from '../utils/logger.js';
import {canvasStore} from './canvasStore.js';
import {WriteQueue} from '../utils/writeQueue.js';

class PodStore {
    private podsByCanvas: Map<string, Map<string, Pod>> = new Map();
    private writeQueue = new WriteQueue('Pod', 'PodStore');

    private getCanvasPods(canvasId: string): Map<string, Pod> {
        let pods = this.podsByCanvas.get(canvasId);
        if (!pods) {
            pods = new Map();
            this.podsByCanvas.set(canvasId, pods);
        }
        return pods;
    }

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
        const pods = this.getCanvasPods(canvasId);
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

    private findByPredicate(canvasId: string, predicate: (pod: Pod) => boolean): Pod[] {
        const pods = this.getCanvasPods(canvasId);
        return Array.from(pods.values()).filter(predicate);
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

        const pods = this.getCanvasPods(canvasId);
        pods.set(id, pod);
        this.persistPodAsync(canvasId, pod);

        return pod;
    }

    getById(canvasId: string, id: string): Pod | undefined {
        const pods = this.getCanvasPods(canvasId);
        return pods.get(id);
    }

    getByName(canvasId: string, name: string): Pod | undefined {
        const pods = this.getCanvasPods(canvasId);
        for (const pod of pods.values()) {
            if (pod.name === name) {
                return pod;
            }
        }
        return undefined;
    }

    hasName(canvasId: string, name: string, excludePodId?: string): boolean {
        const pods = this.getCanvasPods(canvasId);
        for (const [id, pod] of pods.entries()) {
            if (pod.name === name && id !== excludePodId) {
                return true;
            }
        }
        return false;
    }

    getByIdGlobal(podId: string): { canvasId: string; pod: Pod } | undefined {
        for (const [canvasId, pods] of this.podsByCanvas.entries()) {
            const pod = pods.get(podId);
            if (pod) {
                return {canvasId, pod};
            }
        }
        return undefined;
    }

    getAll(canvasId: string): Pod[] {
        const pods = this.getCanvasPods(canvasId);
        return Array.from(pods.values());
    }

    update(canvasId: string, id: string, updates: PodUpdates): Pod | undefined {
        const pods = this.getCanvasPods(canvasId);
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
        const pods = this.getCanvasPods(canvasId);
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
        const pods = this.getCanvasPods(canvasId);
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

    findBySubAgentId(canvasId: string, subAgentId: string): Pod[] {
        return this.findByPredicate(canvasId, (pod) => pod.subAgentIds.includes(subAgentId));
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
        return this.findByPredicate(canvasId, (pod) => pod.mcpServerIds.includes(mcpServerId));
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
        return this.findByPredicate(canvasId, (pod) => pod.commandId === commandId);
    }

    findByOutputStyleId(canvasId: string, outputStyleId: string): Pod[] {
        return this.findByPredicate(canvasId, (pod) => pod.outputStyleId === outputStyleId);
    }

    findBySkillId(canvasId: string, skillId: string): Pod[] {
        return this.findByPredicate(canvasId, (pod) => pod.skillIds.includes(skillId));
    }

    findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
        return this.findByPredicate(canvasId, (pod) => pod.repositoryId === repositoryId);
    }

    setSlackBinding(canvasId: string, podId: string, binding: PodSlackBinding | null): void {
        const pod = this.getById(canvasId, podId);
        if (!pod) {
            return;
        }

        if (binding === null) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {slackBinding: _, ...rest} = pod;
            const pods = this.getCanvasPods(canvasId);
            pods.set(podId, rest as Pod);
            this.persistPodAsync(canvasId, rest as Pod);
            return;
        }

        this.modifyPod(canvasId, podId, {slackBinding: binding});
    }

    findBySlackApp(slackAppId: string): Array<{canvasId: string; pod: Pod}> {
        const result: Array<{canvasId: string; pod: Pod}> = [];

        for (const [canvasId, pods] of this.podsByCanvas.entries()) {
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

        for (const [canvasId, pods] of this.podsByCanvas.entries()) {
            for (const pod of pods.values()) {
                if (pod.schedule && pod.schedule.enabled) {
                    result.push({canvasId, pod});
                }
            }
        }

        return result;
    }

    private validatePodData(persistedPod: PersistedPod): Result<void> {
        // 防禦性驗證：驗證必要欄位的型別和範圍，避免磁碟檔案被竄改時注入惡意值
        const validStatuses: PodStatus[] = ['idle', 'chatting', 'summarizing', 'error'];
        const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

        const skillIds = persistedPod.skillIds ?? [];
        const subAgentIds = persistedPod.subAgentIds ?? [];
        const mcpServerIds = persistedPod.mcpServerIds ?? [];

        const hasInvalidSkillIds = skillIds.some((id) => !ID_PATTERN.test(id));
        const hasInvalidSubAgentIds = subAgentIds.some((id) => !ID_PATTERN.test(id));
        const hasInvalidMcpServerIds = mcpServerIds.some((id) => !ID_PATTERN.test(id));
        const hasInvalidRepositoryId = persistedPod.repositoryId !== null && !ID_PATTERN.test(persistedPod.repositoryId ?? '');
        const hasInvalidCommandId = persistedPod.commandId != null && !ID_PATTERN.test(persistedPod.commandId);

        const rules: Array<{ check: boolean; errorMsg: string }> = [
            {check: persistedPod.id.trim() === '', errorMsg: '無效的 Pod ID'},
            {check: persistedPod.name.trim() === '', errorMsg: '無效的 Pod 名稱'},
            {check: !Number.isFinite(persistedPod.x), errorMsg: '無效的 Pod X 座標'},
            {check: !Number.isFinite(persistedPod.y), errorMsg: '無效的 Pod Y 座標'},
            {check: !Number.isFinite(persistedPod.rotation), errorMsg: '無效的 Pod 旋轉角度'},
            {check: !validStatuses.includes(persistedPod.status), errorMsg: '無效的 Pod 狀態'},
            {check: hasInvalidSkillIds, errorMsg: '無效的 Skill ID 格式'},
            {check: hasInvalidSubAgentIds, errorMsg: '無效的子代理 ID 格式'},
            {check: hasInvalidMcpServerIds, errorMsg: '無效的 MCP Server ID 格式'},
            {check: hasInvalidRepositoryId, errorMsg: '無效的 Repository ID 格式'},
            {check: hasInvalidCommandId, errorMsg: '無效的 Command ID 格式'},
        ];

        for (const {check, errorMsg} of rules) {
            if (check) {
                logger.log('Pod', 'Load', `[PodStore] ${errorMsg}: ${persistedPod.id}`);
                return err(errorMsg);
            }
        }

        return ok(undefined);
    }

    private deserializePod(persistedPod: PersistedPod, canvasDir: string): Pod | null {
        const validation = this.validatePodData(persistedPod);
        if (!validation.success) {
            return null;
        }

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
        const pods = this.getCanvasPods(canvasId);

        for (const podId of podIds) {
            await this.loadSinglePod(podId, canvasDir, pods);
        }

        const canvasName = canvasStore.getNameById(canvasId);
        logger.log('Pod', 'Load', `[PodStore] 成功載入 ${pods.size} 個 Pod，畫布 ${canvasName}`);
        return ok(undefined);
    }
}

export const podStore = new PodStore();
