import type { ToastCategory } from '@/composables/useToast'

type ShowErrorToast = (category: ToastCategory, action: string, reason?: string) => string

export function isNullResponse<T>(
  response: T | null | undefined,
  showErrorToast: ShowErrorToast,
  category: ToastCategory,
  action: string,
): response is null | undefined {
  if (!response) {
    showErrorToast(category, action)
    return true
  }
  return false
}
