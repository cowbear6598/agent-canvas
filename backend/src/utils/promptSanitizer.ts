export function sanitizeForPrompt(input: string): string {
  return input
    .replace(/</g, '＜')
    .replace(/>/g, '＞');
}
