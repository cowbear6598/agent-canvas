import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import { WebSocketResponseEvents } from "../schemas";
import type {
  Pod,
  PodStatus,
  CreatePodRequest,
  ScheduleConfig,
} from "../types";
import type { IntegrationBinding } from "../types/integration.js";
import { socketService } from "./socketService.js";
import { canvasStore } from "./canvasStore.js";
import { getStmts } from "../database/stmtsHelper.js";
import { getDb } from "../database/index.js";
import { safeJsonParse } from "../utils/safeJsonParse.js";

type PodUpdates = Partial<Omit<Pod, "schedule">> & {
  schedule?: ScheduleConfig | null;
};

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
  multi_instance: number;
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
  const stmts = getStmts();

  const skillRows = stmts.podSkillIds.selectByPodId.all(row.id) as Array<{
    skill_id: string;
  }>;
  const subAgentRows = stmts.podSubAgentIds.selectByPodId.all(row.id) as Array<{
    sub_agent_id: string;
  }>;
  const mcpServerRows = stmts.podMcpServerIds.selectByPodId.all(
    row.id,
  ) as Array<{ mcp_server_id: string }>;
  const pluginRows = stmts.podPluginIds.selectByPodId.all(row.id) as Array<{
    plugin_id: string;
  }>;

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
    skillIds: skillRows.map((r) => r.skill_id),
    subAgentIds: subAgentRows.map((r) => r.sub_agent_id),
    mcpServerIds: mcpServerRows.map((r) => r.mcp_server_id),
    pluginIds: pluginRows.map((r) => r.plugin_id),
    model: row.model as Pod["model"],
    repositoryId: row.repository_id,
    commandId: row.command_id,
    multiInstance: row.multi_instance === 1,
  };

  if (row.schedule_json) {
    const persisted = safeJsonParse<Record<string, unknown>>(row.schedule_json);
    if (persisted) {
      pod.schedule = {
        ...persisted,
        lastTriggeredAt: persisted.lastTriggeredAt
          ? new Date(persisted.lastTriggeredAt as string)
          : null,
      } as ScheduleConfig;
    }
  }

  return pod;
}

function serializeSchedule(schedule?: ScheduleConfig): string | null {
  if (!schedule) return null;
  return JSON.stringify({
    ...schedule,
    lastTriggeredAt: schedule.lastTriggeredAt
      ? schedule.lastTriggeredAt.toISOString()
      : null,
  });
}

class PodStore {
  /** 以 podIds 長度為 key 快取 batchLoadRelations 用的 PreparedStatement */
  private readonly relationsStmtCache = new Map<
    number,
    {
      skill: ReturnType<Database["prepare"]>;
      subAgent: ReturnType<Database["prepare"]>;
      mcpServer: ReturnType<Database["prepare"]>;
      plugin: ReturnType<Database["prepare"]>;
    }
  >();

  /** 以 podIds 長度為 key 快取 batchLoadBindings 用的 PreparedStatement */
  private readonly bindingsStmtCache = new Map<
    number,
    ReturnType<Database["prepare"]>
  >();

  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  private loadBindingsForPod(podId: string): IntegrationBinding[] {
    const rows = this.stmts.integrationBinding.selectByPodId.all(
      podId,
    ) as IntegrationBindingRow[];
    return rows.map((row) => ({
      provider: row.provider,
      appId: row.app_id,
      resourceId: row.resource_id,
      extra: row.extra_json
        ? (safeJsonParse<Record<string, unknown>>(row.extra_json) ?? undefined)
        : undefined,
    }));
  }

  private toPodWithBindings(row: PodRow): Pod {
    const pod = rowToPod(row);
    pod.integrationBindings = this.loadBindingsForPod(pod.id);
    return pod;
  }

  /**
   * 批次載入多個 Pod 的關聯表資料（skill、subAgent、mcpServer、plugin）。
   * 使用 WHERE pod_id IN (...) 一次查詢，避免 N+1 問題。
   * PreparedStatement 以 podIds.length 為 key 快取，避免重複 prepare。
   * 僅用於列表查詢（如 list()），單筆查詢請改用 rowToPod()。
   */
  private batchLoadRelations(podIds: string[]): {
    skillIds: Map<string, string[]>;
    subAgentIds: Map<string, string[]>;
    mcpServerIds: Map<string, string[]>;
    pluginIds: Map<string, string[]>;
  } {
    if (podIds.length === 0) {
      return {
        skillIds: new Map(),
        subAgentIds: new Map(),
        mcpServerIds: new Map(),
        pluginIds: new Map(),
      };
    }

    const n = podIds.length;
    let cached = this.relationsStmtCache.get(n);
    if (!cached) {
      const db = getDb();
      const placeholders = podIds.map(() => "?").join(", ");
      cached = {
        skill: db.prepare(
          `SELECT pod_id, skill_id FROM pod_skill_ids WHERE pod_id IN (${placeholders})`,
        ),
        subAgent: db.prepare(
          `SELECT pod_id, sub_agent_id FROM pod_sub_agent_ids WHERE pod_id IN (${placeholders})`,
        ),
        mcpServer: db.prepare(
          `SELECT pod_id, mcp_server_id FROM pod_mcp_server_ids WHERE pod_id IN (${placeholders})`,
        ),
        plugin: db.prepare(
          `SELECT pod_id, plugin_id FROM pod_plugin_ids WHERE pod_id IN (${placeholders})`,
        ),
      };
      this.relationsStmtCache.set(n, cached);
    }

    const skillRows = cached.skill.all(...podIds) as Array<{
      pod_id: string;
      skill_id: string;
    }>;
    const subAgentRows = cached.subAgent.all(...podIds) as Array<{
      pod_id: string;
      sub_agent_id: string;
    }>;
    const mcpServerRows = cached.mcpServer.all(...podIds) as Array<{
      pod_id: string;
      mcp_server_id: string;
    }>;
    const pluginRows = cached.plugin.all(...podIds) as Array<{
      pod_id: string;
      plugin_id: string;
    }>;

    const skillIds = new Map<string, string[]>();
    const subAgentIds = new Map<string, string[]>();
    const mcpServerIds = new Map<string, string[]>();
    const pluginIds = new Map<string, string[]>();

    for (const r of skillRows) {
      if (!skillIds.has(r.pod_id)) skillIds.set(r.pod_id, []);
      skillIds.get(r.pod_id)!.push(r.skill_id);
    }
    for (const r of subAgentRows) {
      if (!subAgentIds.has(r.pod_id)) subAgentIds.set(r.pod_id, []);
      subAgentIds.get(r.pod_id)!.push(r.sub_agent_id);
    }
    for (const r of mcpServerRows) {
      if (!mcpServerIds.has(r.pod_id)) mcpServerIds.set(r.pod_id, []);
      mcpServerIds.get(r.pod_id)!.push(r.mcp_server_id);
    }
    for (const r of pluginRows) {
      if (!pluginIds.has(r.pod_id)) pluginIds.set(r.pod_id, []);
      pluginIds.get(r.pod_id)!.push(r.plugin_id);
    }

    return { skillIds, subAgentIds, mcpServerIds, pluginIds };
  }

  /**
   * 批次載入多個 Pod 的 integration binding 資料。
   * 使用 WHERE pod_id IN (...) 一次查詢，避免 N+1 問題。
   * PreparedStatement 以 podIds.length 為 key 快取，避免重複 prepare。
   * 僅用於列表查詢（如 list()），單筆查詢請改用 loadBindingsForPod()。
   */
  private batchLoadBindings(
    podIds: string[],
  ): Map<string, IntegrationBinding[]> {
    if (podIds.length === 0) {
      return new Map();
    }

    const n = podIds.length;
    let stmt = this.bindingsStmtCache.get(n);
    if (!stmt) {
      const db = getDb();
      const placeholders = podIds.map(() => "?").join(", ");
      stmt = db.prepare(
        `SELECT * FROM integration_bindings WHERE pod_id IN (${placeholders})`,
      );
      this.bindingsStmtCache.set(n, stmt);
    }

    const rows = stmt.all(...podIds) as IntegrationBindingRow[];

    const result = new Map<string, IntegrationBinding[]>();

    for (const row of rows) {
      if (!result.has(row.pod_id)) result.set(row.pod_id, []);
      result.get(row.pod_id)!.push({
        provider: row.provider,
        appId: row.app_id,
        resourceId: row.resource_id,
        extra: row.extra_json
          ? (safeJsonParse<Record<string, unknown>>(row.extra_json) ??
            undefined)
          : undefined,
      });
    }

    return result;
  }

  /**
   * 將多筆 PodRow 組合為 Pod 陣列，使用批次查詢取代逐筆子查詢。
   * 僅用於列表查詢（如 list()），避免 N+1 問題。
   */
  private rowsToPods(rows: PodRow[]): Pod[] {
    if (rows.length === 0) return [];

    const podIds = rows.map((r) => r.id);
    const relations = this.batchLoadRelations(podIds);
    const bindingsMap = this.batchLoadBindings(podIds);

    return rows.map((row) => {
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
        skillIds: relations.skillIds.get(row.id) ?? [],
        subAgentIds: relations.subAgentIds.get(row.id) ?? [],
        mcpServerIds: relations.mcpServerIds.get(row.id) ?? [],
        pluginIds: relations.pluginIds.get(row.id) ?? [],
        model: row.model as Pod["model"],
        repositoryId: row.repository_id,
        commandId: row.command_id,
        multiInstance: row.multi_instance === 1,
        integrationBindings: bindingsMap.get(row.id) ?? [],
      };

      if (row.schedule_json) {
        const persisted = safeJsonParse<Record<string, unknown>>(
          row.schedule_json,
        );
        if (persisted) {
          pod.schedule = {
            ...persisted,
            lastTriggeredAt: persisted.lastTriggeredAt
              ? new Date(persisted.lastTriggeredAt as string)
              : null,
          } as ScheduleConfig;
        }
      }

      return pod;
    });
  }

  create(
    canvasId: string,
    data: CreatePodRequest,
  ): { pod: Pod; persisted: Promise<void> } {
    const id = randomUUID();
    const canvasDir = canvasStore.getCanvasDir(canvasId);

    if (!canvasDir) {
      throw new Error(`找不到 Canvas：${canvasId}`);
    }

    const pod: Pod = {
      id,
      name: data.name,
      status: "idle",
      workspacePath: `${canvasDir}/pod-${id}`,
      x: data.x,
      y: data.y,
      rotation: data.rotation,
      claudeSessionId: null,
      outputStyleId: data.outputStyleId ?? null,
      skillIds: data.skillIds ?? [],
      subAgentIds: data.subAgentIds ?? [],
      mcpServerIds: data.mcpServerIds ?? [],
      pluginIds: data.pluginIds ?? [],
      model: data.model ?? "opus",
      repositoryId: data.repositoryId ?? null,
      commandId: data.commandId ?? null,
      multiInstance: false,
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
      $multiInstance: 0,
      $scheduleJson: null,
    });

    for (const skillId of pod.skillIds) {
      this.stmts.podSkillIds.insert.run({ $podId: id, $skillId: skillId });
    }

    for (const subAgentId of pod.subAgentIds) {
      this.stmts.podSubAgentIds.insert.run({
        $podId: id,
        $subAgentId: subAgentId,
      });
    }

    for (const mcpServerId of pod.mcpServerIds) {
      this.stmts.podMcpServerIds.insert.run({
        $podId: id,
        $mcpServerId: mcpServerId,
      });
    }

    for (const pluginId of pod.pluginIds) {
      this.stmts.podPluginIds.insert.run({ $podId: id, $pluginId: pluginId });
    }

    return { pod, persisted: Promise.resolve() };
  }

  getById(canvasId: string, id: string): Pod | undefined {
    const row = this.stmts.pod.selectByCanvasIdAndId.get(canvasId, id) as
      | PodRow
      | undefined;
    if (!row) return undefined;
    return this.toPodWithBindings(row);
  }

  getByIdGlobal(podId: string): { canvasId: string; pod: Pod } | undefined {
    const row = this.stmts.pod.selectById.get(podId) as PodRow | undefined;
    if (!row) return undefined;
    return { canvasId: row.canvas_id, pod: this.toPodWithBindings(row) };
  }

  list(canvasId: string): Pod[] {
    const rows = this.stmts.pod.selectByCanvasId.all(canvasId) as PodRow[];
    // 使用批次查詢取代逐筆子查詢，避免 N+1 問題
    return this.rowsToPods(rows);
  }

  /** @deprecated 請改用 list() */
  getAll(canvasId: string): Pod[] {
    return this.list(canvasId);
  }

  getByName(canvasId: string, name: string): Pod | undefined {
    const row = this.stmts.pod.selectByCanvasIdAndName.get(canvasId, name) as
      | PodRow
      | undefined;
    if (!row) return undefined;
    return this.toPodWithBindings(row);
  }

  hasName(canvasId: string, name: string, excludePodId?: string): boolean {
    const result = this.stmts.pod.countByCanvasIdAndName.get({
      $canvasId: canvasId,
      $name: name,
      $excludeId: excludePodId ?? "",
    }) as { count: number };
    return result.count > 0;
  }

  /**
   * 將傳入的 schedule 與現有 Pod 的排程合併：
   * - 明確傳入 null 時刪除排程（回傳 undefined）
   * - 傳入 schedule 物件時保留其 lastTriggeredAt，若缺少則補 null
   * - 未傳入 schedule 時維持現有排程不變
   */
  private mergeSchedule(
    existing: Pod,
    incoming: PodUpdates,
  ): ScheduleConfig | undefined {
    if ("schedule" in incoming && incoming.schedule === null) {
      return undefined;
    }
    if (incoming.schedule) {
      return incoming.schedule.lastTriggeredAt
        ? incoming.schedule
        : { ...incoming.schedule, lastTriggeredAt: null };
    }
    return existing.schedule;
  }

  /**
   * 依照 updates 中提供的 id 陣列，重新寫入四張 join table（skillIds、subAgentIds、mcpServerIds、pluginIds）。
   * 未傳入的欄位（undefined）視為不更新，維持原有資料。
   */
  private updateJoinTables(podId: string, updates: PodUpdates): void {
    if (updates.skillIds !== undefined) {
      this.replaceJoinTableIds(
        podId,
        this.stmts.podSkillIds,
        updates.skillIds,
        (valueId) => ({ $podId: podId, $skillId: valueId }),
      );
    }

    if (updates.subAgentIds !== undefined) {
      this.replaceJoinTableIds(
        podId,
        this.stmts.podSubAgentIds,
        updates.subAgentIds,
        (valueId) => ({ $podId: podId, $subAgentId: valueId }),
      );
    }

    if (updates.mcpServerIds !== undefined) {
      this.replaceJoinTableIds(
        podId,
        this.stmts.podMcpServerIds,
        updates.mcpServerIds,
        (valueId) => ({ $podId: podId, $mcpServerId: valueId }),
      );
    }

    if (updates.pluginIds !== undefined) {
      this.replaceJoinTableIds(
        podId,
        this.stmts.podPluginIds,
        updates.pluginIds,
        (valueId) => ({ $podId: podId, $pluginId: valueId }),
      );
    }
  }

  update(
    canvasId: string,
    id: string,
    updates: PodUpdates,
  ): { pod: Pod; persisted: Promise<void> } | undefined {
    const pod = this.getById(canvasId, id);
    if (!pod) return undefined;

    const safeUpdates = Object.fromEntries(
      Object.entries(updates as PodUpdates & Partial<Pod>).filter(
        ([key]) =>
          key !== "id" && key !== "workspacePath" && key !== "schedule",
      ),
    ) as Partial<Pod>;
    const updatedPod: Pod = {
      ...pod,
      ...safeUpdates,
      schedule: this.mergeSchedule(pod, updates),
    };

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
      $multiInstance: updatedPod.multiInstance ? 1 : 0,
      $scheduleJson: serializeSchedule(updatedPod.schedule),
    });

    this.updateJoinTables(id, updates);

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

    socketService.emitToCanvas(
      canvasId,
      WebSocketResponseEvents.POD_STATUS_CHANGED,
      {
        canvasId,
        podId: id,
        status,
        previousStatus,
      },
    );
  }

  setClaudeSessionId(canvasId: string, id: string, sessionId: string): void {
    this.stmts.pod.updateClaudeSessionId.run({
      $claudeSessionId: sessionId,
      $id: id,
    });
  }

  resetClaudeSession(canvasId: string, podId: string): void {
    this.setClaudeSessionId(canvasId, podId, "");
  }

  setOutputStyleId(
    canvasId: string,
    id: string,
    outputStyleId: string | null,
  ): void {
    this.stmts.pod.updateOutputStyleId.run({
      $outputStyleId: outputStyleId,
      $id: id,
    });
  }

  addSkillId(canvasId: string, podId: string, skillId: string): void {
    this.stmts.podSkillIds.insert.run({ $podId: podId, $skillId: skillId });
  }

  addSubAgentId(canvasId: string, podId: string, subAgentId: string): void {
    this.stmts.podSubAgentIds.insert.run({
      $podId: podId,
      $subAgentId: subAgentId,
    });
  }

  addMcpServerId(canvasId: string, podId: string, mcpServerId: string): void {
    this.stmts.podMcpServerIds.insert.run({
      $podId: podId,
      $mcpServerId: mcpServerId,
    });
  }

  removeMcpServerId(
    canvasId: string,
    podId: string,
    mcpServerId: string,
  ): void {
    this.stmts.podMcpServerIds.deleteOne.run({
      $podId: podId,
      $mcpServerId: mcpServerId,
    });
  }

  private findByJoinTableId(
    canvasId: string,
    selectByValueId: ReturnType<
      typeof getStmts
    >["podSkillIds"]["selectBySkillId"],
    valueId: string,
  ): Pod[] {
    const podIdRows = selectByValueId.all(valueId) as Array<{ pod_id: string }>;
    const podIds = podIdRows.map((r) => r.pod_id);
    if (podIds.length === 0) return [];

    // 用 WHERE id IN (...) 一次取得所有 Pod，再過濾 canvas，避免 N+1
    const db = getDb();
    const placeholders = podIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT * FROM pods WHERE canvas_id = ? AND id IN (${placeholders})`,
      )
      .all(canvasId, ...podIds) as PodRow[];
    return this.rowsToPods(rows);
  }

  private replaceJoinTableIds(
    podId: string,
    stmtGroup: {
      deleteByPodId: ReturnType<
        typeof getStmts
      >["podSkillIds"]["deleteByPodId"];
      insert: ReturnType<typeof getStmts>["podSkillIds"]["insert"];
    },
    valueIds: string[],
    buildParams: (valueId: string) => Record<string, string>,
  ): void {
    stmtGroup.deleteByPodId.run(podId);
    for (const valueId of valueIds) {
      stmtGroup.insert.run(buildParams(valueId));
    }
  }

  findBySkillId(canvasId: string, skillId: string): Pod[] {
    return this.findByJoinTableId(
      canvasId,
      this.stmts.podSkillIds.selectBySkillId,
      skillId,
    );
  }

  findBySubAgentId(canvasId: string, subAgentId: string): Pod[] {
    return this.findByJoinTableId(
      canvasId,
      this.stmts.podSubAgentIds.selectBySubAgentId,
      subAgentId,
    );
  }

  findByMcpServerId(canvasId: string, mcpServerId: string): Pod[] {
    return this.findByJoinTableId(
      canvasId,
      this.stmts.podMcpServerIds.selectByMcpServerId,
      mcpServerId,
    );
  }

  private findByDirectColumn(
    canvasId: string,
    statement: ReturnType<Database["prepare"]>,
    id: string,
  ): Pod[] {
    const rows = (statement.all(id) as PodRow[]).filter(
      (r) => r.canvas_id === canvasId,
    );
    return this.rowsToPods(rows);
  }

  findByCommandId(canvasId: string, commandId: string): Pod[] {
    return this.findByDirectColumn(
      canvasId,
      this.stmts.pod.selectByCommandId,
      commandId,
    );
  }

  findByOutputStyleId(canvasId: string, outputStyleId: string): Pod[] {
    return this.findByDirectColumn(
      canvasId,
      this.stmts.pod.selectByOutputStyleId,
      outputStyleId,
    );
  }

  findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
    return this.findByDirectColumn(
      canvasId,
      this.stmts.pod.selectByRepositoryId,
      repositoryId,
    );
  }

  setRepositoryId(
    canvasId: string,
    id: string,
    repositoryId: string | null,
  ): void {
    this.stmts.pod.updateRepositoryId.run({
      $repositoryId: repositoryId,
      $id: id,
    });
  }

  setMultiInstance(canvasId: string, id: string, multiInstance: boolean): void {
    this.stmts.pod.updateMultiInstance.run({
      $multiInstance: multiInstance ? 1 : 0,
      $id: id,
    });
  }

  setCommandId(
    canvasId: string,
    podId: string,
    commandId: string | null,
  ): void {
    this.stmts.pod.updateCommandId.run({ $commandId: commandId, $id: podId });
  }

  findByIntegrationApp(appId: string): Array<{ canvasId: string; pod: Pod }> {
    const bindingRows = this.stmts.integrationBinding.selectByAppId.all(
      appId,
    ) as IntegrationBindingRow[];
    const podIds = [...new Set(bindingRows.map((r) => r.pod_id))];
    if (podIds.length === 0) return [];

    // 用 WHERE id IN (...) 一次取得所有 Pod，避免 N+1
    const db = getDb();
    const placeholders = podIds.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT * FROM pods WHERE id IN (${placeholders})`)
      .all(...podIds) as PodRow[];
    const canvasIdMap = new Map(rows.map((r) => [r.id, r.canvas_id]));
    const pods = this.rowsToPods(rows);
    return pods.map((pod) => ({ canvasId: canvasIdMap.get(pod.id)!, pod }));
  }

  findByIntegrationAppAndResource(
    appId: string,
    resourceId: string,
  ): Array<{ canvasId: string; pod: Pod }> {
    const bindingRows =
      this.stmts.integrationBinding.selectByAppIdAndResourceId.all(
        appId,
        resourceId,
      ) as IntegrationBindingRow[];
    const podIds = [...new Set(bindingRows.map((r) => r.pod_id))];
    if (podIds.length === 0) return [];

    // 用 WHERE id IN (...) 一次取得所有 Pod，避免 N+1
    const db = getDb();
    const placeholders = podIds.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT * FROM pods WHERE id IN (${placeholders})`)
      .all(...podIds) as PodRow[];
    const canvasIdMap = new Map(rows.map((r) => [r.id, r.canvas_id]));
    const pods = this.rowsToPods(rows);
    return pods.map((pod) => ({ canvasId: canvasIdMap.get(pod.id)!, pod }));
  }

  addIntegrationBinding(
    canvasId: string,
    podId: string,
    binding: IntegrationBinding,
  ): void {
    // 相同 provider + appId 先刪除再插入，避免重複
    this.stmts.integrationBinding.deleteByPodIdAndProvider.run(
      podId,
      binding.provider,
    );
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

  removeIntegrationBinding(
    _canvasId: string,
    podId: string,
    provider: string,
  ): void {
    this.stmts.integrationBinding.deleteByPodIdAndProvider.run(podId, provider);
  }

  setScheduleLastTriggeredAt(
    canvasId: string,
    podId: string,
    date: Date,
  ): void {
    const pod = this.getById(canvasId, podId);
    if (!pod?.schedule) return;

    const updatedSchedule: ScheduleConfig = {
      ...pod.schedule,
      lastTriggeredAt: date,
    };
    this.stmts.pod.updateScheduleJson.run({
      $scheduleJson: serializeSchedule(updatedSchedule),
      $id: podId,
    });
  }

  getAllWithSchedule(): Array<{ canvasId: string; pod: Pod }> {
    const rows = this.stmts.pod.selectWithSchedule.all() as PodRow[];
    // 使用批次查詢取代逐筆子查詢，避免 N+1 問題
    const canvasIdMap = new Map(rows.map((r) => [r.id, r.canvas_id]));
    const pods = this.rowsToPods(rows);
    return pods
      .filter((pod) => pod.schedule?.enabled === true)
      .map((pod) => ({ canvasId: canvasIdMap.get(pod.id)!, pod }));
  }

  /**
   * 將所有 chatting 或 summarizing 狀態的 Pod 重設為 idle（僅更新 DB，不廣播 WebSocket）
   * 用於 graceful shutdown 時清理 busy 狀態的 Pod
   */
  resetAllBusyPods(): number {
    const result = getDb()
      .prepare(
        "UPDATE pods SET status = 'idle' WHERE status IN ('chatting', 'summarizing')",
      )
      .run() as { changes: number };
    return result.changes;
  }
}

export const podStore = new PodStore();
