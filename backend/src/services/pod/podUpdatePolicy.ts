import type { Pod, ScheduleConfig } from "../../types/index.js";
import { normalizePodGoal } from "../../types/pod.js";
import { sanitizeProviderConfigStrict } from "./providerConfigResolver.js";

export type PodUpdates = Partial<Omit<Pod, "schedule">> & {
  schedule?: ScheduleConfig | null;
};

export function serializeSchedule(schedule?: ScheduleConfig): string | null {
  if (!schedule) return null;
  return JSON.stringify({
    ...schedule,
    lastTriggeredAt: schedule.lastTriggeredAt
      ? schedule.lastTriggeredAt.toISOString()
      : null,
  });
}

export function mergeSchedule(
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

export function buildUpdatedPod(pod: Pod, updates: PodUpdates): Pod {
  const {
    id: _id,
    workspacePath: _wp,
    schedule: _sched,
    ...safeUpdates
  } = updates as PodUpdates & Partial<Pod>;
  const updatedPod = {
    ...pod,
    ...safeUpdates,
    schedule: mergeSchedule(pod, updates),
  };
  updatedPod.goal = normalizePodGoal(updatedPod.goal ?? null);
  return updatedPod;
}

export function preparePodUpdatePayload(
  pod: Pod,
  updates: PodUpdates,
): { updatedPod: Pod; sanitizedProviderConfigJson: string | null } {
  const updatedPod = buildUpdatedPod(pod, updates);
  const sanitizedProviderConfig = updatedPod.providerConfig
    ? sanitizeProviderConfigStrict(updatedPod.providerConfig, updatedPod.provider)
    : null;
  updatedPod.providerConfig = sanitizedProviderConfig;
  const sanitizedProviderConfigJson = sanitizedProviderConfig
    ? JSON.stringify(sanitizedProviderConfig)
    : null;
  return { updatedPod, sanitizedProviderConfigJson };
}
