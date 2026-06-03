import { socketService } from "../socketService.js";

export type ApplicationCommandDispatch =
  | {
      scope: "connection";
      connectionId: string;
      event: string;
      payload: unknown;
    }
  | {
      scope: "canvas";
      canvasId: string;
      event: string;
      payload: unknown;
    };

export interface ApplicationCommandResult<T = void> {
  data: T;
  dispatches: ApplicationCommandDispatch[];
}

export function dispatchApplicationCommand(
  result: ApplicationCommandResult<unknown>,
): void {
  for (const dispatch of result.dispatches) {
    if (dispatch.scope === "connection") {
      socketService.emitToConnection(
        dispatch.connectionId,
        dispatch.event,
        dispatch.payload,
      );
      continue;
    }

    socketService.emitToCanvas(
      dispatch.canvasId,
      dispatch.event,
      dispatch.payload,
    );
  }
}
