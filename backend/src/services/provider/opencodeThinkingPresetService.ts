export interface OpencodeThinkingPresetLevel {
  id: string;
  label: string;
  options: Record<string, unknown>;
}

export interface OpencodeThinkingPresetSnapshot {
  levels: OpencodeThinkingPresetLevel[];
  defaultLevel: string | null;
  metadata: Record<string, unknown>;
  fetchedAt: number;
}

export type OpencodeThinkingPresetResult =
  | { ok: true; snapshot: OpencodeThinkingPresetSnapshot }
  | { ok: false; code: string; message: string };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function hasReasoningSupport(modelMetadata: Record<string, unknown>): boolean {
  const capabilities = readRecord(modelMetadata.capabilities);
  return (
    modelMetadata.reasoning === true ||
    capabilities?.reasoning === true ||
    modelMetadata.interleaved !== undefined
  );
}

function formatVariantLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 1
        ? part.toUpperCase()
        : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`,
    )
    .join(" ");
}

function readVariantIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        const record = readRecord(item);
        return typeof record?.id === "string" ? record.id : null;
      })
      .filter((id): id is string => Boolean(id));
  }

  const record = readRecord(value);
  if (!record) return [];

  return Object.entries(record)
    .filter(([, config]) => readRecord(config)?.disabled !== true)
    .map(([id]) => id);
}

function createLevelsFromVariants(
  modelMetadata: Record<string, unknown>,
): OpencodeThinkingPresetLevel[] {
  const variantIds = readVariantIds(modelMetadata.variants);
  return variantIds.map((id) => ({
    id,
    label: formatVariantLabel(id),
    options: { variant: id },
  }));
}

function resolveDefaultLevel(
  levels: OpencodeThinkingPresetLevel[],
  modelMetadata: Record<string, unknown>,
): string | null {
  if (levels.length === 0) return null;

  const options = readRecord(modelMetadata.options);
  const defaultVariant =
    typeof options?.variant === "string" ? options.variant : null;
  if (defaultVariant && levels.some((level) => level.id === defaultVariant)) {
    return defaultVariant;
  }

  const medium = levels.find((level) => level.id === "medium");
  return medium?.id ?? levels[0]?.id ?? null;
}

export function buildOpencodeThinkingPresetSnapshot(input: {
  providerID: string;
  modelID: string;
  providerMetadata?: unknown;
  modelMetadata?: unknown;
  fetchedAt?: number;
}): OpencodeThinkingPresetResult {
  const fetchedAt = input.fetchedAt ?? Date.now();
  const modelMetadata = readRecord(input.modelMetadata);
  if (!modelMetadata) {
    return {
      ok: true,
      snapshot: {
        levels: [],
        defaultLevel: null,
        fetchedAt,
        metadata: {
          providerID: input.providerID,
          modelID: input.modelID,
          provider: input.providerMetadata ?? null,
          model: null,
          reason: "model_metadata_missing",
        },
      },
    };
  }

  if (!hasReasoningSupport(modelMetadata)) {
    return {
      ok: true,
      snapshot: {
        levels: [],
        defaultLevel: null,
        fetchedAt,
        metadata: {
          providerID: input.providerID,
          modelID: input.modelID,
          provider: input.providerMetadata ?? null,
          model: modelMetadata,
          reason: "reasoning_not_supported",
        },
      },
    };
  }

  const levels = createLevelsFromVariants(modelMetadata);

  return {
    ok: true,
    snapshot: {
      levels,
      defaultLevel: resolveDefaultLevel(levels, modelMetadata),
      fetchedAt,
      metadata: {
        providerID: input.providerID,
        modelID: input.modelID,
        provider: input.providerMetadata ?? null,
        model: modelMetadata,
      },
    },
  };
}

export function parseOpencodeThinkingLevelsJson(
  json: string | null | undefined,
): OpencodeThinkingPresetLevel[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (level): level is OpencodeThinkingPresetLevel =>
        readRecord(level) !== null &&
        typeof (level as Record<string, unknown>).id === "string" &&
        typeof (level as Record<string, unknown>).label === "string" &&
        readRecord((level as Record<string, unknown>).options) !== null,
    );
  } catch {
    return [];
  }
}
