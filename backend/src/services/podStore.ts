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
import type { ProviderName } from "./provider/types.js";
import { getProvider, providerRegistry } from "./provider/index.js";
import { socketService } from "./socketService.js";
import { canvasStore } from "./canvasStore.js";
import { getStmts } from "../database/stmtsHelper.js";
import { getDb } from "../database/index.js";
import { safeJsonParse } from "../utils/safeJsonParse.js";
import { logger } from "../utils/logger.js";

/** LRU 快取上限（entry 數） */
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
   * 以 "tableName:n" 為 key 快取 batchLoadRelations 用的 PreparedStatement（LRU 上限 32）。
   * key 含 tableName 避免不同 relation 類別互相命中；n（長度）決定 IN 佔位符數量，同長度可共用同一 prepared statement。
   */
  private readonly relationsStmtCache = new Map<
    string,
    ReturnType<Database["prepare"]>
  >();

  /**
   * 以 "bindings:n" 為 key 快取 batchLoadBindings 用的 PreparedStatement（LRU 上限 32）。
   * key 含語意前綴 "bindings:" 與 n（長度）決定 IN 佔位符數量，同長度可共用同一 prepared statement。
   */
  private readonly bindingsStmtCache = new Map<
    string,
    ReturnType<Database["prepare"]>
  >();

  /** 以 n（長度）為 key 快取 findByJoinTableId 用的 PreparedStatement（LRU 上限 32） */
  private readonly joinFetchStmtCache = new Map<
    string,
    ReturnType<Database["prepare"]>
  >();

  /** 以 n（長度）為 key 快取 fetchPodsByIds 用的 PreparedStatement（LRU 上限 32） */
  private readonly podsByIdsStmtCache = new Map<
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
    // 使用 rowsToPods 批次路徑（含 batchLoadRelations + batchLoadBindings），避免 N+1
    const pods = this.rowsToPods([row]);
    return pods[0]!;
  }

  /**
   * 通用 batch group by 輔助函式：將 rows 按 keyFn 分組，valueFn 萃取每筆的值。
   * 消除 skill/subAgent/mcpServer/plugin 四段 for-loop 的重複結構。
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
    "pod_skill_ids",
    "pod_sub_agent_ids",
    "pod_mcp_server_ids",
    "pod_plugin_ids",
  ]);

  /** 合法的 valueColumn 白名單，防止 SQL injection */
  private static readonly ALLOWED_RELATION_COLUMNS = new Set([
    "skill_id",
    "sub_agent_id",
    "mcp_server_id",
    "plugin_id",
  ]);

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
    let stmt = this.relationsStmtCache.get(cacheKey);
    if (!stmt) {
      stmt = getDb().prepare(
        `SELECT pod_id, ${valueColumn} FROM ${tableName} WHERE pod_id IN (${placeholders})`,
      );
      lruSet(this.relationsStmtCache, cacheKey, stmt);
    }
    return stmt;
  }

  /**
   * 通用 relation 查詢輔助函式：取得 PreparedStatement、執行查詢、透過 batchGroupBy 組裝 Map。
   * 消除 batchLoadRelations 內四段重複的「getRelationStmt → all → batchGroupBy」流程。
   */
  private loadRelation(
    tableName: string,
    valueColumn: string,
    podIds: string[],
    placeholders: string,
  ): Map<string, string[]> {
    const n = podIds.length;
    const stmt = this.getRelationStmt(tableName, valueColumn, n, placeholders);
    const rows = stmt.all(...podIds) as Array<Record<string, string>>;
    return this.batchGroupBy(
      rows,
      (r) => r.pod_id,
      (r) => r[valueColumn],
    );
  }

  /**
   * 批次載入多個 Pod 的關聯表資料（skill、subAgent、mcpServer、plugin）。
   * 使用 WHERE pod_id IN (...) 一次查詢，避免 N+1 問題。
   * PreparedStatement 以 "tableName:n" 為 key 快取，不同 relation 類別不會互相命中。
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

    const placeholders = podIds.map(() => "?").join(", ");

    return {
      skillIds: this.loadRelation(
        "pod_skill_ids",
        "skill_id",
        podIds,
        placeholders,
      ),
      subAgentIds: this.loadRelation(
        "pod_sub_agent_ids",
        "sub_agent_id",
        podIds,
        placeholders,
      ),
      mcpServerIds: this.loadRelation(
        "pod_mcp_server_ids",
        "mcp_server_id",
        podIds,
        placeholders,
      ),
      pluginIds: this.loadRelation(
        "pod_plugin_ids",
        "plugin_id",
        podIds,
        placeholders,
      ),
    };
  }

  /**
   * 批次載入多個 Pod 的 integration binding 資料。
   * 使用 WHERE pod_id IN (...) 一次查詢，避免 N+1 問題。
   * PreparedStatement 以 "bindings:n" 為 key 快取，避免重複 prepare。
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
    let stmt = this.bindingsStmtCache.get(cacheKey);
    if (!stmt) {
      const db = getDb();
      const placeholders = podIds.map(() => "?").join(", ");
      stmt = db.prepare(
        `SELECT id, pod_id, canvas_id, provider, app_id, resource_id, extra_json FROM integration_bindings WHERE pod_id IN (${placeholders})`,
      );
      lruSet(this.bindingsStmtCache, cacheKey, stmt);
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
   * 解析 DB row 的 provider 欄位，不合法值 fallback 為 'claude'。
   * DB 欄位可能為空或含歷史非法值，需 fallback 以保持向後相容。
   */
  private resolveProvider(row: PodRow): ProviderName {
    // 以 providerRegistry 的 key 作為白名單，未來新增 provider 時自動涵蓋，不需回頭改這個函式
    const isValidProvider = (value: unknown): value is ProviderName =>
      typeof value === "string" && value in providerRegistry;

    if (!isValidProvider(row.provider)) {
      const rawValue = String(row.provider);
      const safeValue = /^[a-z0-9_-]{1,32}$/.test(rawValue)
        ? rawValue
        : `<invalid format, len=${rawValue.length}>`;
      logger.warn(
        "Pod",
        "Warn",
        `收到未知 provider 值：${safeValue}，已 fallback 為 claude`,
      );
      return "claude";
    }
    return row.provider;
  }

  /**
   * 白名單過濾 providerConfig，只保留合法欄位（目前僅 model）。
   * 不驗證 model 值是否在 provider 的 availableModels 內，供讀取路徑（DB → Pod 物件）使用，
   * 避免舊 pod 中可能存在的不合法 model 值造成 Pod 打不開。寫入路徑請改用 sanitizeProviderConfigStrict。
   * 歷史 DB 舊格式 {provider, model} 需淨化為 {model} 以符合 .strict() schema，前端型別曾為 discriminated union 導致多餘 key 流入。
   */
  private sanitizeProviderConfig(
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    if ("model" in raw) {
      sanitized.model = raw.model;
    }
    return sanitized;
  }

  /**
   * 嚴格版的 providerConfig 白名單過濾：在保留 model 欄位後，
   * 會檢查 model 值是否在指定 provider 的 metadata.availableModels 清單內，
   * 不合法時 throw Error（不 fallback），供寫入路徑（create / update）使用。
   */
  private sanitizeProviderConfigStrict(
    raw: Record<string, unknown>,
    provider: ProviderName,
  ): Record<string, unknown> {
    const sanitized = this.sanitizeProviderConfig(raw);

    if ("model" in sanitized) {
      const { availableModelValues } = getProvider(provider).metadata;
      if (!availableModelValues.has(sanitized.model as string)) {
        throw new Error(`Provider ${provider} 不支援此 model`);
      }
    }

    return sanitized;
  }

  /**
   * 讀取路徑下的 warn log：若 DB 中的 model 不在 provider 的 availableModels 內，
   * 記錄一次 warn log 但不丟棄原值（不影響 Pod 載入）。
   */
  private warnIfModelOutOfRange(
    model: unknown,
    provider: ProviderName,
    podId: string,
  ): void {
    if (typeof model !== "string") {
      logger.warn(
        "Pod",
        "Warn",
        `DB 中 Pod ${podId} 的 providerConfig.model 非字串值（typeof=${typeof model}），略過範圍檢查`,
      );
      return;
    }
    const { availableModelValues } = getProvider(provider).metadata;
    if (!availableModelValues.has(model)) {
      logger.warn(
        "Pod",
        "Warn",
        `DB 中 Pod ${podId} 的 providerConfig.model 值 ${model} 不在 provider ${provider} 的 availableModels 內，保留原值`,
      );
    }
  }

  /**
   * 確保 sanitized 物件含有 model 欄位：
   * 若缺少則補入 provider 預設值；若已有則做 availableModels 範圍檢查並 warn log（保留原值）。
   */
  private ensureModelField(
    sanitized: Record<string, unknown>,
    provider: ProviderName,
    podId: string,
  ): void {
    if (!("model" in sanitized)) {
      const defaultOptions = getProvider(provider).metadata
        .defaultOptions as Record<string, unknown>;
      sanitized.model = defaultOptions.model;
    } else {
      this.warnIfModelOutOfRange(sanitized.model, provider, podId);
    }
  }

  /** 解析 DB row 的 providerConfig，缺少 model 時補入對應 provider 的預設值 */
  private resolveProviderConfig(
    row: PodRow,
    provider: ProviderName,
  ): Record<string, unknown> {
    const raw =
      safeJsonParse<Record<string, unknown>>(row.provider_config_json ?? "") ??
      {};
    // 讀取路徑：使用 relaxed 版本白名單過濾，丟棄舊格式中的 provider 等多餘 key；
    // 不驗證 model 是否在 availableModels 內，避免舊 pod 的歷史 model 值導致 Pod 打不開
    const sanitized = this.sanitizeProviderConfig(raw);
    this.ensureModelField(sanitized, provider, row.id);
    return sanitized;
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
      const provider = this.resolveProvider(row);
      const providerConfig = this.resolveProviderConfig(row, provider);

      const pod: Pod = {
        id: row.id,
        name: row.name,
        status: row.status as PodStatus,
        workspacePath: row.workspace_path,
        x: row.x,
        y: row.y,
        rotation: row.rotation,
        sessionId: row.session_id,
        skillIds: relations.skillIds.get(row.id) ?? [],
        subAgentIds: relations.subAgentIds.get(row.id) ?? [],
        mcpServerIds: relations.mcpServerIds.get(row.id) ?? [],
        pluginIds: relations.pluginIds.get(row.id) ?? [],
        provider,
        providerConfig,
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

  /**
   * 私有 helper：將 Pod 的四張 join table（skillIds / subAgentIds / mcpServerIds / pluginIds）
   * 批次寫入 DB。必須在同一個 transaction 內被呼叫（由 create / update 統一保證）。
   */
  private insertJoinTableIds(
    podId: string,
    pod: Pick<Pod, "skillIds" | "subAgentIds" | "mcpServerIds" | "pluginIds">,
  ): void {
    for (const skillId of pod.skillIds) {
      this.stmts.podSkillIds.insert.run({ $podId: podId, $skillId: skillId });
    }

    for (const subAgentId of pod.subAgentIds) {
      this.stmts.podSubAgentIds.insert.run({
        $podId: podId,
        $subAgentId: subAgentId,
      });
    }

    for (const mcpServerId of pod.mcpServerIds) {
      this.stmts.podMcpServerIds.insert.run({
        $podId: podId,
        $mcpServerId: mcpServerId,
      });
    }

    for (const pluginId of pod.pluginIds) {
      this.stmts.podPluginIds.insert.run({
        $podId: podId,
        $pluginId: pluginId,
      });
    }
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

    const provider: ProviderName = data.provider ?? "claude";
    const incomingConfig = data.providerConfig ?? null;
    // 寫入路徑使用 strict 版白名單過濾，model 不合法時直接 throw 由上層回報給 WebSocket 客戶端
    // 此處在 transaction 外先驗證，避免進入 transaction 後才 throw 導致不必要的 rollback
    const rawConfig: Record<string, unknown> = incomingConfig
      ? { ...incomingConfig }
      : {};
    const providerConfig = this.sanitizeProviderConfigStrict(
      rawConfig,
      provider,
    );
    if (!("model" in providerConfig)) {
      const defaultOptions = getProvider(provider).metadata
        .defaultOptions as Record<string, unknown>;
      providerConfig.model = defaultOptions.model;
    }

    const pod: Pod = {
      id,
      name: data.name,
      status: "idle",
      workspacePath: `${canvasDir}/pod-${id}`,
      x: data.x,
      y: data.y,
      rotation: data.rotation,
      sessionId: null,
      skillIds: data.skillIds ?? [],
      subAgentIds: data.subAgentIds ?? [],
      mcpServerIds: data.mcpServerIds ?? [],
      pluginIds: data.pluginIds ?? [],
      provider,
      providerConfig,
      repositoryId: data.repositoryId ?? null,
      commandId: data.commandId ?? null,
      multiInstance: false,
      // create 路徑直接回傳空陣列，與 getById/list（走 batchLoadBindings 路徑）保持結構一致
      integrationBindings: [],
    };

    // 使用 transaction 確保主表 insert 與 join table insert 的原子性
    getDb().transaction(() => {
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

      this.insertJoinTableIds(id, pod);
    })();

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

  update(
    canvasId: string,
    id: string,
    updates: PodUpdates,
  ): { pod: Pod; persisted: Promise<void> } | undefined {
    const pod = this.getById(canvasId, id);
    if (!pod) return undefined;

    const updatedPod = this.buildUpdatedPod(pod, updates);

    // sanitizeProviderConfigStrict 在 transaction 外先驗證，不合法時直接 throw（transaction 不會啟動）
    const sanitizedProviderConfigJson = updatedPod.providerConfig
      ? JSON.stringify(
          this.sanitizeProviderConfigStrict(
            updatedPod.providerConfig,
            updatedPod.provider,
          ),
        )
      : null;

    // 使用 transaction 確保主表 update 與 join table update 的原子性
    getDb().transaction(() => {
      this.stmts.pod.update.run({
        $id: id,
        $name: updatedPod.name,
        $status: updatedPod.status,
        $x: updatedPod.x,
        $y: updatedPod.y,
        $rotation: updatedPod.rotation,
        $sessionId: updatedPod.sessionId,
        $repositoryId: updatedPod.repositoryId,
        $commandId: updatedPod.commandId,
        $multiInstance: updatedPod.multiInstance ? 1 : 0,
        $scheduleJson: serializeSchedule(updatedPod.schedule),
        $provider: updatedPod.provider,
        // 寫入路徑使用 strict 版白名單過濾，model 不合法時直接 throw 由上層回報給 WebSocket 客戶端
        $providerConfigJson: sanitizedProviderConfigJson,
      });

      this.updateJoinTables(id, updates);
    })();

    return { pod: updatedPod, persisted: Promise.resolve() };
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
    const cacheKey = `${podIds.length}`;
    let stmt = this.joinFetchStmtCache.get(cacheKey);
    if (!stmt) {
      const placeholders = podIds.map(() => "?").join(", ");
      stmt = getDb().prepare(
        `SELECT * FROM pods WHERE canvas_id = ? AND id IN (${placeholders})`,
      );
      lruSet(this.joinFetchStmtCache, cacheKey, stmt);
    }
    const rows = stmt.all(canvasId, ...podIds) as PodRow[];
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
    const cacheKey = `${podIds.length}`;
    let stmt = this.podsByIdsStmtCache.get(cacheKey);
    if (!stmt) {
      const placeholders = podIds.map(() => "?").join(", ");
      stmt = getDb().prepare(
        `SELECT * FROM pods WHERE id IN (${placeholders})`,
      );
      lruSet(this.podsByIdsStmtCache, cacheKey, stmt);
    }
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
