import { v4 as uuidv4 } from 'uuid';
import { WebSocketResponseEvents } from '../schemas';
import type { Pod, PodStatus, CreatePodRequest, ScheduleConfig } from '../types';
import type { PodSlackBinding } from '../types';
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
    slack_binding_json: string | null;
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

    if (row.slack_binding_json) {
        const binding = safeJsonParse<PodSlackBinding>(row.slack_binding_json);
        if (binding) {
            pod.slackBinding = binding;
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

function serializeSlackBinding(binding?: PodSlackBinding): string | null {
    if (!binding) return null;
    return JSON.stringify(binding);
}

class PodStore {
    private get stmts(): ReturnType<typeof getStatements> {
        return getStatements(getDb());
    }

    create(canvasId: string, data: CreatePodRequest): { pod: Pod; persisted: Promise<void> } {
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
            $slackBindingJson: null,
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
        return rowToPod(row);
    }

    getByIdGlobal(podId: string): { canvasId: string; pod: Pod } | undefined {
        const row = this.stmts.pod.selectById.get(podId) as PodRow | undefined;
        if (!row) return undefined;
        return { canvasId: row.canvas_id, pod: rowToPod(row) };
    }

    getAll(canvasId: string): Pod[] {
        return this.list(canvasId);
    }

    list(canvasId: string): Pod[] {
        const rows = this.stmts.pod.selectByCanvasId.all(canvasId) as PodRow[];
        return rows.map(rowToPod);
    }

    getByName(canvasId: string, name: string): Pod | undefined {
        const row = this.stmts.pod.selectByCanvasIdAndName.get(canvasId, name) as PodRow | undefined;
        if (!row) return undefined;
        return rowToPod(row);
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
            $slackBindingJson: serializeSlackBinding(updatedPod.slackBinding),
        });

        if (updates.skillIds !== undefined) {
            this.stmts.podSkillIds.deleteByPodId.run(id);
            for (const skillId of updates.skillIds) {
                this.stmts.podSkillIds.insert.run({ $podId: id, $skillId: skillId });
            }
        }

        if (updates.subAgentIds !== undefined) {
            this.stmts.podSubAgentIds.deleteByPodId.run(id);
            for (const subAgentId of updates.subAgentIds) {
                this.stmts.podSubAgentIds.insert.run({ $podId: id, $subAgentId: subAgentId });
            }
        }

        if (updates.mcpServerIds !== undefined) {
            this.stmts.podMcpServerIds.deleteByPodId.run(id);
            for (const mcpServerId of updates.mcpServerIds) {
                this.stmts.podMcpServerIds.insert.run({ $podId: id, $mcpServerId: mcpServerId });
            }
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

    setClaudeSessionId(canvasId: string, id: string, sessionId: string): Promise<void> {
        this.stmts.pod.updateClaudeSessionId.run({ $claudeSessionId: sessionId, $id: id });
        return Promise.resolve();
    }

    resetClaudeSession(canvasId: string, podId: string): Promise<void> {
        return this.setClaudeSessionId(canvasId, podId, '');
    }

    setOutputStyleId(canvasId: string, id: string, outputStyleId: string | null): Promise<void> {
        this.stmts.pod.updateOutputStyleId.run({ $outputStyleId: outputStyleId, $id: id });
        return Promise.resolve();
    }

    addSkillId(canvasId: string, podId: string, skillId: string): Promise<void> {
        this.stmts.podSkillIds.insert.run({ $podId: podId, $skillId: skillId });
        return Promise.resolve();
    }

    addSubAgentId(canvasId: string, podId: string, subAgentId: string): Promise<void> {
        this.stmts.podSubAgentIds.insert.run({ $podId: podId, $subAgentId: subAgentId });
        return Promise.resolve();
    }

    addMcpServerId(canvasId: string, podId: string, mcpServerId: string): Promise<void> {
        this.stmts.podMcpServerIds.insert.run({ $podId: podId, $mcpServerId: mcpServerId });
        return Promise.resolve();
    }

    removeMcpServerId(canvasId: string, podId: string, mcpServerId: string): Promise<void> {
        this.stmts.podMcpServerIds.deleteOne.run({ $podId: podId, $mcpServerId: mcpServerId });
        return Promise.resolve();
    }

    findBySkillId(canvasId: string, skillId: string): Pod[] {
        const podIdRows = this.stmts.podSkillIds.selectBySkillId.all(skillId) as Array<{ pod_id: string }>;
        return podIdRows
            .map(r => this.stmts.pod.selectByCanvasIdAndId.get(canvasId, r.pod_id) as PodRow | undefined)
            .filter((row): row is PodRow => row !== undefined)
            .map(rowToPod);
    }

    findBySubAgentId(canvasId: string, subAgentId: string): Pod[] {
        const podIdRows = this.stmts.podSubAgentIds.selectBySubAgentId.all(subAgentId) as Array<{ pod_id: string }>;
        return podIdRows
            .map(r => this.stmts.pod.selectByCanvasIdAndId.get(canvasId, r.pod_id) as PodRow | undefined)
            .filter((row): row is PodRow => row !== undefined)
            .map(rowToPod);
    }

    findByMcpServerId(canvasId: string, mcpServerId: string): Pod[] {
        const podIdRows = this.stmts.podMcpServerIds.selectByMcpServerId.all(mcpServerId) as Array<{ pod_id: string }>;
        return podIdRows
            .map(r => this.stmts.pod.selectByCanvasIdAndId.get(canvasId, r.pod_id) as PodRow | undefined)
            .filter((row): row is PodRow => row !== undefined)
            .map(rowToPod);
    }

    findByCommandId(canvasId: string, commandId: string): Pod[] {
        const rows = this.stmts.pod.selectByCommandId.all(commandId) as PodRow[];
        return rows.filter(r => r.canvas_id === canvasId).map(rowToPod);
    }

    findByOutputStyleId(canvasId: string, outputStyleId: string): Pod[] {
        const rows = this.stmts.pod.selectByOutputStyleId.all(outputStyleId) as PodRow[];
        return rows.filter(r => r.canvas_id === canvasId).map(rowToPod);
    }

    findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
        const rows = this.stmts.pod.selectByRepositoryId.all(repositoryId) as PodRow[];
        return rows.filter(r => r.canvas_id === canvasId).map(rowToPod);
    }

    setRepositoryId(canvasId: string, id: string, repositoryId: string | null): Promise<void> {
        this.stmts.pod.updateRepositoryId.run({ $repositoryId: repositoryId, $id: id });
        return Promise.resolve();
    }

    setAutoClear(canvasId: string, id: string, autoClear: boolean): Promise<void> {
        this.stmts.pod.updateAutoClear.run({ $autoClear: autoClear ? 1 : 0, $id: id });
        return Promise.resolve();
    }

    setCommandId(canvasId: string, podId: string, commandId: string | null): Promise<void> {
        this.stmts.pod.updateCommandId.run({ $commandId: commandId, $id: podId });
        return Promise.resolve();
    }

    setSlackBinding(canvasId: string, podId: string, binding: PodSlackBinding | null): Promise<void> {
        this.stmts.pod.updateSlackBindingJson.run({
            $slackBindingJson: binding ? JSON.stringify(binding) : null,
            $id: podId,
        });
        return Promise.resolve();
    }

    findBySlackApp(slackAppId: string): Array<{ canvasId: string; pod: Pod }> {
        const rows = this.stmts.pod.selectBySlackAppId.all(slackAppId) as PodRow[];
        return rows.map(row => ({ canvasId: row.canvas_id, pod: rowToPod(row) }));
    }

    setScheduleLastTriggeredAt(canvasId: string, podId: string, date: Date): Promise<void> {
        const pod = this.getById(canvasId, podId);
        if (!pod?.schedule) return Promise.resolve();

        const updatedSchedule: ScheduleConfig = { ...pod.schedule, lastTriggeredAt: date };
        this.stmts.pod.updateScheduleJson.run({
            $scheduleJson: serializeSchedule(updatedSchedule),
            $id: podId,
        });
        return Promise.resolve();
    }

    getAllWithSchedule(): Array<{ canvasId: string; pod: Pod }> {
        const rows = this.stmts.pod.selectWithSchedule.all() as PodRow[];
        return rows
            .map(row => ({ canvasId: row.canvas_id, pod: rowToPod(row) }))
            .filter(({ pod }) => pod.schedule?.enabled === true);
    }

}

export const podStore = new PodStore();
