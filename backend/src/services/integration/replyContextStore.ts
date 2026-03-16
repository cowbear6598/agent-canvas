import type { RunContext } from '../../types/run.js';

export interface ReplyContext {
    senderId?: string;
    messageTs?: string;
    threadTs?: string;
}

const store = new Map<string, ReplyContext>();

export function buildReplyContextKey(runContext: RunContext | undefined, podId: string): string {
    if (runContext) {
        return `${runContext.runId}:${podId}`;
    }
    return `pod:${podId}`;
}

export const replyContextStore = {
    set(key: string, context: ReplyContext): void {
        store.set(key, context);
    },

    get(key: string): ReplyContext | undefined {
        return store.get(key);
    },

    delete(key: string): void {
        store.delete(key);
    },
};
