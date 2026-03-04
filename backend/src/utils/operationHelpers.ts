import { simpleGit } from 'simple-git';
import { Result, ok, err } from '../types';
import { logger, type LogCategory } from './logger.js';

function createOperationRunner(logCategory: LogCategory, logPrefix: string) {
  return async function<T>(operation: () => Promise<T>, errorContext: string): Promise<Result<T>> {
    try {
      return ok(await operation());
    } catch (error) {
      logger.error(logCategory, 'Error', `[${logPrefix}] ${errorContext}`, error);
      return err(errorContext);
    }
  };
}

export const gitOperation = createOperationRunner('Git', 'Git');

export async function gitOperationWithPath<T>(
  workspacePath: string,
  operation: (git: ReturnType<typeof simpleGit>) => Promise<T>,
  errorContext: string
): Promise<Result<T>> {
  return gitOperation(() => operation(simpleGit(workspacePath)), errorContext);
}

export function resultOrDefault<T>(result: Result<T>, defaultValue: T): Result<T> {
  if (!result.success || result.data === undefined) {
    return ok(defaultValue);
  }
  return ok(result.data);
}

export const fsOperation = createOperationRunner('Workspace', 'FS');

export function getGitStageMessage(stage: string): string {
  const stageMessages: Record<string, string> = {
    counting: '計算物件數量...',
    compressing: '壓縮物件...',
    receiving: '接收物件...',
    resolving: '解析差異...',
    writing: '寫入物件...',
  };

  return stageMessages[stage] ?? '處理中...';
}

export function fireAndForget(promise: Promise<unknown>, category: LogCategory, errorContext: string): void {
  promise.catch((error) => {
    logger.error(category, 'Error', errorContext, error);
  });
}

export function safeExecute<T>(operation: () => T): Result<T> {
  try {
    return ok(operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
}

export async function safeExecuteAsync<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
}

