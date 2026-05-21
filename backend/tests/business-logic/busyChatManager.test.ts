import {shouldSendBusyReply, BUSY_REPLY_COOLDOWN_MS} from '../../src/utils/busyChatManager.js';

describe('shouldSendBusyReply', () => {
    it('第一次呼叫應回傳 true 並記錄時間', () => {
        const map = new Map<string, number>();
        expect(shouldSendBusyReply(map, 'key1')).toBe(true);
        expect(map.has('key1')).toBe(true);
    });

    it('冷卻時間內再次呼叫應回傳 false', () => {
        const map = new Map<string, number>();
        shouldSendBusyReply(map, 'key1');
        expect(shouldSendBusyReply(map, 'key1')).toBe(false);
    });

    it('冷卻時間過後應回傳 true', () => {
        const map = new Map<string, number>();
        map.set('key1', Date.now() - BUSY_REPLY_COOLDOWN_MS - 1);
        expect(shouldSendBusyReply(map, 'key1')).toBe(true);
    });

    it('不同 key 各自獨立計算冷卻', () => {
        const map = new Map<string, number>();
        shouldSendBusyReply(map, 'key1');
        expect(shouldSendBusyReply(map, 'key2')).toBe(true);
    });
});
