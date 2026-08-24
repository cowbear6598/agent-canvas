import { randomUUID } from "crypto";
import * as fsPath from "path";
import type { Pod, CreatePodRequest } from "../types";
import type { IntegrationBinding } from "../types/integration.js";
import type { ScheduleConfig } from "../types/schedule.js";
import type { ProviderName } from "./provider/types.js";
import { normalizePodGoal } from "../types/pod.js";
import { sanitizeProviderConfigStrict } from "./pod/providerConfigResolver.js";
import { canvasStore } from "./canvasStore.js";
import { safeJsonParse } from "@shared/safeJsonParse.js";
import { memoryStateService } from "./memoryStateService.js";
import {
  buildPodFromRow,
  type PodRow,
} from "./pod/podRowMapper.js";
import {
  type PodUpdates,
  preparePodUpdatePayload,
  serializeSchedule,
} from "./pod/podUpdatePolicy.js";
import { podRepository } from "./pod/podRepository.js";
import { isFastModeSupported } from "./provider/capabilities.js";

class PodStore {
  /**
   * 相容舊測試的 facade hook。
   * 測試曾直接呼叫 podStore.stmtCache.clear() 清空 PreparedStatement 快取，
   * 現在實作已下沉到 repository，這裡保留最小相容介面避免測試耦合到重構細節。
   */
  readonly stmtCache = {
    clear: (): void => {
      podRepository.__clearCacheForTesting();
    },
  } as unknown as Map<string, unknown>;

  __clearCacheForTesting(): void {
    podRepository.__clearCacheForTesting();
  }

  private toPodWithBindings(row: PodRow): Pod {
    // 走批次路徑避免 N+1
    const pods = this.rowsToPods([row]);
    return pods[0]!;
  }

  /**
   * 將多筆 PodRow 組合為 Pod 陣列，使用批次查詢取代逐筆子查詢。
   * 僅用於列表查詢（如 list()），避免 N+1 問題。
   */
  private rowsToPods(rows: PodRow[]): Pod[] {
    if (rows.length === 0) return [];

    const podIds = rows.map((r) => r.id);
    const { relations, bindingsMap } = podRepository.loadHydrationMaps(podIds);
    const repoIds = rows
      .map((row) => row.repository_id)
      .filter((repositoryId): repositoryId is string => !!repositoryId);
    const memoryStateMaps = {
      podStates: memoryStateService.listPodStates(podIds),
      repoStates: memoryStateService.listRepoStates(repoIds),
    };

    return rows.map((row) =>
      buildPodFromRow(row, relations, bindingsMap, memoryStateMaps),
    );
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
      workspacePath: fsPath.join(canvasDir, `pod-${id}`),
      x: data.x,
      y: data.y,
      rotation: data.rotation,
      sessionId: null,
      mcpServerNames: data.mcpServerNames ?? [],
      agentCanvasMcpEnabled: data.agentCanvasMcpEnabled ?? false,
      pluginIds: data.pluginIds ?? [],
      codexSkillKeys: data.codexSkillKeys ?? [],
      codexMcpServerKeys: [],
      // 新建 Pod 採獨立白名單；空陣列代表預設不啟用任何 Codex Skill。
      codexSkillsInitialized: true,
      provider,
      providerConfig,
      fastModeEnabled:
        data.fastModeEnabled === true &&
        isFastModeSupported(provider, providerConfig.model),
      repositoryId: data.repositoryId ?? null,
      goal: normalizePodGoal(data.goal ?? null),
      // create 路徑直接回傳空陣列，與 getById/list（走 batchLoadBindings 路徑）保持結構一致
      integrationBindings: [],
      memoryEnabled: false,
      repoMemoryEnabled: false,
      hasPodMemory: false,
      hasRepoMemory: false,
    };
  }

  create(canvasId: string, data: CreatePodRequest): { pod: Pod } {
    const id = randomUUID();
    if (!canvasStore.getCanvasDir(canvasId)) {
      throw new Error(`找不到 Canvas：${canvasId}`);
    }

    // transaction 外先驗證 provider/providerConfig，不合法直接 throw
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

    podRepository.insertPod(id, canvasId, pod);

    return { pod };
  }

  getById(canvasId: string, id: string): Pod | undefined {
    const row = podRepository.selectRowByCanvasIdAndId(canvasId, id);
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

    const rows = podRepository.selectRowsByCanvasIdAndIds(canvasId, podIds);
    const pods = this.rowsToPods(rows);

    const result = new Map<string, Pod>();
    for (const pod of pods) {
      result.set(pod.id, pod);
    }
    return result;
  }

  getNamesByIds(canvasId: string, podIds: string[]): Map<string, string> {
    const uniquePodIds = [...new Set(podIds)];
    const rows = podRepository.selectNamesByCanvasIdAndIds(
      canvasId,
      uniquePodIds,
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  getByIdGlobal(podId: string): { canvasId: string; pod: Pod } | undefined {
    const row = podRepository.selectRowById(podId);
    if (!row) return undefined;
    return { canvasId: row.canvas_id, pod: this.toPodWithBindings(row) };
  }

  list(canvasId: string): Pod[] {
    return this.rowsToPods(podRepository.selectRowsByCanvasId(canvasId));
  }

  getPodsByPluginIdGlobal(
    pluginId: string,
  ): Array<{ canvasId: string; pod: Pod }> {
    const rows = podRepository.selectRowsByPluginIdGlobal(pluginId);
    if (rows.length === 0) {
      return [];
    }

    const pods = this.rowsToPods(rows);
    const podMap = new Map(pods.map((pod) => [pod.id, pod]));
    return rows
      .map((row) => {
        const pod = podMap.get(row.id);
        if (!pod) return null;
        return { canvasId: row.canvas_id, pod };
      })
      .filter((entry): entry is { canvasId: string; pod: Pod } => entry !== null);
  }

  getByName(canvasId: string, name: string): Pod | undefined {
    const row = podRepository.selectRowByCanvasIdAndName(canvasId, name);
    if (!row) return undefined;
    return this.toPodWithBindings(row);
  }

  hasName(canvasId: string, name: string, excludePodId?: string): boolean {
    return podRepository.hasName(canvasId, name, excludePodId);
  }

  update(
    canvasId: string,
    id: string,
    updates: PodUpdates,
  ): { pod: Pod } | undefined {
    const pod = this.getById(canvasId, id);
    if (!pod) return undefined;

    const { updatedPod, sanitizedProviderConfigJson } =
      preparePodUpdatePayload(pod, updates);

    podRepository.updatePod(
      id,
      updatedPod,
      updates,
      sanitizedProviderConfigJson,
    );

    return { pod: updatedPod };
  }

  delete(canvasId: string, id: string): boolean {
    return podRepository.deleteById(id);
  }

  setSessionId(canvasId: string, id: string, sessionId: string): void {
    podRepository.updateSessionId(id, sessionId);
  }

  resetClaudeSession(canvasId: string, podId: string): void {
    this.setSessionId(canvasId, podId, "");
  }

  setMcpServerNames(podId: string, names: string[]): void {
    podRepository.replaceMcpServerNames(podId, names);
  }

  setCodexSkillKeys(podId: string, keys: string[]): void {
    podRepository.replaceCodexSkillKeys(podId, keys, true);
  }

  setCodexMcpServerKeys(podId: string, keys: string[]): void {
    podRepository.replaceCodexMcpServerKeys(podId, keys);
  }

  findByRepositoryId(canvasId: string, repositoryId: string): Pod[] {
    const rows = podRepository.selectRowsByRepositoryIdAndCanvas(
      repositoryId,
      canvasId,
    );
    return this.rowsToPods(rows);
  }

  /**
   * 取得所有 Canvas 中綁定指定 repository 的 Pod，一次查詢取代按 canvas 逐一查詢。
   * 使用批次載入關聯資料，避免 N+1 問題。
   */
  findAllByRepositoryId(
    repositoryId: string,
  ): Array<{ canvasId: string; pod: Pod }> {
    const rows = podRepository.selectRowsByRepositoryId(repositoryId);
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
    podRepository.updateRepositoryId(id, repositoryId);
  }

  /**
   * 私有 helper：根據 podIds 批次取得 Pod 陣列，供 findByIntegrationApp* 共用。
   * 用 WHERE id IN (...) 一次取得所有 Pod，避免 N+1。cacheKey 以 "pods_by_ids:n" 區分。
   */
  private fetchPodsByIds(
    podIds: string[],
  ): Array<{ canvasId: string; pod: Pod }> {
    const rows = podRepository.selectRowsByIds(podIds);
    const canvasIdMap = new Map(rows.map((r) => [r.id, r.canvas_id]));
    const pods = this.rowsToPods(rows);
    return pods.map((pod) => ({ canvasId: canvasIdMap.get(pod.id)!, pod }));
  }

  findByIntegrationApp(appId: string): Array<{ canvasId: string; pod: Pod }> {
    const podIds = podRepository.findPodIdsByIntegrationApp(appId);
    if (podIds.length === 0) return [];
    return this.fetchPodsByIds(podIds);
  }

  findByIntegrationAppAndResource(
    appId: string,
    resourceId: string,
  ): Array<{ canvasId: string; pod: Pod }> {
    const podIds = podRepository.findPodIdsByIntegrationAppAndResource(
      appId,
      resourceId,
    );
    if (podIds.length === 0) return [];
    return this.fetchPodsByIds(podIds);
  }

  addIntegrationBinding(
    canvasId: string,
    podId: string,
    binding: IntegrationBinding,
  ): void {
    podRepository.upsertIntegrationBinding(canvasId, podId, binding);
  }

  removeIntegrationBinding(
    _canvasId: string,
    podId: string,
    provider: string,
  ): void {
    podRepository.deleteIntegrationBinding(podId, provider);
  }

  setScheduleLastTriggeredAt(
    canvasId: string,
    podId: string,
    date: Date,
  ): void {
    const scheduleJson = podRepository.selectScheduleJsonByCanvasAndId(
      canvasId,
      podId,
    );
    if (!scheduleJson) return;

    const persisted = safeJsonParse<Record<string, unknown>>(scheduleJson);
    if (!persisted) return;

    const updatedSchedule: ScheduleConfig = {
      ...(persisted as unknown as ScheduleConfig),
      lastTriggeredAt: date,
    };
    podRepository.updateScheduleJson(podId, serializeSchedule(updatedSchedule));
  }

  getAllWithSchedule(): Array<{ canvasId: string; pod: Pod }> {
    const rows = podRepository.selectRowsWithSchedule();
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
    const rows = podRepository.parseScheduleInfoRows();

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

      result.push({ canvasId: row.canvasId, podId: row.podId, schedule });
    }

    return result;
  }
}

export const podStore = new PodStore();
