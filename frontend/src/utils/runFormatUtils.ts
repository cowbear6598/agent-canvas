import { MS_PER_SECOND, MS_PER_MINUTE, MS_PER_HOUR } from '@/lib/constants'

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

export function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffSeconds = Math.floor(diffMs / MS_PER_SECOND)

  if (diffSeconds < SECONDS_PER_MINUTE) return '剛剛'

  const diffMinutes = Math.floor(diffMs / MS_PER_MINUTE)
  if (diffMinutes < MINUTES_PER_HOUR) return `${diffMinutes} 分鐘前`

  const diffHours = Math.floor(diffMs / MS_PER_HOUR)
  if (diffHours < HOURS_PER_DAY) return `${diffHours} 小時前`

  const diffDays = Math.floor(diffMs / (MS_PER_HOUR * HOURS_PER_DAY))
  return `${diffDays} 天前`
}

export function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message
  return `${message.slice(0, maxLength)}...`
}
