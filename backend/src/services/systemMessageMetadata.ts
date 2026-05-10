import type { PersistedMessage } from "../types/persistence.js";
import type { SystemMessageMetadata } from "../types/message.js";

export function sanitizeSystemMessageMetadataForClient(
  metadata?: SystemMessageMetadata,
): SystemMessageMetadata | undefined {
  if (!metadata) return undefined;

  return {
    ...metadata,
    rawContent: "",
  };
}

export function sanitizePersistedMessageForClient(
  message: PersistedMessage,
): PersistedMessage {
  return {
    ...message,
    metadata: sanitizeSystemMessageMetadataForClient(message.metadata),
  };
}
