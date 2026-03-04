import type { SlackApp, SlackAppConnectionStatus } from '@/types/slack'

export const SLACK_CONNECTION_STATUS_CONFIG: Record<SlackAppConnectionStatus, { dotClass: string; bg: string; label: string }> = {
  connected: { dotClass: 'bg-green-500', bg: 'bg-white', label: '已連接' },
  disconnected: { dotClass: 'bg-red-500', bg: 'bg-red-100', label: '已斷線' },
  error: { dotClass: 'bg-red-500', bg: 'bg-red-100', label: '錯誤' },
}

export function connectionStatusClass(app: SlackApp): string {
  return SLACK_CONNECTION_STATUS_CONFIG[app.connectionStatus]?.dotClass ?? 'bg-red-500'
}
