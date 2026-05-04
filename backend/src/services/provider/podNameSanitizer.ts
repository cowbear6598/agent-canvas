/**
 * Pod 名稱 sanitize helper：截前 50 字元 + 移除控制字元，避免 log injection。
 * 各 provider chat 入口的「Pod 開始查詢」log 統一透過此 helper 處理 pod.name。
 */
export function sanitizePodName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.slice(0, 50).replace(/[\x00-\x1f\x7f]/g, "");
}
