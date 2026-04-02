import { MS_PER_SECOND, MS_PER_MINUTE, MS_PER_HOUR } from "@/lib/constants";
import { t } from "@/i18n";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export function formatRelativeTime(
  isoString: string | null | undefined,
): string {
  if (!isoString) return t("time.notStarted");
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (Number.isNaN(diffMs)) return t("time.unknown");
  const diffSeconds = Math.floor(diffMs / MS_PER_SECOND);

  if (diffSeconds < SECONDS_PER_MINUTE) return t("time.justNow");

  const diffMinutes = Math.floor(diffMs / MS_PER_MINUTE);
  if (diffMinutes < MINUTES_PER_HOUR)
    return t("time.minutesAgo", { n: diffMinutes });

  const diffHours = Math.floor(diffMs / MS_PER_HOUR);
  if (diffHours < HOURS_PER_DAY) return t("time.hoursAgo", { n: diffHours });

  const diffDays = Math.floor(diffMs / (MS_PER_HOUR * HOURS_PER_DAY));
  return t("time.daysAgo", { n: diffDays });
}

export function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength)}...`;
}
