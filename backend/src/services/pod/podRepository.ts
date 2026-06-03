import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import type { Pod } from "../../types/index.js";
import type { IntegrationBinding } from "../../types/integration.js";
import { getDb } from "../../database/index.js";
import { getStmts } from "../../database/stmtsHelper.js";
import type { PodUpdates } from "./podUpdatePolicy.js";
import { serializeSchedule } from "./podUpdatePolicy.js";
import {
  mapIntegrationBindingRow,
  type IntegrationBindingRow,
  type PodRow,
} from "./podRowMapper.js";

const STMT_CACHE_MAX = 32;

function lruSet<K, V>(cache: Map<K, V>, cacheKey: K, stmt: V): void {
  if (cache.size >= STMT_CACHE_MAX) {
    cache.delete(cache.keys().next().value as K);
  }
  cache.set(cacheKey, stmt);
}

export interface PodHydrationMaps {
  relations: {
    mcpServerNames: Map<string, string[]>;
    pluginIds: Map<string, string[]>;
  };
  bindingsMap: Map<string, IntegrationBinding[]>;
}

export class PodRepository {
  private readonly stmtCache = new Map<
    string,
    ReturnType<Database["prepare"]>
  >();

  private get stmts(): ReturnType<typeof getStmts> {
    return getStmts();
  }

  private static readonly ALLOWED_RELATION_TABLES = new Set([
    "pod_mcp_server_names",
    "pod_plugin_ids",
  ]);

  private static readonly ALLOWED_RELATION_COLUMNS = new Set([
    "mcp_server_name",
    "plugin_id",
  ]);

  __clearCacheForTesting(): void {
    this.stmtCache.clear();
  }

  private batchGroupBy<T>(
    rows: T[],
    keyFn: (row: T) => string,
    valueFn: (row: T) => string,
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const key = keyFn(row);
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push(valueFn(row));
    }
    return result;
  }

  private getCachedStmt(
    cacheKey: string,
    buildSql: () => string,
  ): ReturnType<Database["prepare"]> {
    let stmt = this.stmtCache.get(cacheKey);
    if (!stmt) {
      stmt = getDb().prepare(buildSql());
      lruSet(this.stmtCache, cacheKey, stmt);
    }
    return stmt;
  }

  private getRelationStmt(
    tableName: string,
    valueColumn: string,
    count: number,
    placeholders: string,
  ): ReturnType<Database["prepare"]> {
    if (!PodRepository.ALLOWED_RELATION_TABLES.has(tableName)) {
      throw new Error(`非法的 relation tableName：${tableName}`);
    }
    if (!PodRepository.ALLOWED_RELATION_COLUMNS.has(valueColumn)) {
      throw new Error(`非法的 relation valueColumn：${valueColumn}`);
    }
    return this.getCachedStmt(
      `relations:${tableName}:${count}`,
      () =>
        `SELECT pod_id, ${valueColumn} FROM ${tableName} WHERE pod_id IN (${placeholders})`,
    );
  }

  private loadRelation(
    tableName: string,
    valueColumn: string,
    podIds: string[],
  ): Map<string, string[]> {
    const placeholders = podIds.map(() => "?").join(", ");
    const stmt = this.getRelationStmt(
      tableName,
      valueColumn,
      podIds.length,
      placeholders,
    );
    const rawRows = stmt.all(...podIds) as Array<Record<string, unknown>>;
    const rows = rawRows.filter(
      (row) => row.pod_id != null && row[valueColumn] != null,
    ) as Array<Record<string, string>>;

    return this.batchGroupBy(
      rows,
      (row) => row.pod_id,
      (row) => row[valueColumn],
    );
  }

  private loadBindings(
    podIds: string[],
  ): Map<string, IntegrationBinding[]> {
    if (podIds.length === 0) {
      return new Map();
    }

    const stmt = this.getCachedStmt(`bindings:${podIds.length}`, () => {
      const placeholders = podIds.map(() => "?").join(", ");
      return `SELECT id, pod_id, canvas_id, provider, app_id, resource_id, extra_json FROM integration_bindings WHERE pod_id IN (${placeholders})`;
    });

    const rows = stmt.all(...podIds) as IntegrationBindingRow[];
    const result = new Map<string, IntegrationBinding[]>();

    for (const row of rows) {
      if (!result.has(row.pod_id)) result.set(row.pod_id, []);
      result.get(row.pod_id)!.push(mapIntegrationBindingRow(row));
    }

    return result;
  }

  private insertJoinTableIds(
    podId: string,
    pod: Pick<Pod, "mcpServerNames" | "pluginIds">,
  ): void {
    for (const mcpServerName of pod.mcpServerNames) {
      this.stmts.podMcpServerNames.insert.run({
        $podId: podId,
        $mcpServerName: mcpServerName,
      });
    }

    for (const pluginId of pod.pluginIds) {
      this.stmts.podPluginIds.insert.run({
        $podId: podId,
        $pluginId: pluginId,
      });
    }
  }

  private replaceJoinTableIds(
    podId: string,
    stmtGroup: {
      deleteByPodId: ReturnType<Database["prepare"]>;
      insert: ReturnType<Database["prepare"]>;
    },
    valueIds: string[],
    buildParams: (valueId: string) => Record<string, string>,
  ): void {
    stmtGroup.deleteByPodId.run(podId);
    for (const valueId of valueIds) {
      stmtGroup.insert.run(buildParams(valueId));
    }
  }

  private updateJoinTables(podId: string, updates: PodUpdates): void {
    if (updates.pluginIds !== undefined) {
      this.replaceJoinTableIds(
        podId,
        this.stmts.podPluginIds,
        updates.pluginIds,
        (valueId) => ({ $podId: podId, $pluginId: valueId }),
      );
    }
  }

  loadHydrationMaps(podIds: string[]): PodHydrationMaps {
    if (podIds.length === 0) {
      return {
        relations: {
          mcpServerNames: new Map(),
          pluginIds: new Map(),
        },
        bindingsMap: new Map(),
      };
    }

    return {
      relations: {
        mcpServerNames: this.loadRelation(
          "pod_mcp_server_names",
          "mcp_server_name",
          podIds,
        ),
        pluginIds: this.loadRelation("pod_plugin_ids", "plugin_id", podIds),
      },
      bindingsMap: this.loadBindings(podIds),
    };
  }

  insertPod(id: string, canvasId: string, pod: Pod): void {
    getDb().transaction(() => {
      this.stmts.pod.insert.run({
        $id: id,
        $canvasId: canvasId,
        $name: pod.name,
        $x: pod.x,
        $y: pod.y,
        $rotation: pod.rotation,
        $workspacePath: pod.workspacePath,
        $sessionId: pod.sessionId,
        $repositoryId: pod.repositoryId,
        $goalJson: pod.goal ? JSON.stringify(pod.goal) : null,
        $scheduleJson: null,
        $provider: pod.provider,
        $providerConfigJson: JSON.stringify(pod.providerConfig),
      });
      this.insertJoinTableIds(id, pod);
    })();
  }

  selectRowByCanvasIdAndId(
    canvasId: string,
    podId: string,
  ): PodRow | undefined {
    return this.stmts.pod.selectByCanvasIdAndId.get(canvasId, podId) as
      | PodRow
      | undefined;
  }

  selectRowsByCanvasIdAndIds(canvasId: string, podIds: string[]): PodRow[] {
    if (podIds.length === 0) return [];

    const stmt = this.getCachedStmt(`pods:byIds:${podIds.length}`, () => {
      const placeholders = Array.from({ length: podIds.length }, () => "?").join(
        ", ",
      );
      return `SELECT * FROM pods WHERE canvas_id = ? AND id IN (${placeholders})`;
    });

    return stmt.all(canvasId, ...podIds) as PodRow[];
  }

  selectRowById(podId: string): PodRow | undefined {
    return this.stmts.pod.selectById.get(podId) as PodRow | undefined;
  }

  selectRowsByCanvasId(canvasId: string): PodRow[] {
    return this.stmts.pod.selectByCanvasId.all(canvasId) as PodRow[];
  }

  selectRowsByPluginIdGlobal(pluginId: string): PodRow[] {
    return getDb()
      .prepare(
        `SELECT DISTINCT pods.*
         FROM pods
         INNER JOIN pod_plugin_ids ON pod_plugin_ids.pod_id = pods.id
         WHERE pod_plugin_ids.plugin_id = ?`,
      )
      .all(pluginId) as PodRow[];
  }

  selectRowByCanvasIdAndName(
    canvasId: string,
    name: string,
  ): PodRow | undefined {
    return this.stmts.pod.selectByCanvasIdAndName.get(canvasId, name) as
      | PodRow
      | undefined;
  }

  hasName(canvasId: string, name: string, excludePodId?: string): boolean {
    const result = this.stmts.pod.countByCanvasIdAndName.get({
      $canvasId: canvasId,
      $name: name,
      $excludeId: excludePodId ?? "",
    }) as { count: number };
    return result.count > 0;
  }

  updatePod(
    podId: string,
    updatedPod: Pod,
    updates: PodUpdates,
    sanitizedProviderConfigJson: string | null,
  ): void {
    getDb().transaction(() => {
      this.stmts.pod.update.run({
        $id: podId,
        $name: updatedPod.name,
        $x: updatedPod.x,
        $y: updatedPod.y,
        $rotation: updatedPod.rotation,
        $sessionId: updatedPod.sessionId,
        $repositoryId: updatedPod.repositoryId,
        $goalJson: updatedPod.goal ? JSON.stringify(updatedPod.goal) : null,
        $scheduleJson: serializeSchedule(updatedPod.schedule),
        $provider: updatedPod.provider,
        $providerConfigJson: sanitizedProviderConfigJson,
      });
      this.updateJoinTables(podId, updates);
    })();
  }

  deleteById(podId: string): boolean {
    const result = this.stmts.pod.deleteById.run(podId) as { changes: number };
    return result.changes > 0;
  }

  updateSessionId(podId: string, sessionId: string): void {
    this.stmts.pod.updateSessionId.run({
      $sessionId: sessionId,
      $id: podId,
    });
  }

  replaceMcpServerNames(podId: string, names: string[]): void {
    getDb().transaction(() => {
      this.stmts.podMcpServerNames.deleteByPodId.run(podId);
      for (const name of names) {
        this.stmts.podMcpServerNames.insert.run({
          $podId: podId,
          $mcpServerName: name,
        });
      }
    })();
  }

  selectRowsByRepositoryIdAndCanvas(
    repositoryId: string,
    canvasId: string,
  ): PodRow[] {
    return this.stmts.pod.selectByRepositoryIdAndCanvas.all(
      repositoryId,
      canvasId,
    ) as PodRow[];
  }

  selectRowsByRepositoryId(repositoryId: string): PodRow[] {
    return this.stmts.pod.selectByRepositoryId.all(repositoryId) as PodRow[];
  }

  updateRepositoryId(podId: string, repositoryId: string | null): void {
    this.stmts.pod.updateRepositoryId.run({
      $repositoryId: repositoryId,
      $id: podId,
    });
  }

  selectRowsByIds(podIds: string[]): PodRow[] {
    if (podIds.length === 0) return [];

    const placeholders = podIds.map(() => "?").join(", ");
    const stmt = this.getCachedStmt(
      `podsByIds:${podIds.length}`,
      () => `SELECT * FROM pods WHERE id IN (${placeholders})`,
    );

    return stmt.all(...podIds) as PodRow[];
  }

  findPodIdsByIntegrationApp(appId: string): string[] {
    const bindingRows = this.stmts.integrationBinding.selectByAppId.all(
      appId,
    ) as IntegrationBindingRow[];
    return [...new Set(bindingRows.map((row) => row.pod_id))];
  }

  findPodIdsByIntegrationAppAndResource(
    appId: string,
    resourceId: string,
  ): string[] {
    const bindingRows =
      this.stmts.integrationBinding.selectByAppIdAndResourceId.all(
        appId,
        resourceId,
      ) as IntegrationBindingRow[];
    return [...new Set(bindingRows.map((row) => row.pod_id))];
  }

  upsertIntegrationBinding(
    canvasId: string,
    podId: string,
    binding: IntegrationBinding,
  ): void {
    this.stmts.integrationBinding.deleteByPodIdAndProvider.run(
      podId,
      binding.provider,
    );
    this.stmts.integrationBinding.insert.run({
      $id: randomUUID(),
      $podId: podId,
      $canvasId: canvasId,
      $provider: binding.provider,
      $appId: binding.appId,
      $resourceId: binding.resourceId,
      $extraJson: binding.extra ? JSON.stringify(binding.extra) : null,
    });
  }

  deleteIntegrationBinding(podId: string, provider: string): void {
    this.stmts.integrationBinding.deleteByPodIdAndProvider.run(
      podId,
      provider,
    );
  }

  selectScheduleJsonByCanvasAndId(
    canvasId: string,
    podId: string,
  ): string | null {
    const row = this.stmts.pod.selectScheduleJsonByCanvasAndId.get({
      $canvasId: canvasId,
      $id: podId,
    }) as { schedule_json: string | null } | undefined;
    return row?.schedule_json ?? null;
  }

  updateScheduleJson(podId: string, scheduleJson: string | null): void {
    this.stmts.pod.updateScheduleJson.run({
      $scheduleJson: scheduleJson,
      $id: podId,
    });
  }

  selectRowsWithSchedule(): PodRow[] {
    return this.stmts.pod.selectWithSchedule.all() as PodRow[];
  }

  selectScheduleInfoRows(): Array<{
    canvas_id: string;
    id: string;
    schedule_json: string;
  }> {
    return this.stmts.pod.selectScheduleInfo.all() as Array<{
      canvas_id: string;
      id: string;
      schedule_json: string;
    }>;
  }

  parseScheduleInfoRows(): Array<{
    canvasId: string;
    podId: string;
    schedule_json: string;
  }> {
    return this.selectScheduleInfoRows().map((row) => ({
      canvasId: row.canvas_id,
      podId: row.id,
      schedule_json: row.schedule_json,
    }));
  }

  loadBindingsForPod(podId: string): IntegrationBinding[] {
    const rows = this.stmts.integrationBinding.selectByPodId.all(
      podId,
    ) as IntegrationBindingRow[];
    return rows.map(mapIntegrationBindingRow);
  }
}

export const podRepository = new PodRepository();
