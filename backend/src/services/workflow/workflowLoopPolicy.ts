import type { Connection } from "../../types/index.js";

export type SessionContinuityPolicy = "new-session" | "resume-session";

/**
 * Loop session policy 的單一預設入口。
 * 後續若開放 Canvas 或 Connection 層級設定，只需替換此處的解析來源。
 */
export const DEFAULT_LOOP_SESSION_CONTINUITY: SessionContinuityPolicy =
  "new-session";

export function resolveLoopSessionContinuity(
  isCyclicPod: boolean,
): SessionContinuityPolicy {
  return isCyclicPod
    ? DEFAULT_LOOP_SESSION_CONTINUITY
    : "resume-session";
}

/** 使用 Tarjan SCC 找出位於循環中的 Pod，包含 self-loop。 */
export function collectCyclicPodIds(
  podIds: Iterable<string>,
  connections: Connection[],
): Set<string> {
  const includedPodIds = new Set(podIds);
  const adjacency = new Map<string, string[]>();
  for (const podId of includedPodIds) {
    adjacency.set(podId, []);
  }
  for (const connection of connections) {
    if (
      includedPodIds.has(connection.sourcePodId) &&
      includedPodIds.has(connection.targetPodId)
    ) {
      adjacency.get(connection.sourcePodId)?.push(connection.targetPodId);
    }
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclicPodIds = new Set<string>();

  const visit = (podId: string): void => {
    const currentIndex = nextIndex;
    nextIndex += 1;
    indices.set(podId, currentIndex);
    lowLinks.set(podId, currentIndex);
    stack.push(podId);
    onStack.add(podId);

    for (const targetPodId of adjacency.get(podId) ?? []) {
      if (!indices.has(targetPodId)) {
        visit(targetPodId);
        lowLinks.set(
          podId,
          Math.min(
            lowLinks.get(podId) ?? currentIndex,
            lowLinks.get(targetPodId) ?? currentIndex,
          ),
        );
      } else if (onStack.has(targetPodId)) {
        lowLinks.set(
          podId,
          Math.min(
            lowLinks.get(podId) ?? currentIndex,
            indices.get(targetPodId) ?? currentIndex,
          ),
        );
      }
    }

    if (lowLinks.get(podId) !== currentIndex) return;

    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
      if (member === podId) break;
    }

    const isSelfLoop =
      component.length === 1 &&
      (adjacency.get(component[0] ?? "") ?? []).includes(component[0] ?? "");
    if (component.length > 1 || isSelfLoop) {
      for (const member of component) {
        cyclicPodIds.add(member);
      }
    }
  };

  for (const podId of includedPodIds) {
    if (!indices.has(podId)) visit(podId);
  }

  return cyclicPodIds;
}
