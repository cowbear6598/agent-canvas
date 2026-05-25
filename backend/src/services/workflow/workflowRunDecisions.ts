export type SummaryFallbackDecision =
  | { kind: "summary" }
  | { kind: "fallback"; content: string }
  | { kind: "failed"; errorMessage: string };

export type WorkflowSummaryDecision =
  | {
      kind: "complete";
      event: "summary-complete";
      content: string;
      isSummarized: boolean;
      resolvedModel?: string;
    }
  | {
      kind: "failed";
      event: "summary-failed";
      errorMessage: string;
    };

export function decideSummaryFallback(
  summarySucceeded: boolean,
  fallbackContent: string | null,
  errorMessage: string,
): SummaryFallbackDecision {
  if (summarySucceeded) return { kind: "summary" };
  if (fallbackContent) return { kind: "fallback", content: fallbackContent };
  return { kind: "failed", errorMessage };
}

export function decideWorkflowSummary(
  summarySucceeded: boolean,
  summaryContent: string,
  resolvedModel: string | undefined,
  fallbackContent: string | null,
  errorMessage: string,
): WorkflowSummaryDecision {
  const fallbackDecision = decideSummaryFallback(
    summarySucceeded,
    fallbackContent,
    errorMessage,
  );

  if (fallbackDecision.kind === "summary") {
    return {
      kind: "complete",
      event: "summary-complete",
      content: summaryContent,
      isSummarized: true,
      resolvedModel,
    };
  }

  if (fallbackDecision.kind === "fallback") {
    return {
      kind: "complete",
      event: "summary-complete",
      content: fallbackDecision.content,
      isSummarized: false,
    };
  }

  return {
    kind: "failed",
    event: "summary-failed",
    errorMessage: fallbackDecision.errorMessage,
  };
}
