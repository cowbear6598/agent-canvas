import type { Pod, PodGoal, PodProvider, ProviderConfig } from "@/types";

export function areGoalsEqual(
  left: PodGoal | null | undefined,
  right: PodGoal | null | undefined,
): boolean {
  const leftTodos = left?.todos ?? [];
  const rightTodos = right?.todos ?? [];

  if (leftTodos.length !== rightTodos.length) return false;

  return leftTodos.every((todo, index) => {
    const other = rightTodos[index];
    return other && todo.id === other.id && todo.text === other.text;
  });
}

export function getMcpAvailabilityInvalidationProviders(
  previousPod: Pod,
  nextPod: Pod,
): PodProvider[] {
  const providers: PodProvider[] = [];

  if (
    previousPod.provider !== nextPod.provider ||
    !areGoalsEqual(previousPod.goal ?? null, nextPod.goal ?? null)
  ) {
    providers.push(previousPod.provider);
    if (previousPod.provider !== nextPod.provider) {
      providers.push(nextPod.provider);
    }
  }

  return providers;
}

export function updatePodProviderConfigModelState(
  providerConfig: ProviderConfig,
  model: string,
): ProviderConfig {
  return { ...providerConfig, model };
}

export function updatePodThinkingLevelState(
  providerConfig: ProviderConfig,
  level: string,
): ProviderConfig {
  return { ...providerConfig, thinkingLevel: level };
}
