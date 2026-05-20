import { useToast } from "@/composables/useToast";
import type { ToastCategory } from "@/composables/useToast";
import { sanitizeErrorForUser } from "@/utils/errorSanitizer";
import { t } from "@/i18n";

export function useWebSocketErrorHandler(): {
  handleWebSocketError: (error: unknown, title?: string) => void;
  wrapWebSocketRequest: <T>(promise: Promise<T>) => Promise<T>;
  withErrorToast: <T>(
    promise: Promise<T>,
    category: ToastCategory,
    action: string,
    options?: { swallow?: boolean },
  ) => Promise<T | null>;
} {
  const { toast, showErrorToast } = useToast();

  const handleWebSocketError = (error: unknown, title?: string): void => {
    const resolvedTitle = title ?? t("common.error.operation");
    const message = sanitizeErrorForUser(error);
    toast({
      title: resolvedTitle,
      description: message,
      variant: "destructive",
    });
  };

  // 失敗時記錄日誌後重新拋出，讓呼叫端明確處理錯誤，避免把 null 誤判為成功值
  const wrapWebSocketRequest = <T>(promise: Promise<T>): Promise<T> => {
    return promise.catch((error) => {
      console.error("[WebSocket] 請求失敗:", error);
      throw error;
    });
  };

  // 預設行為為重新拋出錯誤；若需吞錯（toast-and-swallow）請明確傳入 { swallow: true }
  const withErrorToast = <T>(
    promise: Promise<T>,
    category: ToastCategory,
    action: string,
    options?: { swallow?: boolean },
  ): Promise<T | null> => {
    return promise.catch((error) => {
      const message = sanitizeErrorForUser(error);
      showErrorToast(category, action, message);
      if (options?.swallow) {
        return null;
      }
      throw new Error(message);
    });
  };

  return {
    handleWebSocketError,
    wrapWebSocketRequest,
    withErrorToast,
  };
}
