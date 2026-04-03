// JSON.parse 在格式無效時會 throw，try-catch 是必要的轉換機制
export function safeJsonParse<T = unknown>(jsonString: string): T | null {
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return null;
  }
}
