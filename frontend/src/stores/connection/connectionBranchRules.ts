import type {
  BRANCH_DESCRIPTION_MAX_LENGTH,
  BRANCH_LABEL_MAX_LENGTH,
  BRANCH_RESERVED_LABEL,
  Connection,
} from "@/types/connection";
import type { PodProvider } from "@/types/pod";
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

export type BranchSettingsUpdates = Pick<
  ConnectionUpdatePayload,
  "triggerMode" | "label" | "description"
>;

export interface ProviderCapabilityReader {
  getDefaultModel(provider: PodProvider): string | undefined;
  getDefaultThinkingLevel(
    provider: PodProvider,
    model: string,
  ): string | null | undefined;
}

export function buildBranchSettingsUpdates(
  payload: BranchSettingsPayload,
): BranchSettingsUpdates {
  const updates: BranchSettingsUpdates = {
    label: payload.label,
    description: payload.description,
  };

  if (payload.switchToBranch) {
    updates.triggerMode = "branch";
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
