import type { ToastCategory } from '@/composables/useToast'

type ShowErrorToast = (category: ToastCategory, action: string, reason?: string) => string

export function handleNullResponse(
  response: unknown,
  showErrorToast: ShowErrorToast,
  category: ToastCategory,
  action: string,
  errorMessage?: string
): { success: false; error: string } | null {
  if (!response) {
    showErrorToast(category, action, errorMessage)
    return { success: false, error: errorMessage ?? action }
  }
  return null
}
