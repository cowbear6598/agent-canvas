export type Result<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export function ok<T = void>(data?: T): Result<T> {
  return { success: true, data: data as T };
}

export function err<T = void>(error: string): Result<T> {
  return { success: false, error };
}
