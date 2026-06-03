import { WebSocketResponseEvents } from "../../schemas/index.js";
import type {
  ConnectionCreatePayload,
  ConnectionUpdatePayload,
} from "../../schemas/index.js";
import type {
  Connection,
  ConnectionCreatedPayload,
  ConnectionDeletedPayload,
  ConnectionListResultPayload,
  ConnectionUpdatedPayload,
  Pod,
  PodScheduleSetPayload,
} from "../../types/index.js";
import { toConnectionPublic, toPodPublicView } from "../../types/index.js";
import { WebSocketError } from "../../middleware/wsErrorHandler.js";
import { connectionStore } from "../connectionStore.js";
import { podStore } from "../podStore.js";
import { workflowStateService } from "../workflow/index.js";
import { createI18nError } from "../../utils/i18nError.js";
import { getPodDisplayName } from "../../utils/handlerHelpers.js";
import { logger } from "../../utils/logger.js";
import type { ApplicationCommandResult } from "./applicationCommand.js";

class ConnectionCommandService {
  list(params: {
    connectionId: string;
    canvasId: string;
    requestId: string;
  }): ApplicationCommandResult<ConnectionListResultPayload> {
    const payload: ConnectionListResultPayload = {
      requestId: params.requestId,
      success: true,
      connections: connectionStore
        .list(params.canvasId)
        .map((connection) => toConnectionPublic(connection)),
    };

    return {
      data: payload,
      dispatches: [
        {
          scope: "connection",
          connectionId: params.connectionId,
          event: WebSocketResponseEvents.CONNECTION_LIST_RESULT,
          payload,
        },
      ],
    };
  }

  create(params: {
    canvasId: string;
    requestId: string;
    payload: ConnectionCreatePayload;
    sourcePod: Pod;
    targetPod: Pod;
  }): ApplicationCommandResult<ConnectionCreatedPayload> {
    let connection: Connection;
    try {
      connection = connectionStore.create(params.canvasId, {
        sourcePodId: params.payload.sourcePodId,
        sourceAnchor: params.payload.sourceAnchor,
        targetPodId: params.payload.targetPodId,
        targetAnchor: params.payload.targetAnchor,
        ...(params.payload.summaryModel !== undefined && {
          summaryModel: params.payload.summaryModel,
        }),
        ...(params.payload.summaryProvider !== undefined && {
          summaryProvider: params.payload.summaryProvider,
        }),
        ...(params.payload.summaryThinkingLevel !== undefined && {
          summaryThinkingLevel: params.payload.summaryThinkingLevel,
        }),
        ...(params.payload.direct !== undefined && {
          direct: params.payload.direct,
        }),
        label: params.payload.label,
        description: params.payload.description,
      });
    } catch (error) {
      throw new WebSocketError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }

    const createdPayload: ConnectionCreatedPayload = {
      requestId: params.requestId,
      canvasId: params.canvasId,
      success: true,
      connection: toConnectionPublic(connection),
    };

    const dispatches: ApplicationCommandResult<ConnectionCreatedPayload>["dispatches"] =
      [
        {
          scope: "canvas",
          canvasId: params.canvasId,
          event: WebSocketResponseEvents.CONNECTION_CREATED,
          payload: createdPayload,
        },
      ];

    if (params.targetPod.schedule) {
      const updatedTargetPod = podStore.update(params.canvasId, params.targetPod.id, {
        schedule: null,
      });
      if (updatedTargetPod) {
        const podSchedulePayload: PodScheduleSetPayload = {
          requestId: "",
          canvasId: params.canvasId,
          success: true,
          pod: toPodPublicView(updatedTargetPod.pod),
        };
        dispatches.push({
          scope: "canvas",
          canvasId: params.canvasId,
          event: WebSocketResponseEvents.POD_SCHEDULE_SET,
          payload: podSchedulePayload,
        });

        logger.log(
          "Connection",
          "Create",
          `已清除目標 Pod「${params.targetPod.name}」的排程（現為下游節點）`,
        );
      }
    }

    logger.log(
      "Connection",
      "Create",
      `已建立連線「${params.sourcePod.name} → ${params.targetPod.name}」`,
    );

    return {
      data: createdPayload,
      dispatches,
    };
  }

  delete(params: {
    canvasId: string;
    requestId: string;
    connectionId: string;
    connection: Connection;
  }): ApplicationCommandResult<ConnectionDeletedPayload> {
    workflowStateService.handleConnectionDeletion(
      params.canvasId,
      params.connectionId,
    );

    const deleted = connectionStore.delete(params.canvasId, params.connectionId);
    if (!deleted) {
      throw new WebSocketError(
        "INTERNAL_ERROR",
        createI18nError("errors.connectionDeleteFailed", {
          id: params.connectionId,
        }),
      );
    }

    const payload: ConnectionDeletedPayload = {
      requestId: params.requestId,
      canvasId: params.canvasId,
      success: true,
      connectionId: params.connectionId,
    };

    logger.log(
      "Connection",
      "Delete",
      `已刪除連線「${getPodDisplayName(params.canvasId, params.connection.sourcePodId)} → ${getPodDisplayName(params.canvasId, params.connection.targetPodId)}」`,
    );

    return {
      data: payload,
      dispatches: [
        {
          scope: "canvas",
          canvasId: params.canvasId,
          event: WebSocketResponseEvents.CONNECTION_DELETED,
          payload,
        },
      ],
    };
  }

  update(params: {
    canvasId: string;
    requestId: string;
    payload: ConnectionUpdatePayload;
  }): ApplicationCommandResult<ConnectionUpdatedPayload> {
    const updates = {
      ...(params.payload.triggerMode !== undefined && {
        triggerMode: params.payload.triggerMode,
      }),
      ...(params.payload.summaryModel !== undefined && {
        summaryModel: params.payload.summaryModel,
      }),
      ...(params.payload.summaryProvider !== undefined && {
        summaryProvider: params.payload.summaryProvider,
      }),
      ...(params.payload.summaryThinkingLevel !== undefined && {
        summaryThinkingLevel: params.payload.summaryThinkingLevel,
      }),
      ...(params.payload.direct !== undefined && {
        direct: params.payload.direct,
      }),
      ...(params.payload.label !== undefined && {
        label: params.payload.label,
      }),
      ...(params.payload.description !== undefined && {
        description: params.payload.description ?? null,
      }),
    };

    let updateResult: ReturnType<typeof connectionStore.updateBranchSiblingSettings>;
    try {
      updateResult = connectionStore.updateBranchSiblingSettings(
        params.canvasId,
        params.payload.connectionId,
        updates,
      );
    } catch (error) {
      throw new WebSocketError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!updateResult) {
      throw new WebSocketError(
        "INTERNAL_ERROR",
        createI18nError("errors.connectionUpdateFailed", {
          id: params.payload.connectionId,
        }),
      );
    }

    const payload: ConnectionUpdatedPayload = {
      requestId: params.requestId,
      canvasId: params.canvasId,
      success: true,
      connection: toConnectionPublic(updateResult.targetConnection),
      connections: updateResult.updatedConnections.map((connection) =>
        toConnectionPublic(connection),
      ),
    };

    return {
      data: payload,
      dispatches: [
        {
          scope: "canvas",
          canvasId: params.canvasId,
          event: WebSocketResponseEvents.CONNECTION_UPDATED,
          payload,
        },
      ],
    };
  }
}

export const connectionCommandService = new ConnectionCommandService();
