type CommandPayload = Record<string, unknown>;

export function buildCanvasCommandPayload<TPayload extends CommandPayload>(
  canvasId: string,
  payload: TPayload,
): TPayload & { canvasId: string } {
  return {
    ...payload,
    canvasId,
  };
}

export function buildCanvasPodCommandPayload<TPayload extends CommandPayload>(
  canvasId: string,
  podId: string,
  payload: TPayload,
): TPayload & { canvasId: string; podId: string } {
  return {
    ...payload,
    canvasId,
    podId,
  };
}
