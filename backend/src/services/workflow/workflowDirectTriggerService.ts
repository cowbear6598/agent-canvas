import type {
  TriggerStrategy,
  TriggerDecideContext,
  TriggerDecideResult,
  CollectSourcesContext,
  CollectSourcesResult,
} from "./types.js";

class WorkflowDirectTriggerService implements TriggerStrategy {
  readonly mode = "direct" as const;

  async decide(context: TriggerDecideContext): Promise<TriggerDecideResult[]> {
    return context.connections.map((connection) => ({
      connectionId: connection.id,
      approved: true,
      reason: null,
      isError: false,
    }));
  }

  async collectSources(
    context: CollectSourcesContext,
  ): Promise<CollectSourcesResult> {
    return {
      ready: true,
      participatingConnectionIds: [context.connection.id],
    };
  }
}

export const workflowDirectTriggerService = new WorkflowDirectTriggerService();
