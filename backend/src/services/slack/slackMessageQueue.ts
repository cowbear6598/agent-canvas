import type {SlackQueueMessage} from '../../types/index.js';

const MAX_QUEUE_SIZE = 10;

class SlackMessageQueue {
    private queues: Map<string, SlackQueueMessage[]> = new Map();

    enqueue(podId: string, message: SlackQueueMessage): void {
        let queue = this.queues.get(podId);
        if (!queue) {
            queue = [];
            this.queues.set(podId, queue);
        }

        queue.push(message);

        if (queue.length > MAX_QUEUE_SIZE) {
            queue.shift();
        }
    }

    dequeue(podId: string): SlackQueueMessage | undefined {
        const queue = this.queues.get(podId);
        if (!queue || queue.length === 0) {
            return undefined;
        }

        const message = queue.shift();

        if (queue.length === 0) {
            this.queues.delete(podId);
        }

        return message;
    }

    clear(podId: string): void {
        this.queues.delete(podId);
    }

    size(podId: string): number {
        return this.queues.get(podId)?.length ?? 0;
    }
}

export const slackMessageQueue = new SlackMessageQueue();
