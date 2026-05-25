import { WebSocketResponseEvents } from "@/services/websocket";
import {
  invalidateManagedMcpRegistryCache,
  invalidatePodMcpAvailabilityCache,
} from "@/services/managedMcpApi";
import { useManagedMcpStore } from "@/stores/managedMcpStore";
import { useToast } from "@/composables/useToast";
import { createUnifiedHandler } from "./sharedHandlerUtils";
import type { BasePayload } from "./sharedHandlerUtils";
import { t } from "@/i18n";

type ManagedMcpRegistryUpdatedPayload = BasePayload & {
  action?: "saved" | "deleted" | "diagnostics";
  registryId?: string;
  runId?: string;
};

type ManagedMcpSurfaceTargetsIgnoredPayload = BasePayload & {
  runId?: string;
  podId?: string;
  podName?: string;
  ignored?: Array<{ name: string; reason: string }>;
};

const handleManagedMcpRegistryUpdated =
  createUnifiedHandler<ManagedMcpRegistryUpdatedPayload>(
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

const handleManagedMcpSurfaceTargetsIgnored =
  createUnifiedHandler<ManagedMcpSurfaceTargetsIgnoredPayload>(
    (payload) => {
      if (!payload.ignored || payload.ignored.length === 0) return;

      const { showErrorToast } = useToast();
      const podLabel = payload.podName ?? payload.podId ?? "Pod";
      const summary = payload.ignored
        .map((target) => `${target.name}（${target.reason}）`)
        .join("、");

      showErrorToast(
        "Mcp",
        t("managedMcp.surfaceTargetsIgnoredTitle", { pod: podLabel }),
        summary,
      );
    },
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
    {
      event: WebSocketResponseEvents.MANAGED_MCP_SURFACE_TARGETS_IGNORED,
      handler: handleManagedMcpSurfaceTargetsIgnored as (
        payload: unknown,
      ) => void,
    },
  ];
}
