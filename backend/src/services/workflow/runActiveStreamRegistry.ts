export class RunActiveStreamRegistry {
  private readonly activeRunStreams = new Map<string, Map<string, number>>();

  register(runId: string, podId: string): void {
    if (!this.activeRunStreams.has(runId)) {
      this.activeRunStreams.set(runId, new Map());
    }
    const streams = this.activeRunStreams.get(runId)!;
    streams.set(podId, (streams.get(podId) ?? 0) + 1);
  }

  unregister(runId: string, podId: string): void {
    const streams = this.activeRunStreams.get(runId);
    if (!streams) return;

    const count = streams.get(podId) ?? 0;
    if (count > 1) {
      streams.set(podId, count - 1);
    } else {
      streams.delete(podId);
    }
    if (streams.size === 0) {
      this.activeRunStreams.delete(runId);
    }
  }

  hasActiveStream(runId: string, podId: string): boolean {
    const streams = this.activeRunStreams.get(runId);
    return streams !== undefined && streams.has(podId);
  }

  hasRun(runId: string): boolean {
    return this.activeRunStreams.has(runId);
  }

  takeRunPodCounts(runId: string): Map<string, number> | undefined {
    const activePodCounts = this.activeRunStreams.get(runId);
    if (activePodCounts) {
      this.activeRunStreams.delete(runId);
    }
    return activePodCounts;
  }

  getActiveRunIdsForPod(podId: string): string[] {
    const runIds: string[] = [];
    for (const [runId, podCounts] of this.activeRunStreams) {
      if (podCounts.has(podId)) {
        runIds.push(runId);
      }
    }
    return runIds;
  }
}
