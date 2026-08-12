import type { IntegrationBinding } from "../../types/integration.js";
import type { Pod, PodGoal, ScheduleConfig } from "../../types/index.js";
import { normalizePodGoal } from "../../types/pod.js";
import type { ProviderName } from "../provider/types.js";
import {
  resolveProvider as resolveProviderName,
  resolveProviderConfig,
} from "./providerConfigResolver.js";
import { safeJsonParse } from "@shared/safeJsonParse.js";

export interface PodRow {
  id: string;
  canvas_id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  workspace_path: string;
  session_id: string | null;
  repository_id: string | null;
  goal_json: string | null;
  schedule_json: string | null;
  provider: string;
  provider_config_json: string | null;
  fast_mode_enabled: number;
  agent_canvas_mcp_enabled: number;
}

export interface IntegrationBindingRow {
  id: string;
  pod_id: string;
  canvas_id: string;
  provider: string;
  app_id: string;
  resource_id: string;
  extra_json: string | null;
}

export function mapIntegrationBindingRow(
  row: IntegrationBindingRow,
): IntegrationBinding {
  return {
    provider: row.provider,
    appId: row.app_id,
    resourceId: row.resource_id,
    extra: row.extra_json
      ? (safeJsonParse<Record<string, unknown>>(row.extra_json) ?? undefined)
      : undefined,
  };
}

export function resolveProviderConfigFromRow(
  row: PodRow,
  provider: ProviderName,
): Record<string, unknown> {
  const raw =
    safeJsonParse<Record<string, unknown>>(row.provider_config_json ?? "") ?? {};
  return resolveProviderConfig(raw, provider, row.id);
}

export function parseGoal(goalJson: string | null): PodGoal | null {
  const parsed = safeJsonParse<PodGoal>(goalJson ?? "");
  return normalizePodGoal(parsed ?? null);
}

export function parseSchedule(
  scheduleJson: string,
): ScheduleConfig | undefined {
  const persisted = safeJsonParse<Record<string, unknown>>(scheduleJson);
  if (!persisted) return undefined;
  return {
    ...persisted,
    lastTriggeredAt: persisted.lastTriggeredAt
      ? new Date(persisted.lastTriggeredAt as string)
      : null,
  } as ScheduleConfig;
}

export function buildPodFromRow(
  row: PodRow,
  relations: {
    mcpServerNames: Map<string, string[]>;
    pluginIds: Map<string, string[]>;
  },
  bindingsMap: Map<string, IntegrationBinding[]>,
  memoryStateMaps: {
    podStates: Map<
      string,
      { memoryEnabled: boolean; hasSummary: boolean } | undefined
    >;
    repoStates: Map<
      string,
      { memoryEnabled: boolean; hasSummary: boolean } | undefined
    >;
  },
): Pod {
  const provider = resolveProviderName(row.provider);
  const providerConfig = resolveProviderConfigFromRow(row, provider);
  const podMemoryState = memoryStateMaps.podStates.get(row.id);
  const repoMemoryState = row.repository_id
    ? memoryStateMaps.repoStates.get(row.repository_id)
    : undefined;

  const pod: Pod = {
    id: row.id,
    name: row.name,
    workspacePath: row.workspace_path,
    x: row.x,
    y: row.y,
    rotation: row.rotation,
    sessionId: row.session_id,
    mcpServerNames: relations.mcpServerNames.get(row.id) ?? [],
    agentCanvasMcpEnabled: row.agent_canvas_mcp_enabled === 1,
    pluginIds: relations.pluginIds.get(row.id) ?? [],
    provider,
    providerConfig,
    fastModeEnabled: row.fast_mode_enabled === 1,
    repositoryId: row.repository_id,
    goal: parseGoal(row.goal_json),
    integrationBindings: bindingsMap.get(row.id) ?? [],
    memoryEnabled: podMemoryState?.memoryEnabled ?? false,
    repoMemoryEnabled: repoMemoryState?.memoryEnabled ?? false,
    hasPodMemory: podMemoryState?.hasSummary ?? false,
    hasRepoMemory: repoMemoryState?.hasSummary ?? false,
  };
  if (row.schedule_json) {
    pod.schedule = parseSchedule(row.schedule_json);
  }
  return pod;
}
