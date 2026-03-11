import { randomUUID } from 'crypto';
import type { Database } from 'bun:sqlite';
import { WebSocketResponseEvents } from '../schemas';
import type { Pod, PodStatus, CreatePodRequest, ScheduleConfig } from '../types';
import type { IntegrationBinding } from '../types/integration.js';
import { socketService } from './socketService.js';
import { canvasStore } from './canvasStore.js';
import { getDb } from '../database/index.js';
import { getStatements } from '../database/statements.js';
import { safeJsonParse } from '../utils/safeJsonParse.js';

type PodUpdates = Partial<Omit<Pod, 'schedule'>> & { schedule?: ScheduleConfig | null };

interface PodRow {
    id: string;
    canvas_id: string;
    name: string;
    status: string;
    x: number;
    y: number;
    rotation: number;
    model: string;
    workspace_path: string;
    claude_session_id: string | null;
    output_style_id: string | null;
    repository_id: string | null;
    command_id: string | null;
    auto_clear: number;
    schedule_json: string | null;
}

interface IntegrationBindingRow {
    id: string;
    pod_id: string;
    canvas_id: string;
    provider: string;
    app_id: string;
    resource_id: string;
    extra_json: string | null;
}

function rowToPod(row: PodRow): Pod {
    const stmts = getStatements(getDb());

    const skillRows = stmts.podSkillIds.selectByPodId.all(row.id) as Array<{ skill_id: string }>;
    const subAgentRows = stmts.podSubAgentIds.selectByPodId.all(row.id) as Array<{ sub_agent_id: string }>;
    const mcpServerRows = stmts.podMcpServerIds.selectByPodId.all(row.id) as Array<{ mcp_server_id: string }>;

    const pod: Pod = {
        id: row.id,
        name: row.name,
        status: row.status as PodStatus,
        workspacePath: row.workspace_path,
        x: row.x,
        y: row.y,
        rotation: row.rotation,
        claudeSessionId: row.claude_session_id,
        outputStyleId: row.output_style_id,
        skillIds: skillRows.map(r => r.skill_id),
        subAgentIds: subAgentRows.map(r => r.sub_agent_id),
        mcpServerIds: mcpServerRows.map(r => r.mcp_server_id),
        model: row.model as Pod['model'],
        repositoryId: row.repository_id,
        commandId: row.command_id,
        autoClear: row.auto_clear === 1,
    };

    if (row.schedule_json) {
        const persisted = safeJsonParse<Record<string, unknown>>(row.schedule_json);
        if (persisted) {
            pod.schedule = {
                ...persisted,
                lastTriggeredAt: persisted.lastTriggeredAt ? new Date(persisted.lastTriggeredAt as string) : null,
            } as ScheduleConfig;
        }
    }

    return pod;
}

function serializeSchedule(schedule?: ScheduleConfig): string | null {
    if (!schedule) return null;
    return JSON.stringify({
        ...schedule,
        lastTriggeredAt: schedule.lastTriggeredAt ? schedule.lastTriggeredAt.toISOString() : null,
    });
}

class PodStore {
    private get stmts(): ReturnType<typeof getStatements> {
        return getStatements(getDb());
    }

    private loadBindingsForPod(podId: string): IntegrationBinding[] {
        const rows = this.stmts.integrationBinding.selectByPodId.all(podId) as IntegrationBindingRow[];
        return rows.map(row => ({
            provider: row.provider,
            appId: row.app_id,
            resourceId: row.resource_id,
            extra: row.extra_json ? safeJsonParse<Record<string, unknown>>(row.extra_json) ?? undefined : undefined,
        }));
    }

    private toPodWithBindings(row: PodRow): Pod {
        const pod = rowToPod(row);
        pod.integrationBindings = this.loadBindingsForPod(pod.id);
        return pod;
    }

    private toPodListWithBindings(rows: PodRow[]): Pod[] {
        return rows.map(row => this.toPodWithBindings(row));
    }

    create(canvasId: string, data: CreatePodRequest): { pod: Pod; persisted: Promise<void> } {
        const id = randomUUID();
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

        this.stmts.pod.insert.run({
            $id: id,
            $canvasId: canvasId,
            $name: pod.name,
            $status: pod.status,
            $x: pod.x,
            $y: pod.y,
            $rotation: pod.rotation,
            $model: pod.model,
            $workspacePath: pod.workspacePath,
            $claudeSessionId: pod.claudeSessionId,
            $outputStyleId: pod.outputStyleId,
            $repositoryId: pod.repositoryId,
            $commandId: pod.commandId,
            $autoClear: 0,
            $scheduleJson: null,
        });

        for (const skillId of pod.skillIds) {
            this.stmts.podSkillIds.insert.run({ $podId: id, $skillId: skillId });
        }

        for (const subAgentId of pod.subAgentIds) {
            this.stmts.podSubAgentIds.insert.run({ $podId: id, $subAgentId: subAgentId });
        }

        for (const mcpServerId of pod.mcpServerIds) {
            this.stmts.podMcpServerIds.insert.run({ $podId: id, $mcpServerId: mcpServerId });
        }

        return { pod, persisted: Promise.resolve() };
    }

    getById(canvasId: string, id: string): Pod | undefined {
        const row = this.stmts.pod.selectByCanvasIdAndId.get(canvasId, id) as PodRow | undefined;
        if (!row) return undefined;
        return this.toPodWithBindings(row);
    }

    getByIdGlobal(podId: string): { canvasId: string; pod: Pod } | undefined {
        const row = this.stmts.pod.selectById.get(podId) as PodRow | undefined;
        if (!row) return undefined;
        return { canvasId: row.canvas_id, pod: this.toPodWithBindings(row) };
    }

    getAll(canvasId: string): Pod[] {
        return this.list(canvasId);
    }

    list(canvasId: string): Pod[] {
        const rows = this.stmts.pod.selectByCanvasId.all(canvasId) as PodRow[];
        return this.toPodListWithBindings(rows);
    }

    getByName(canvasId: string, name: string): Pod | undefined {
        const row = this.stmts.pod.selectByCanvasIdAndName.get(canvasId, name) as PodRow | undefined;
        if (!row) return undefined;
        return this.toPodWithBindings(row);
    }

    hasName(canvasId: string, name: string, excludePodId?: string): boolean {
        const result = this.stmts.pod.countByCanvasIdAndName.get({
            $canvasId: canvasId,
            $name: name,
            $excludeId: excludePodId ?? '',
        }) as { count: number };
        return result.count > 0;
    }

    update(canvasId: string, id: string, updates: PodUpdates): { pod: Pod; persisted: Promise<void> } | undefined {
        const pod = this.getById(canvasId, id);
        if (!pod) return undefined;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, workspacePath: _wp, schedule, ...safeUpdates } = updates as PodUpdates & Partial<Pod>;
        const updatedPod: Pod = { ...pod, ...safeUpdates };

        if ('schedule' in updates && updates.schedule === null) {
            delete updatedPod.schedule;
        } else if (updates.schedule) {
            updatedPod.schedule = updates.schedule.lastTriggeredAt
                ? updates.schedule
                : { ...updates.schedule, lastTriggeredAt: null };
        }

        this.stmts.pod.update.run({
            $id: id,
            $name: updatedPod.name,
            $status: updatedPod.status,
            $x: updatedPod.x,
            $y: updatedPod.y,
            $rotation: updatedPod.rotation,
            $model: updatedPod.model,
            $claudeSessionId: updatedPod.claudeSessionId,
            $outputStyleId: updatedPod.outputStyleId,
            $repositoryId: updatedPod.repositoryId,
            $commandId: updatedPod.commandId,
            $autoClear: updatedPod.autoClear ? 1 : 0,
            $scheduleJson: serializeSchedule(updatedPod.schedule),
        });

        if (updates.skillIds !== undefined) {
            this.replaceJoinTableIds(id, this.stmts.podSkillIds, updates.skillIds, valueId => ({ $podId: id, $skillId: valueId }));
        }

        if (updates.subAgentIds !== undefined) {
            this.replaceJoinTableIds(id, this.stmts.podSubAgentIds, updates.subAgentIds, valueId => ({ $podId: id, $subAgentId: valueId }));
        }

        if (updates.mcpServerIds !== undefined) {
            this.replaceJoinTableIds(id, this.stmts.podMcpServerIds, updates.mcpServerIds, valueId => ({ $podId: id, $mcpServerId: valueId }));
        }

        return { pod: updatedPod, persisted: Promise.resolve() };
    }

    delete(canvasId: string, id: string): boolean {
        const result = this.stmts.pod.deleteById.run(id) as { changes: number };
        return result.changes > 0;
    }

    setStatus(canvasId: string, id: string, status: PodStatus): void {
        const pod = this.getById(canvasId, id);
        if (!pod) return;

        const previousStatus = pod.status;
        if (previousStatus === status) return;

        this.stmts.pod.updateStatus.run({ $id: id, $status: status });

        socketService.emitToCanvas(canvasId, WebSocketResponseEvents.POD_STATUS_CHANGED, {
            canvasId,
            podId: id,
            status,
            previousStatus,
        });
    }

    setClaudeSessionId(canvasId: string, id: string, sessionId: string): void {
        this.stmts.pod.updateClaudeSessionId.run({ $claudeSessionId: sessionId, $id: id });
    }

    resetClaudeSession(canvasId: string, podId: string): void {
        this.setClaudeSessionId(canvasId, podId, '');
    }

    setOutputStyleId(canvasId: string, id: string, outputStyleId: string | null): void {
        this.stmts.pod.updateOutputStyleId.run({ $outputStyleId: outputStyleId, $id: id });
    }

    addSkillId(canvasId: string, podId: string, skillId: string): void {
        this.stmts.podSkillIds.insert.run({ $podId: podId, $skillId: skillId });
    }

    addSubAgentId(canvasId: string, podId: string, subAgentId: string): void {
        this.stmts.podSubAgentIds.insert.run({ $podId: podId, $subAgentId: subAgentId });
    }

    addMcpServerId(canvasId: string, podId: string, mcpServerId: string): void {
        this.stmts.podMcpServerIds.insert.run({ $podId: podId, $mcpServerId: mcpServerId });
    }

    removeMcpServerId(canvasId: string, podId: string, mcpServerId: string): void {
        this.stmts.podMcpServerIds.deleteOne.run({ $podId: podId, $mcpServerId: mcpServerId });
    }

    private findByJoinTableId(
        canvasId: string,
        selectByValueId: ReturnType<typeof getStatements>['podSkillIds']['selectBySkillId'],
        valueId: string
    ): Pod[] {
        const podIdRows = selectByValueId.all(valueId) as Array<{ pod_id: string }>;
        const rows = podIdRows
            .map(r => this.stmts.pod.selectByCanvasIdAndId.get(canvasId, r.pod_id) as PodRow | undefined)
            .filter((row): row is PodRow => row !== undefined);
        return this.toPodListWithBindings(rows);
    }

    private replaceJoinTableIds(
        podId: string,
        stmtGroup: { deleteByPodId: ReturnType<typeof getStatements>['podSkillIds']['deleteByPodId']; insert: ReturnType<typeof getStatements>['podSkillIds']['insert'] },
        valueIds: string[],
        buildParams: (valueId: string) => Record<string, string>
    ): void {
        stmtGroup.deleteByPodId.run(podId);
        for (const valueId of valueIds) {
            stmtGroup.insert.run(buildParams(valueId));
        }
    }

    findBySkillId(canvasId: string, skillId: string): Pod[] {
        return this.findByJoinTableId(canvasId, this.stmts.podSkillIds.selectBySkillId, skillId);
    }

    findBySubAgentId(canvasId: string, subAgentId: string): Pod[] {
        return this.findByJoinTableId(canvasId, this.stmts.podSubAgentIds.selectBySubAgentId, subAgentId);
    }

    findByMcpServerId(canvasId: string, mcpServerId: string): Pod[] {
        return this.findByJoinTableId(canvasId, this.stmts.podMcpServerIds.selectByMcpServerId, mcpServerId);
    }

    private findByDirectColumn(
        canvasId: string,
        statement: ReturnType<Database['prepare']>,
        id: string
    ): Pod[] {
        const rows = (statement.all(id) as PodRow[]).filter(r => r.canvas_id === canvasId);
        return this.toPodListWithBindings(rows);
    }

    findByCommandId(canvasId: string, commandId: string): Pod[] {
        return this.findByDirectColumn(canvasId, this.stmts.pod.selectByCommandId, commandId);
    }

    findByOutputStyleId(canvasId: string, outputStyleId: string): Pod[] {
        return this.findByDirectColumn(canvasId, this.stmts.pod.selectByOutputStyleId, outputStyleId);
    }

    findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
        return this.findByDirectColumn(canvasId, this.stmts.pod.selectByRepositoryId, repositoryId);
    }

    setRepositoryId(canvasId: string, id: string, repositoryId: string | null): void {
        this.stmts.pod.updateRepositoryId.run({ $repositoryId: repositoryId, $id: id });
    }

    setAutoClear(canvasId: string, id: string, autoClear: boolean): void {
        this.stmts.pod.updateAutoClear.run({ $autoClear: autoClear ? 1 : 0, $id: id });
    }

    setCommandId(canvasId: string, podId: string, commandId: string | null): void {
        this.stmts.pod.updateCommandId.run({ $commandId: commandId, $id: podId });
    }

    findByIntegrationApp(appId: string): Array<{ canvasId: string; pod: Pod }> {
        const bindingRows = this.stmts.integrationBinding.selectByAppId.all(appId) as IntegrationBindingRow[];
        const podIds = [...new Set(bindingRows.map(r => r.pod_id))];
        return podIds
            .map(id => this.stmts.pod.selectById.get(id) as PodRow | undefined)
            .filter((row): row is PodRow => row !== undefined)
            .map(row => ({ canvasId: row.canvas_id, pod: this.toPodWithBindings(row) }));
    }

    findByIntegrationAppAndResource(appId: string, resourceId: string): Array<{ canvasId: string; pod: Pod }> {
        const bindingRows = this.stmts.integrationBinding.selectByAppIdAndResourceId.all(appId, resourceId) as IntegrationBindingRow[];
        const podIds = [...new Set(bindingRows.map(r => r.pod_id))];
        return podIds
            .map(id => this.stmts.pod.selectById.get(id) as PodRow | undefined)
            .filter((row): row is PodRow => row !== undefined)
            .map(row => ({ canvasId: row.canvas_id, pod: this.toPodWithBindings(row) }));
    }

    addIntegrationBinding(canvasId: string, podId: string, binding: IntegrationBinding): void {
        // 相同 provider + appId 先刪除再插入，避免重複
        this.stmts.integrationBinding.deleteByPodIdAndProvider.run(podId, binding.provider);
        const id = randomUUID();
        this.stmts.integrationBinding.insert.run({
            $id: id,
            $podId: podId,
            $canvasId: canvasId,
            $provider: binding.provider,
            $appId: binding.appId,
            $resourceId: binding.resourceId,
            $extraJson: binding.extra ? JSON.stringify(binding.extra) : null,
        });
    }

    removeIntegrationBinding(_canvasId: string, podId: string, provider: string): void {
        this.stmts.integrationBinding.deleteByPodIdAndProvider.run(podId, provider);
    }

    setScheduleLastTriggeredAt(canvasId: string, podId: string, date: Date): void {
        const pod = this.getById(canvasId, podId);
        if (!pod?.schedule) return;

        const updatedSchedule: ScheduleConfig = { ...pod.schedule, lastTriggeredAt: date };
        this.stmts.pod.updateScheduleJson.run({
            $scheduleJson: serializeSchedule(updatedSchedule),
            $id: podId,
        });
    }

    getAllWithSchedule(): Array<{ canvasId: string; pod: Pod }> {
        const rows = this.stmts.pod.selectWithSchedule.all() as PodRow[];
        return rows
            .map(row => ({ canvasId: row.canvas_id, pod: this.toPodWithBindings(row) }))
            .filter(({ pod }) => pod.schedule?.enabled === true);
    }

}

export const podStore = new PodStore();
