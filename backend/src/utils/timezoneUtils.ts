export interface OffsettedParts {
  year: number;
  month: number;
  date: number;
  hours: number;
  minutes: number;
  seconds: number;
  day: number;
}

/**
 * 將 UTC 時間轉換為指定 offset（小時）的時區時間，並拆解為各時間部分
 * @param utcDate - UTC 時間
 * @param offset - 時區偏移量（小時），例如 +8 為台灣時間
 */
export function toOffsettedParts(
  utcDate: Date,
  offset: number,
): OffsettedParts {
  const offsetMs = offset * 60 * 60 * 1000;
  const shifted = new Date(utcDate.getTime() + offsetMs);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    day: (shifted.getUTCDay() + 6) % 7, // 轉換為 ISO 慣例：0=週一, 6=週日
  };
}

/**
 * 判斷兩個 UTC 時間在指定 offset 下是否為同一天
 * @param date1 - 第一個 UTC 時間
 * @param date2 - 第二個 UTC 時間
 * @param offset - 時區偏移量（小時）
 */
export function isSameDayWithOffset(
  date1: Date,
  date2: Date,
  offset: number,
): boolean {
  const parts1 = toOffsettedParts(date1, offset);
  const parts2 = toOffsettedParts(date2, offset);

  return (
    parts1.year === parts2.year &&
    parts1.month === parts2.month &&
    parts1.date === parts2.date
  );
}
