import type { Connection, Pod } from "../../types/index.js";
import { connectionStore } from "../connectionStore.js";
import {
  configStore,
  type ConnectionLineModelConfig,
} from "../configStore.js";
import { podStore } from "../podStore.js";

export interface RunWorkflowSnapshot {
  readonly canvasId: string;
  readonly sourcePodId: string;
  readonly connectionLineConfig: Readonly<ConnectionLineModelConfig>;
  readonly pods: ReadonlyMap<string, Readonly<Pod>>;
  readonly connections: ReadonlyMap<string, Readonly<Connection>>;
}

class ImmutableMapView<K, V> implements ReadonlyMap<K, V> {
  readonly [Symbol.toStringTag] = "Map";

  constructor(private readonly entriesMap: Map<K, V>) {
    Object.freeze(this);
  }

  get size(): number {
    return this.entriesMap.size;
  }

  entries(): MapIterator<[K, V]> {
    return this.entriesMap.entries();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entriesMap) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  get(key: K): V | undefined {
    return this.entriesMap.get(key);
  }

  has(key: K): boolean {
    return this.entriesMap.has(key);
  }

  keys(): MapIterator<K> {
    return this.entriesMap.keys();
  }

  values(): MapIterator<V> {
    return this.entriesMap.values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entriesMap[Symbol.iterator]();
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }
  return Object.freeze(value);
}

function freezeClone<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

export class RunWorkflowSnapshotStore {
  private readonly snapshots = new Map<string, RunWorkflowSnapshot>();

  /**
   * 在建立 Run row 前同步擷取完整可達子圖。
   * 任一 Pod 缺漏都會拒絕建立，避免留下不完整的執行定義。
   */
  capture(canvasId: string, sourcePodId: string): RunWorkflowSnapshot {
    const allConnections = connectionStore.list(canvasId);
    const outgoing = new Map<string, Connection[]>();
    for (const connection of allConnections) {
      const connections = outgoing.get(connection.sourcePodId) ?? [];
      connections.push(connection);
      outgoing.set(connection.sourcePodId, connections);
    }

    const podIds = new Set<string>([sourcePodId]);
    const reachableConnections: Connection[] = [];
    const queue = [sourcePodId];
    for (let index = 0; index < queue.length; index += 1) {
      const podId = queue[index];
      if (!podId) continue;
      for (const connection of outgoing.get(podId) ?? []) {
        reachableConnections.push(connection);
        if (!podIds.has(connection.targetPodId)) {
          podIds.add(connection.targetPodId);
          queue.push(connection.targetPodId);
        }
      }
    }

    const livePods = podStore.getByIds(canvasId, [...podIds]);
    const missingPodIds = [...podIds].filter((podId) => !livePods.has(podId));
    if (missingPodIds.length > 0) {
      throw new Error(
        `無法建立 Workflow snapshot：找不到 Pod ${missingPodIds.join("、")}`,
      );
    }

    const pods = new Map<string, Readonly<Pod>>();
    for (const podId of podIds) {
      const pod = livePods.get(podId);
      if (pod) pods.set(podId, freezeClone(pod));
    }
    const connections = new Map<string, Readonly<Connection>>();
    for (const connection of reachableConnections) {
      connections.set(connection.id, freezeClone(connection));
    }

    return Object.freeze({
      canvasId,
      sourcePodId,
      connectionLineConfig: freezeClone(
        configStore.getConnectionLineModelConfig(),
      ),
      pods: new ImmutableMapView(pods),
      connections: new ImmutableMapView(connections),
    });
  }

  set(runId: string, snapshot: RunWorkflowSnapshot): void {
    if (this.snapshots.has(runId)) {
      throw new Error(`Run ${runId} 已存在 Workflow snapshot`);
    }
    this.snapshots.set(runId, snapshot);
  }

  create(runId: string, canvasId: string, sourcePodId: string): RunWorkflowSnapshot {
    const snapshot = this.capture(canvasId, sourcePodId);
    this.set(runId, snapshot);
    return snapshot;
  }

  get(runId: string): RunWorkflowSnapshot | undefined {
    return this.snapshots.get(runId);
  }

  getRequired(runId: string): RunWorkflowSnapshot {
    const snapshot = this.get(runId);
    if (!snapshot) throw new Error(`Run ${runId} 的 Workflow snapshot 不存在`);
    return snapshot;
  }

  getPod(runId: string, podId: string): Pod | undefined {
    return this.get(runId)?.pods.get(podId) as Pod | undefined;
  }

  getPods(runId: string, podIds: Iterable<string>): Map<string, Pod> {
    const snapshot = this.getRequired(runId);
    const pods = new Map<string, Pod>();
    for (const podId of podIds) {
      const pod = snapshot.pods.get(podId);
      if (pod) pods.set(podId, pod as Pod);
    }
    return pods;
  }

  getConnection(runId: string, connectionId: string): Connection | undefined {
    return this.get(runId)?.connections.get(connectionId) as
      | Connection
      | undefined;
  }

  listConnections(runId: string): Connection[] {
    return [...this.getRequired(runId).connections.values()] as Connection[];
  }

  findConnectionsBySourcePodId(runId: string, sourcePodId: string): Connection[] {
    return this.listConnections(runId).filter(
      (connection) => connection.sourcePodId === sourcePodId,
    );
  }

  findConnectionsByTargetPodId(runId: string, targetPodId: string): Connection[] {
    return this.listConnections(runId).filter(
      (connection) => connection.targetPodId === targetPodId,
    );
  }

  has(runId: string): boolean {
    return this.snapshots.has(runId);
  }

  delete(runId: string): boolean {
    return this.snapshots.delete(runId);
  }

  clear(): void {
    this.snapshots.clear();
  }
}

export const runWorkflowSnapshotStore = new RunWorkflowSnapshotStore();
