import { WriteQueue } from '../../src/utils/writeQueue.js';

describe('WriteQueue', () => {
    let queue: WriteQueue;

    beforeEach(() => {
        queue = new WriteQueue('Pod', 'TestStore');
    });

    describe('enqueue 回傳 Promise', () => {
        it('在 writeFn 完成後 resolve', async () => {
            const writeFn = vi.fn(async () => {
                await new Promise<void>((resolve) => setTimeout(resolve, 10));
            });

            await queue.enqueue('key1', writeFn);

            expect(writeFn).toHaveBeenCalledTimes(1);
        });

        it('writeFn 失敗後仍 resolve（不 reject）', async () => {
            const writeFn = vi.fn(async () => {
                throw new Error('寫入失敗');
            });

            await expect(queue.enqueue('key2', writeFn)).resolves.toBeUndefined();
            expect(writeFn).toHaveBeenCalledTimes(1);
        });

        it('連續 enqueue 同一個 key 依序執行', async () => {
            const order: number[] = [];

            const first = queue.enqueue('key3', async () => {
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
                order.push(1);
            });

            const second = queue.enqueue('key3', async () => {
                order.push(2);
            });

            await Promise.all([first, second]);

            expect(order).toEqual([1, 2]);
        });
    });

    describe('flush', () => {
        it('key 不存在時應立即 resolve', async () => {
            await queue.flush('不存在的key');
        });

        it('enqueue 進行中時應等待完成才 resolve', async () => {
            let writeDone = false;
            queue.enqueue('key', async () => {
                await new Promise(r => setTimeout(r, 50));
                writeDone = true;
            });
            await queue.flush('key');
            expect(writeDone).toBe(true);
        });

        it('enqueue 完成後再 flush 應立即 resolve', async () => {
            await queue.enqueue('key', async () => {});
            await queue.flush('key');
        });
    });

    describe('delete', () => {
        it('delete 後 flush 應立即 resolve', async () => {
            queue.enqueue('key', async () => {
                await new Promise(r => setTimeout(r, 100));
            });
            queue.delete('key');
            await queue.flush('key');
        });

        it('delete 後再 enqueue 同一個 key 應從新的 chain 開始', async () => {
            const order: number[] = [];
            void queue.enqueue('key', async () => { order.push(1); });
            queue.delete('key');
            await queue.enqueue('key', async () => { order.push(2); });
            expect(order).toContain(2);
        });
    });

    describe('並行隔離', () => {
        it('不同 key 的任務應互相獨立不阻塞', async () => {
            const order: string[] = [];

            void queue.enqueue('key1', async () => {
                await new Promise(r => setTimeout(r, 50));
                order.push('key1');
            });

            // key2 不應等待 key1
            await queue.enqueue('key2', async () => {
                order.push('key2');
            });

            // key2 應先完成（因為 key1 有 50ms 延遲）
            expect(order[0]).toBe('key2');
        });
    });
});
