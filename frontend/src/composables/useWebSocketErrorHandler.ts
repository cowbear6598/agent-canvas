import { useToast } from '@/composables/useToast'
import type { ToastCategory } from '@/composables/useToast'
import { sanitizeErrorForUser } from '@/utils/errorSanitizer'

export function useWebSocketErrorHandler(): {
  handleWebSocketError: (error: unknown, title?: string) => void
  wrapWebSocketRequest: <T>(promise: Promise<T>) => Promise<T | null>
  withErrorToast: <T>(promise: Promise<T>, category: ToastCategory, action: string, options?: { rethrow?: boolean }) => Promise<T | null>
} {
  const { toast, showErrorToast } = useToast()

  const handleWebSocketError = (error: unknown, title = '操作失敗'): void => {
    const message = sanitizeErrorForUser(error)
    toast({
      title,
      description: message,
      variant: 'destructive'
    })
  }

  const wrapWebSocketRequest = <T>(promise: Promise<T>): Promise<T | null> => {
    return promise.catch((error) => {
      console.error('[WebSocket] 請求失敗:', error)
      return null
    })
  }

  const withErrorToast = <T>(
    promise: Promise<T>,
    category: ToastCategory,
    action: string,
    options?: { rethrow?: boolean }
  ): Promise<T | null> => {
    return promise.catch((error) => {
      const message = sanitizeErrorForUser(error)
      showErrorToast(category, action, message)
      if (options?.rethrow) {
        throw new Error(message)
      }
      return null
    })
  }

  return {
    handleWebSocketError,
    wrapWebSocketRequest,
    withErrorToast
  }
}
