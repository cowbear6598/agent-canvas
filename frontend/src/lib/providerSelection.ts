import type { PodProvider, ProviderConfig, ModelOption } from "@/types/pod";

type ProviderCapabilityAccessor = {
  getAvailableModels: (provider: PodProvider) => ReadonlyArray<ModelOption>;
  getDefaultOptions: (
    provider: PodProvider,
  ) => Record<string, unknown> | undefined;
};

export function resolveDefaultProviderConfig(
  providerStore: ProviderCapabilityAccessor,
  provider: PodProvider,
): ProviderConfig | null {
  if (provider === "opencode") {
    const model = providerStore.getAvailableModels(provider)[0]?.value;
    return model ? { model } : null;
  }

  const defaultOptions = providerStore.getDefaultOptions(provider);
  if (
    defaultOptions === undefined ||
    typeof defaultOptions.model !== "string" ||
    defaultOptions.model.trim().length === 0
  ) {
    return null;
  }

  return { model: defaultOptions.model };
}

export function isProviderSelectionDisabled(
  providerStore: ProviderCapabilityAccessor,
  provider: PodProvider,
): boolean {
  if (provider === "opencode") return false;
  return resolveDefaultProviderConfig(providerStore, provider) === null;
}
