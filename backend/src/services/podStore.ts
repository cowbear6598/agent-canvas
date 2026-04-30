import { randomUUID } from "crypto";
import { Database } from "bun:sqlite";
import * as fsPath from "path";
import { WebSocketResponseEvents } from "../schemas";
import type {
  Pod,
  PodStatus,
  CreatePodRequest,
  ScheduleConfig,
} from "../types";
import type { IntegrationBinding } from "../types/integration.js";
import type { ProviderName } from "./provider/types.js";
import {
  resolveProvider,
  resolveProviderConfig,
  sanitizeProviderConfigStrict,
} from "./pod/providerConfigResolver.js";
import { socketService } from "./socketService.js";
import { canvasStore } from "./canvasStore.js";
import { getStmts } from "../database/stmtsHelper.js";
import { getDb } from "../database/index.js";
import { safeJsonParse } from "../utils/safeJsonParse.js";

/**
 * LRU statement cache 上限（entry 數）。
 * 典型 Canvas 中 Pod 數量約 10–20，32 提供約 1.5 倍餘裕，
 * 可避免熱點 Pod 頻繁驅逐影響效能。
 * 若日後 Pod 規模顯著增加（例如超過 50），可考慮調高至 64。
 */
const STMT_CACHE_MAX = 32;

/**
 * 簡易 LRU 輔助函式：set 前若 cache size 已達上限則刪除最舊的 entry。
 * 避免 PreparedStatement 快取無上限成長造成記憶體洩漏。
 * Map 在 ES2015+ 維持插入順序，keys().next().value 即最舊 key。
 */
function lruSet<K, V>(cache: Map<K, V>, cacheKey: K, stmt: V): void {
  if (cache.size >= STMT_CACHE_MAX) {
    cache.delete(cache.keys().next().value as K);
  }
  cache.set(cacheKey, stmt);
}

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
  workspace_path: string;
  session_id: string | null;
  repository_id: string | null;
  command_id: string | null;
  multi_instance: number;
  schedule_json: string | null;
  provider: string;
  provider_config_json: string | null;
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
  /**
   * 統一 PreparedStatement LRU 快取，取代原本分散的四個 cache map。
   * key 格式：「語意前綴:參數」，例如：
   *   - "relations:pod_mcp_server_names:5"（batchLoadRelations）
   *   - "bindings:5"（batchLoadBindings）
   *   - "joinFetch:5"（findByJoinTableId）
   *   - "podsByIds:5"（fetchPodsByIds）
   * n（IN 佔位符數量）相同時可共用同一 PreparedStatement。
   */
  private readonly stmtCache = new Map<
    string,
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
    // 走批次路徑避免 N+1
    const pods = this.rowsToPods([row]);
    return pods[0]!;
  }

  /**
   * 通用 batch group by 輔助函式：將 rows 按 keyFn 分組，valueFn 萃取每筆的值。
   * 消除多段 for-loop 的重複結構。
   */
  private batchGroupBy<T>(
    rows: T[],
    keyFn: (r: T) => string,
    valueFn: (r: T) => string,
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const r of rows) {
      const key = keyFn(r);
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push(valueFn(r));
    }
    return result;
  }

  /** 合法的 tableName 白名單，防止 SQL injection */
  private static readonly ALLOWED_RELATION_TABLES = new Set([
    "pod_mcp_server_names",
    "pod_plugin_ids",
  ]);

  /** 合法的 valueColumn 白名單，防止 SQL injection */
  private static readonly ALLOWED_RELATION_COLUMNS = new Set([
    "mcp_server_name",
    "plugin_id",
  ]);

  /**
   * 通用快取 PreparedStatement 輔助函式。
   * 若 cacheKey 已在 cache 中存在，直接回傳；否則呼叫 buildSql() 建立並以 LRU 策略存入 cache。
   * 消除 batchLoadBindings / findByJoinTableId / fetchPodsByIds / getRelationStmt 四處重複的
   * 「cache.get → if (!stmt) { prepare → lruSet }」結構。
   */
  private getCachedStmt(
    cache: Map<string, ReturnType<Database["prepare"]>>,
    cacheKey: string,
    buildSql: () => string,
  ): ReturnType<Database["prepare"]> {
    let stmt = cache.get(cacheKey);
    if (!stmt) {
      stmt = getDb().prepare(buildSql());
      lruSet(cache, cacheKey, stmt);
    }
    return stmt;
  }

  /** 取得或建立指定 tableName 與 podIds 數量的 PreparedStatement（LRU 快取） */
  private getRelationStmt(
    tableName: string,
    valueColumn: string,
    n: number,
    placeholders: string,
  ): ReturnType<Database["prepare"]> {
    if (!PodStore.ALLOWED_RELATION_TABLES.has(tableName)) {
      throw new Error(`非法的 relation tableName：${tableName}`);
    }
    if (!PodStore.ALLOWED_RELATION_COLUMNS.has(valueColumn)) {
      throw new Error(`非法的 relation valueColumn：${valueColumn}`);
    }
    const cacheKey = `relations:${tableName}:${n}`;
    return this.getCachedStmt(
      this.stmtCache,
      cacheKey,
      () =>
        `SELECT pod_id, ${valueColumn} FROM ${tableName} WHERE pod_id IN (${placeholders})`,
    );
  }

  /**
   * 通用 relation 查詢輔助函式：自行計算 placeholders、取得 PreparedStatement、
   * 執行查詢、透過 batchGroupBy 組裝 Map。
   * 消除 batchLoadRelations 內四段重複的「getRelationStmt → all → batchGroupBy」流程。
   * placeholders 在此統一計算，呼叫端不需重複計算。
   */
  private loadRelation(
    tableName: string,
    valueColumn: string,
    podIds: string[],
  ): Map<string, string[]> {
    const n = podIds.length;
    const placeholders = podIds.map(() => "?").join(", ");
    const stmt = this.getRelationStmt(tableName, valueColumn, n, placeholders);
    // 以 unknown 接收 DB 回傳值，過濾 null/undefined 後再 narrow 為字串型別，
    // 避免 DB 回傳 null 時被斷言為字串 "null" 造成靜默錯誤
    const rawRows = stmt.all(...podIds) as Array<Record<string, unknown>>;
    const rows = rawRows.filter(
      (r) => r.pod_id != null && r[valueColumn] != null,
    ) as Array<Record<string, string>>;
    return this.batchGroupBy(
      rows,
      (r) => r.pod_id,
      (r) => r[valueColumn],
    );
  }

  /**
   * 批次載入多個 Pod 的關聯表資料（mcpServerNames、plugin）。
   * 使用 WHERE pod_id IN (...) 一次查詢，避免 N+1 問題。
   * PreparedStatement 以 "tableName:n" 為 key 快取，不同 relation 類別不會互相命中。
   */
  private batchLoadRelations(podIds: string[]): {
    mcpServerNames: Map<string, string[]>;
    pluginIds: Map<string, string[]>;
  } {
    if (podIds.length === 0) {
      return {
        mcpServerNames: new Map(),
        pluginIds: new Map(),
      };
    }

    return {
      mcpServerNames: this.loadRelation(
        "pod_mcp_server_names",
        "mcp_server_name",
        podIds,
      ),
      pluginIds: this.loadRelation("pod_plugin_ids", "plugin_id", podIds),
    };
  }

  /**
   * 批次載入多個 Pod 的 integration binding 資料。
   * 使用 WHERE pod_id IN (...) 一次查詢，避免 N+1 問題。
   * PreparedStatement 以 "bindings:n" 為 key 快取，避免重複 prepare。
   * placeholders 計算委託給 getCachedStmt 閉包內部，與 loadRelation 一致。
   * 僅用於列表查詢（如 list()），單筆查詢請改用 loadBindingsForPod()。
   */
  private batchLoadBindings(
    podIds: string[],
  ): Map<string, IntegrationBinding[]> {
    if (podIds.length === 0) {
      return new Map();
    }

    const n = podIds.length;
    const cacheKey = `bindings:${n}`;
    // placeholders 在 buildSql 閉包內計算，與 loadRelation → getRelationStmt 的模式一致
    const stmt = this.getCachedStmt(this.stmtCache, cacheKey, () => {
      const placeholders = podIds.map(() => "?").join(", ");
      return `SELECT id, pod_id, canvas_id, provider, app_id, resource_id, extra_json FROM integration_bindings WHERE pod_id IN (${placeholders})`;
    });

    const rows = stmt.all(...podIds) as IntegrationBindingRow[];

    // batchGroupBy 僅適用於單一字串 value column，integration_bindings 為多欄位物件，
    // 故此處仍以 for-loop 組裝，保持型別正確性
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

  /** 解析 DB row 的 providerConfig，缺少 model 時補入對應 provider 的預設值 */
  private resolveProviderConfigFromRow(
    row: PodRow,
    provider: ProviderName,
  ): Record<string, unknown> {
    const raw =
      safeJsonParse<Record<string, unknown>>(row.provider_config_json ?? "") ??
      {};
    return resolveProviderConfig(raw, provider, row.id);
  }

  /**
   * 反序列化 DB 儲存的 schedule JSON 字串為 ScheduleConfig，
   * 轉換 lastTriggeredAt 字串為 Date 物件。
   */
  private parseSchedule(scheduleJson: string): ScheduleConfig | undefined {
    const persisted = safeJsonParse<Record<string, unknown>>(scheduleJson);
    if (!persisted) return undefined;
    return {
      ...persisted,
      lastTriggeredAt: persisted.lastTriggeredAt
        ? new Date(persisted.lastTriggeredAt as string)
        : null,
    } as ScheduleConfig;
  }

  /**
   * 從單一 PodRow 與預載的關聯資料建構 Pod 物件。
   * relations / bindingsMap 由 rowsToPods 批次查詢後傳入，確保無 N+1。
   */
  private buildPodFromRow(
    row: PodRow,
    relations: {
      mcpServerNames: Map<string, string[]>;
      pluginIds: Map<string, string[]>;
    },
    bindingsMap: Map<string, IntegrationBinding[]>,
  ): Pod {
    const provider = resolveProvider(row.provider);
    const providerConfig = this.resolveProviderConfigFromRow(row, provider);
    const pod: Pod = {
      id: row.id,
      name: row.name,
      status: row.status as PodStatus,
      workspacePath: row.workspace_path,
      x: row.x,
      y: row.y,
      rotation: row.rotation,
      sessionId: row.session_id,
      mcpServerNames: relations.mcpServerNames.get(row.id) ?? [],
      pluginIds: relations.pluginIds.get(row.id) ?? [],
      provider,
      providerConfig,
      repositoryId: row.repository_id,
      commandId: row.command_id,
      multiInstance: row.multi_instance === 1,
      integrationBindings: bindingsMap.get(row.id) ?? [],
    };
    if (row.schedule_json) {
      pod.schedule = this.parseSchedule(row.schedule_json);
    }
    return pod;
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

    return rows.map((row) => this.buildPodFromRow(row, relations, bindingsMap));
  }

  /**
   * 私有 helper：將 Pod 的兩張 join table（mcpServerNames / pluginIds）
   * 批次寫入 DB。必須在同一個 transaction 內被呼叫（由 create / update 統一保證）。
   */
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

  /**
   * 組裝 Pod 物件（不含 DB 操作）。
   * providerConfig 必須已經過 sanitizeProviderConfigStrict 驗證並補齊預設 model。
   */
  private buildPodObject(
    id: string,
    canvasId: string,
    data: CreatePodRequest,
    provider: ProviderName,
    providerConfig: Record<string, unknown>,
  ): Pod {
    const canvasDir = canvasStore.getCanvasDir(canvasId)!;
    return {
      id,
      name: data.name,
      status: "idle",
      workspacePath: fsPath.join(canvasDir, `pod-${id}`),
      x: data.x,
      y: data.y,
      rotation: data.rotation,
      sessionId: null,
      mcpServerNames: data.mcpServerNames ?? [],
      pluginIds: data.pluginIds ?? [],
      provider,
      providerConfig,
      repositoryId: data.repositoryId ?? null,
      commandId: data.commandId ?? null,
      multiInstance: false,
      // create 路徑直接回傳空陣列，與 getById/list（走 batchLoadBindings 路徑）保持結構一致
      integrationBindings: [],
    };
  }

  /**
   * 將 Pod 主表 insert 操作提取為私有方法，供 create() 的 transaction 內呼叫。
   */
  private insertPodRow(id: string, canvasId: string, pod: Pod): void {
    this.stmts.pod.insert.run({
      $id: id,
      $canvasId: canvasId,
      $name: pod.name,
      $status: pod.status,
      $x: pod.x,
      $y: pod.y,
      $rotation: pod.rotation,
      $workspacePath: pod.workspacePath,
      $sessionId: pod.sessionId,
      $repositoryId: pod.repositoryId,
      $commandId: pod.commandId,
      $multiInstance: 0,
      $scheduleJson: null,
      $provider: pod.provider,
      $providerConfigJson: JSON.stringify(pod.providerConfig),
    });
  }

  create(canvasId: string, data: CreatePodRequest): { pod: Pod } {
    // 步驟一：守門驗證
    const id = randomUUID();
    if (!canvasStore.getCanvasDir(canvasId)) {
      throw new Error(`找不到 Canvas：${canvasId}`);
    }

    // 步驟二：準備 provider / providerConfig（transaction 外先驗證，不合法直接 throw）
    const provider: ProviderName = data.provider ?? "claude";
    const rawConfig: Record<string, unknown> = data.providerConfig
      ? { ...data.providerConfig }
      : {};
    // sanitizeProviderConfigStrict 已含「補填預設 model」邏輯，此處不需額外補填
    const providerConfig = sanitizeProviderConfigStrict(rawConfig, provider);
    const pod = this.buildPodObject(
      id,
      canvasId,
      data,
      provider,
      providerConfig,
    );

    // 步驟三：原子寫入 DB
    getDb().transaction(() => {
      this.insertPodRow(id, canvasId, pod);
      this.insertJoinTableIds(id, pod);
    })();

    return { pod };
  }

  getById(canvasId: string, id: string): Pod | undefined {
    const row = this.stmts.pod.selectByCanvasIdAndId.get(canvasId, id) as
      | PodRow
      | undefined;
    if (!row) return undefined;
    return this.toPodWithBindings(row);
  }

  /**
   * 批次依 ID 查詢多個 Pod（同一 canvas），回傳 Map<podId, Pod>。
   * 使用 WHERE id IN (...) 一次查詢，避免 N 次 getById 呼叫。
   * podIds 為空時直接回傳空 Map，不觸發 DB 查詢。
   */
  getByIds(canvasId: string, podIds: string[]): Map<string, Pod> {
    if (podIds.length === 0) return new Map();

    const n = podIds.length;
    const cacheKey = `pods:byIds:${n}`;
    const stmt = this.getCachedStmt(this.stmtCache, cacheKey, () => {
      const placeholders = Array.from({ length: n }, () => "?").join(", ");
      return `SELECT * FROM pods WHERE canvas_id = ? AND id IN (${placeholders})`;
    });

    const rows = stmt.all(canvasId, ...podIds) as PodRow[];
    const pods = this.rowsToPods(rows);

    const result = new Map<string, Pod>();
    for (const pod of pods) {
      result.set(pod.id, pod);
    }
    return result;
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
   * 依照 updates 中提供的 id 陣列，重新寫入 pluginIds join table。
   * 未傳入的欄位（undefined）視為不更新，維持原有資料。
   * mcpServerNames 透過 setMcpServerNames 獨立管理，不在此處處理。
   */
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

  /**
   * 合併既有 Pod 與 updates，回傳新的 Pod 物件。
   * 過濾不可變欄位（id、workspacePath、schedule），並呼叫 mergeSchedule 處理排程合併。
   */
  private buildUpdatedPod(pod: Pod, updates: PodUpdates): Pod {
    const {
      id: _id,
      workspacePath: _wp,
      schedule: _sched,
      ...safeUpdates
    } = updates as PodUpdates & Partial<Pod>;
    return {
      ...pod,
      ...safeUpdates,
      schedule: this.mergeSchedule(pod, updates),
    };
  }

  /**
   * 合併 Pod 與 updates 並驗證 providerConfig，回傳寫入 DB 前準備好的資料。
   * sanitizeProviderConfigStrict 在 transaction 外先驗證，不合法時直接 throw（transaction 不會啟動）。
   */
  private prepareUpdatePayload(
    pod: Pod,
    updates: PodUpdates,
  ): { updatedPod: Pod; sanitizedProviderConfigJson: string | null } {
    const updatedPod = this.buildUpdatedPod(pod, updates);
    // 寫入路徑使用 strict 版白名單過濾，model 不合法時直接 throw 由上層回報給 WebSocket 客戶端
    const sanitizedProviderConfigJson = updatedPod.providerConfig
      ? JSON.stringify(
          sanitizeProviderConfigStrict(
            updatedPod.providerConfig,
            updatedPod.provider,
          ),
        )
      : null;
    return { updatedPod, sanitizedProviderConfigJson };
  }

  /**
   * 將 Pod 主表 update 操作提取為私有方法，供 update() 的 transaction 內呼叫。
   */
  private updatePodRow(
    id: string,
    pod: Pod,
    sanitizedConfigJson: string | null,
  ): void {
    this.stmts.pod.update.run({
      $id: id,
      $name: pod.name,
      $status: pod.status,
      $x: pod.x,
      $y: pod.y,
      $rotation: pod.rotation,
      $sessionId: pod.sessionId,
      $repositoryId: pod.repositoryId,
      $commandId: pod.commandId,
      $multiInstance: pod.multiInstance ? 1 : 0,
      $scheduleJson: serializeSchedule(pod.schedule),
      $provider: pod.provider,
      $providerConfigJson: sanitizedConfigJson,
    });
  }

  update(
    canvasId: string,
    id: string,
    updates: PodUpdates,
  ): { pod: Pod } | undefined {
    const pod = this.getById(canvasId, id);
    if (!pod) return undefined;

    const { updatedPod, sanitizedProviderConfigJson } =
      this.prepareUpdatePayload(pod, updates);

    // 使用 transaction 確保主表 update 與 join table update 的原子性
    getDb().transaction(() => {
      this.updatePodRow(id, updatedPod, sanitizedProviderConfigJson);
      this.updateJoinTables(id, updates);
    })();

    return { pod: updatedPod };
  }

  delete(canvasId: string, id: string): boolean {
    const result = this.stmts.pod.deleteById.run(id) as { changes: number };
    return result.changes > 0;
  }

  /**
   * 輕量查詢：只取 status 欄位，不載入關聯資料，供高頻場景使用。
   */
  getStatusById(canvasId: string, podId: string): PodStatus | undefined {
    const row = this.stmts.pod.selectStatusByCanvasIdAndId.get(
      canvasId,
      podId,
    ) as { status: string } | undefined;
    return row?.status as PodStatus | undefined;
  }

  setStatus(canvasId: string, id: string, status: PodStatus): void {
    const previousStatus = this.getStatusById(canvasId, id);
    if (previousStatus === undefined) return;
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

  setSessionId(canvasId: string, id: string, sessionId: string): void {
    this.stmts.pod.updateSessionId.run({
      $sessionId: sessionId,
      $id: id,
    });
  }

  resetClaudeSession(canvasId: string, podId: string): void {
    this.setSessionId(canvasId, podId, "");
  }

  /**
   * 直接覆寫指定 pod 的 mcpServerNames 陣列（全量替換，非增量）。
   * 先刪除舊記錄再逐一插入，確保結果與傳入 names 完全一致。
   */
  setMcpServerNames(podId: string, names: string[]): void {
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

  findByCommandId(canvasId: string, commandId: string): Pod[] {
    const rows = this.stmts.pod.selectByCommandIdAndCanvas.all(
      commandId,
      canvasId,
    ) as PodRow[];
    return this.rowsToPods(rows);
  }

  findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
    const rows = this.stmts.pod.selectByRepositoryIdAndCanvas.all(
      repositoryId,
      canvasId,
    ) as PodRow[];
    return this.rowsToPods(rows);
  }

  /**
   * 取得所有 Canvas 中綁定指定 repository 的 Pod，一次查詢取代按 canvas 逐一查詢。
   * 使用批次載入關聯資料，避免 N+1 問題。
   */
  findAllByRepositoryId(
    repositoryId: string,
  ): Array<{ canvasId: string; pod: Pod }> {
    const rows = this.stmts.pod.selectByRepositoryId.all(
      repositoryId,
    ) as PodRow[];
    if (rows.length === 0) return [];
    const canvasIdMap = new Map(rows.map((r) => [r.id, r.canvas_id]));
    const pods = this.rowsToPods(rows);
    return pods.map((pod) => ({ canvasId: canvasIdMap.get(pod.id)!, pod }));
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

  /**
   * 私有 helper：根據 podIds 批次取得 Pod 陣列，供 findByIntegrationApp* 共用。
   * 用 WHERE id IN (...) 一次取得所有 Pod，避免 N+1。cacheKey 以 "pods_by_ids:n" 區分。
   */
  private fetchPodsByIds(
    podIds: string[],
  ): Array<{ canvasId: string; pod: Pod }> {
    const cacheKey = `podsByIds:${podIds.length}`;
    const placeholders = podIds.map(() => "?").join(", ");
    const stmt = this.getCachedStmt(
      this.stmtCache,
      cacheKey,
      () => `SELECT * FROM pods WHERE id IN (${placeholders})`,
    );
    const rows = stmt.all(...podIds) as PodRow[];
    const canvasIdMap = new Map(rows.map((r) => [r.id, r.canvas_id]));
    const pods = this.rowsToPods(rows);
    return pods.map((pod) => ({ canvasId: canvasIdMap.get(pod.id)!, pod }));
  }

  findByIntegrationApp(appId: string): Array<{ canvasId: string; pod: Pod }> {
    const bindingRows = this.stmts.integrationBinding.selectByAppId.all(
      appId,
    ) as IntegrationBindingRow[];
    const podIds = [...new Set(bindingRows.map((r) => r.pod_id))];
    if (podIds.length === 0) return [];
    return this.fetchPodsByIds(podIds);
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
    return this.fetchPodsByIds(podIds);
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
    // 輕量查詢：只讀 schedule_json，不做 join table 查詢，避免 getById() 的完整多表 join
    const row = this.stmts.pod.selectScheduleJsonByCanvasAndId.get({
      $canvasId: canvasId,
      $id: podId,
    }) as { schedule_json: string | null } | undefined;
    if (!row?.schedule_json) return;

    const persisted = safeJsonParse<Record<string, unknown>>(row.schedule_json);
    if (!persisted) return;

    const updatedSchedule: ScheduleConfig = {
      ...(persisted as unknown as ScheduleConfig),
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
   * 輕量化查詢：只取排程判斷所需的最少欄位（canvas_id、id、schedule_json）。
   * 不做任何 join table 查詢，專供 scheduleService.tick() 每秒輪詢使用。
   */
  listScheduleInfo(): Array<{
    canvasId: string;
    podId: string;
    schedule: ScheduleConfig;
  }> {
    const rows = this.stmts.pod.selectScheduleInfo.all() as Array<{
      canvas_id: string;
      id: string;
      schedule_json: string;
    }>;

    const result: Array<{
      canvasId: string;
      podId: string;
      schedule: ScheduleConfig;
    }> = [];

    for (const row of rows) {
      const persisted = safeJsonParse<Record<string, unknown>>(
        row.schedule_json,
      );
      if (!persisted) continue;

      const schedule = {
        ...persisted,
        lastTriggeredAt: persisted.lastTriggeredAt
          ? new Date(persisted.lastTriggeredAt as string)
          : null,
      } as ScheduleConfig;

      if (!schedule.enabled) continue;

      result.push({ canvasId: row.canvas_id, podId: row.id, schedule });
    }

    return result;
  }

  /**
   * 將所有 chatting 或 summarizing 狀態的 Pod 重設為 idle（僅更新 DB，不廣播 WebSocket）
   * 用於 graceful shutdown 時清理 busy 狀態的 Pod
   */
  resetAllBusyPods(): number {
    const result = this.stmts.pod.resetAllBusy.run() as { changes: number };
    return result.changes;
  }
}

export const podStore = new PodStore();
