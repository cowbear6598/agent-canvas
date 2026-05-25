export const WORKFLOW_CLIENT_ERROR_MESSAGE =
  "Workflow 執行失敗，請查看後端日誌或稍後再試";

export type WorkflowClientErrorCode =
  | "WORKFLOW_EXECUTION_FAILED"
  | "WORKFLOW_BRANCH_FAILED";

export interface ClientSafeWorkflowError {
  code: WorkflowClientErrorCode;
  message: string;
}

export function createClientSafeWorkflowError(
  code: WorkflowClientErrorCode = "WORKFLOW_EXECUTION_FAILED",
): ClientSafeWorkflowError {
  return {
    code,
    message: WORKFLOW_CLIENT_ERROR_MESSAGE,
  };
}
