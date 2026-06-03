/**
 * 代表可安全顯示給使用者的業務錯誤。
 * 其他未標記錯誤應使用通用訊息，避免洩漏內部細節。
 */
export class UserVisibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserVisibleError";
  }
}

export function getUserVisibleErrorMessage(error: Error): string | null {
  if (error instanceof UserVisibleError) {
    return error.message;
  }

  return null;
}
