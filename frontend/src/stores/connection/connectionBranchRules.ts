import type {
  BRANCH_DESCRIPTION_MAX_LENGTH,
  BRANCH_LABEL_MAX_LENGTH,
  BRANCH_RESERVED_LABEL,
} from "@/types/connection";
import type { Connection } from "@/types/connection";
import type { PodProvider } from "@/types/pod";
import { DEFAULT_SUMMARY_MODEL } from "@/types/config";
import { normalizePodProvider } from "@/lib/providerOptions";
import type { ConnectionUpdatePayload } from "@/types/websocket";

type BranchLengthLimits = {
  labelMaxLength: typeof BRANCH_LABEL_MAX_LENGTH;
  descriptionMaxLength: typeof BRANCH_DESCRIPTION_MAX_LENGTH;
  reservedLabel: typeof BRANCH_RESERVED_LABEL;
};

export type BranchSettingsPayload = {
  switchToBranch: boolean;
  label: string;
  description: string;
};

export type BranchDefaults = {
  provider: PodProvider;
  model: string;
  thinkingLevel: string | null;
};

export type BranchSettingsUpdates = Pick<
  ConnectionUpdatePayload,
  | "triggerMode"
  | "label"
  | "description"
  | "branchProvider"
  | "branchModel"
  | "branchThinkingLevel"
>;

export interface ProviderCapabilityReader {
  getDefaultModel(provider: PodProvider): string | undefined;
  getDefaultThinkingLevel(
    provider: PodProvider,
    model: string,
  ): string | null | undefined;
}

export function shouldResolveBranchDefaultsForSettings(
  payload: BranchSettingsPayload,
  connection?: Connection,
): boolean {
  return payload.switchToBranch || !connection?.branchProvider;
}

export function buildBranchSettingsUpdates(
  payload: BranchSettingsPayload,
  branchDefaults?: BranchDefaults,
): BranchSettingsUpdates {
  const updates: BranchSettingsUpdates = {
    label: payload.label,
    description: payload.description,
  };

  if (payload.switchToBranch) {
    updates.triggerMode = "branch";
  }
  if (branchDefaults) {
    updates.branchProvider = branchDefaults.provider;
    updates.branchModel = branchDefaults.model;
    updates.branchThinkingLevel = branchDefaults.thinkingLevel;
  }

  return updates;
}

export function resolveDefaultThinkingLevel(
  providerCapabilityStore: ProviderCapabilityReader,
  provider: PodProvider,
  model: string,
): string | null {
  return (
    providerCapabilityStore.getDefaultThinkingLevel(provider, model) ?? null
  );
}

export function validateBranchLabel(
  sourcePodId: string,
  connectionId: string,
  label: string,
  siblings: Connection[],
  limits: BranchLengthLimits,
): { valid: true } | { valid: false; errorKey: string } {
  if (label.trim() === "") {
    return { valid: false, errorKey: "branchLabelEmpty" };
  }

  if (label.length > limits.labelMaxLength) {
    return { valid: false, errorKey: "branchLabelTooLong" };
  }

  if (label.toLowerCase() === limits.reservedLabel.toLowerCase()) {
    return { valid: false, errorKey: "branchLabelReserved" };
  }

  const isDuplicate = siblings.some(
    (conn) =>
      conn.sourcePodId === sourcePodId &&
      conn.id !== connectionId &&
      conn.label?.toLowerCase() === label.toLowerCase(),
  );
  if (isDuplicate) {
    return { valid: false, errorKey: "branchLabelDuplicate" };
  }

  return { valid: true };
}

export function validateBranchDescription(
  description: string,
  limits: BranchLengthLimits,
): { valid: true } | { valid: false; errorKey: string } {
  if (description.length > limits.descriptionMaxLength) {
    return { valid: false, errorKey: "branchDescriptionTooLong" };
  }
  return { valid: true };
}

export function validateBranchSettingsPayload(
  sourcePodId: string,
  connectionId: string,
  payload: BranchSettingsPayload,
  siblings: Connection[],
  limits: BranchLengthLimits,
): string | null {
  const labelResult = validateBranchLabel(
    sourcePodId,
    connectionId,
    payload.label,
    siblings,
    limits,
  );
  if (!labelResult.valid) return labelResult.errorKey;

  const descriptionResult = validateBranchDescription(
    payload.description,
    limits,
  );
  if (!descriptionResult.valid) return descriptionResult.errorKey;

  return null;
}

export function resolveBranchDefaultsFromSourcePod(
  sourcePod:
    | {
        provider?: PodProvider;
        providerConfig?: {
          model?: string;
        };
      }
    | undefined,
  providerCapabilityStore: ProviderCapabilityReader,
): BranchDefaults | null {
  const provider =
    normalizePodProvider(sourcePod?.provider ?? "claude") ?? "claude";
  const sourcePodModel =
    typeof sourcePod?.providerConfig?.model === "string" &&
    sourcePod.providerConfig.model.trim().length > 0
      ? sourcePod.providerConfig.model
      : undefined;
  const model =
    (provider === "opencode" ? sourcePodModel : undefined) ??
    providerCapabilityStore.getDefaultModel(provider) ??
    (provider === "claude" ? DEFAULT_SUMMARY_MODEL : undefined);

  if (!model) return null;
  return {
    provider,
    model,
    thinkingLevel: resolveDefaultThinkingLevel(
      providerCapabilityStore,
      provider,
      model,
    ),
  };
}
