interface PendingTarget {
  targetPodId: string;
  requiredSourcePodIds: string[];
  completedSources: Map<string, string>;
  rejectedSources: Map<string, string>;
  createdAt: Date;
}

class PendingTargetStore {
  private pendingTargets: Map<string, PendingTarget> = new Map();

  initializePendingTarget(
    targetPodId: string,
    requiredSourcePodIds: string[],
  ): void {
    this.pendingTargets.set(targetPodId, {
      targetPodId,
      requiredSourcePodIds,
      completedSources: new Map(),
      rejectedSources: new Map(),
      createdAt: new Date(),
    });
  }

  recordSourceCompletion(
    targetPodId: string,
    sourcePodId: string,
    summaryContent: string,
    requiredSourcePodIds?: string[],
  ): { allSourcesResponded: boolean; hasRejection: boolean } {
    if (!this.pendingTargets.has(targetPodId) && requiredSourcePodIds) {
      this.initializePendingTarget(targetPodId, requiredSourcePodIds);
    }

    const pending = this.pendingTargets.get(targetPodId);
    if (!pending) {
      return { allSourcesResponded: false, hasRejection: false };
    }

    pending.completedSources.set(sourcePodId, summaryContent);

    const allSourcesResponded =
      pending.completedSources.size + pending.rejectedSources.size >=
      pending.requiredSourcePodIds.length;
    const hasRejection = pending.rejectedSources.size > 0;

    return { allSourcesResponded, hasRejection };
  }

  recordSourceRejection(
    targetPodId: string,
    sourcePodId: string,
    reason: string,
    requiredSourcePodIds?: string[],
  ): { allSourcesResponded: boolean } {
    if (!this.pendingTargets.has(targetPodId) && requiredSourcePodIds) {
      this.initializePendingTarget(targetPodId, requiredSourcePodIds);
    }

    const pending = this.pendingTargets.get(targetPodId);
    if (!pending) {
      return { allSourcesResponded: false };
    }

    pending.rejectedSources.set(sourcePodId, reason);

    const allSourcesResponded =
      pending.completedSources.size + pending.rejectedSources.size >=
      pending.requiredSourcePodIds.length;

    return { allSourcesResponded };
  }

  hasAnyRejectedSource(targetPodId: string): boolean {
    const pending = this.pendingTargets.get(targetPodId);
    return pending ? pending.rejectedSources.size > 0 : false;
  }

  getRejectedSources(targetPodId: string): Map<string, string> | undefined {
    const pending = this.pendingTargets.get(targetPodId);
    return pending?.rejectedSources;
  }

  getCompletedSummaries(targetPodId: string): Map<string, string> | undefined {
    const pending = this.pendingTargets.get(targetPodId);
    return pending?.completedSources;
  }

  clearPendingTarget(targetPodId: string): void {
    this.pendingTargets.delete(targetPodId);
  }

  hasPendingTarget(targetPodId: string): boolean {
    return this.pendingTargets.has(targetPodId);
  }

  getPendingTarget(targetPodId: string): PendingTarget | undefined {
    return this.pendingTargets.get(targetPodId);
  }

  removeSourceFromAllPending(sourcePodId: string): string[] {
    const affectedTargetIds: string[] = [];

    for (const [targetPodId, pending] of this.pendingTargets.entries()) {
      const wasInRequired = pending.requiredSourcePodIds.includes(sourcePodId);

      if (wasInRequired) {
        pending.requiredSourcePodIds = pending.requiredSourcePodIds.filter(
          (id) => id !== sourcePodId,
        );
        pending.completedSources.delete(sourcePodId);
        pending.rejectedSources.delete(sourcePodId);
        affectedTargetIds.push(targetPodId);
      }
    }

    return affectedTargetIds;
  }

  removeSourceFromPending(targetPodId: string, sourcePodId: string): void {
    const pending = this.pendingTargets.get(targetPodId);
    if (!pending) {
      return;
    }

    pending.requiredSourcePodIds = pending.requiredSourcePodIds.filter(
      (id) => id !== sourcePodId,
    );
    pending.completedSources.delete(sourcePodId);
    pending.rejectedSources.delete(sourcePodId);
  }
}

export const pendingTargetStore = new PendingTargetStore();
