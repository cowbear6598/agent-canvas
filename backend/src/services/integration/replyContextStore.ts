import type { RunContext } from '../../types/run.js';
import type { NormalizedEvent } from './types.js';

export interface ReplyContext {
    senderId?: string;
    messageTs?: string;
    threadTs?: string;
}

interface StoreEntry {
    context: ReplyContext;
    createdAt: number;
}

const REPLY_CONTEXT_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const store = new Map<string, StoreEntry>();

function cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (now - entry.createdAt > REPLY_CONTEXT_TTL_MS) {
            store.delete(key);
        }
    }
}

const cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);

export function buildReplyContextKey(runContext: RunContext | undefined, podId: string): string {
    if (runContext) {
        return `${runContext.runId}:${podId}`;
    }
    return `pod:${podId}`;
}

export function setReplyContextIfPresent(key: string, event: NormalizedEvent): void {
    if (!event.senderId && !event.messageTs && !event.threadTs) return;
    replyContextStore.set(key, {
        senderId: event.senderId,
        messageTs: event.messageTs,
        threadTs: event.threadTs,
    });
}

export const replyContextStore = {
    set(key: string, context: ReplyContext): void {
        store.set(key, { context, createdAt: Date.now() });
    },

    get(key: string): ReplyContext | undefined {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.createdAt > REPLY_CONTEXT_TTL_MS) {
            store.delete(key);
            return undefined;
        }
        return entry.context;
    },

    delete(key: string): void {
        store.delete(key);
    },

    dispose(): void {
        clearInterval(cleanupTimer);
    },
};
