import { getErrorMessage } from './errorHelpers.js';
import { logger } from './logger.js';
import type { LogCategory } from './logger.js';

export class WriteQueue {
    private queues: Map<string, Promise<void>> = new Map();
    private readonly category: LogCategory;
    private readonly storeName: string;

    constructor(category: LogCategory, storeName: string) {
        this.category = category;
        this.storeName = storeName;
    }

    enqueue(key: string, writeFn: () => Promise<void>): Promise<void> {
        const previousWrite = this.queues.get(key) ?? Promise.resolve();
        const nextWrite = previousWrite
            .then(() => writeFn())
            .catch((error: unknown) => {
                const errorMsg = getErrorMessage(error);
                logger.error(this.category, 'Error', `[${this.storeName}] 寫入佇列執行失敗 (${key}): ${errorMsg}`);
            });
        this.queues.set(key, nextWrite);
        return nextWrite;
    }

    flush(key: string): Promise<void> {
        return this.queues.get(key) ?? Promise.resolve();
    }

    delete(key: string): void {
        this.queues.delete(key);
    }
}
