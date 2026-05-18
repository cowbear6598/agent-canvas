import { WebSocketResponseEvents } from "@/services/websocket";
import {
  invalidateManagedMcpRegistryCache,
  invalidatePodMcpAvailabilityCache,
} from "@/services/managedMcpApi";
import { useManagedMcpStore } from "@/stores/managedMcpStore";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";

type ManagedMcpRegistryUpdatedPayload = BasePayload & {
  action?: "saved" | "deleted";
  registryId?: string;
};

const handleManagedMcpRegistryUpdated = createUnifiedHandler<
  ManagedMcpRegistryUpdatedPayload
>(
  () => {
    invalidateManagedMcpRegistryCache();
    invalidatePodMcpAvailabilityCache();

    const store = useManagedMcpStore();
    if (store.loaded) {
      void store.refresh();
    }
  },
  { skipCanvasCheck: true },
);

export function getManagedMcpEventListeners(): Array<{
  event: string;
  handler: (payload: unknown) => void;
}> {
  return [
    {
      event: WebSocketResponseEvents.MANAGED_MCP_REGISTRY_UPDATED,
      handler: handleManagedMcpRegistryUpdated as (payload: unknown) => void,
    },
  ];
}
