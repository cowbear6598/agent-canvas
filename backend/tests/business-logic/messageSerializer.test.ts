import { serialize, deserialize, tryDeserialize } from '../../src/utils/messageSerializer.js';
import type { WebSocketMessage } from '../../src/types/websocket.js';

describe('messageSerializer', () => {
	describe('serialize', () => {
		it('應將 WebSocketMessage 序列化為 JSON 字串', () => {
			const message: WebSocketMessage = {
				type: 'test:event',
				requestId: 'req-1',
				payload: { data: '測試' },
			};
			const result = serialize(message);
			expect(result).toBe(JSON.stringify(message));
		});
	});

	describe('deserialize', () => {
		describe('合法輸入', () => {
			it('合法 JSON 字串輸入應回傳正確 WebSocketMessage', () => {
				const input = '{"type":"test:event","requestId":"req-1","payload":{"data":"測試"}}';
				const result = deserialize(input);
				expect(result).toEqual({
					type: 'test:event',
					requestId: 'req-1',
					payload: { data: '測試' },
					ackId: undefined,
				});
			});

			it('Buffer 輸入應正確轉換後解析', () => {
				const json = '{"type":"canvas:connect","requestId":"req-2","payload":null}';
				const buffer = Buffer.from(json, 'utf-8');
				const result = deserialize(buffer);
				expect(result.type).toBe('canvas:connect');
				expect(result.requestId).toBe('req-2');
				expect(result.payload).toBeNull();
			});

			it('requestId 缺少時應補上預設空字串', () => {
				const input = '{"type":"test:event"}';
				const result = deserialize(input);
				expect(result.requestId).toBe('');
			});

			it('ackId 存在時應正確傳遞', () => {
				const input = '{"type":"test:event","requestId":"req-1","ackId":"ack-123"}';
				const result = deserialize(input);
				expect(result.ackId).toBe('ack-123');
			});

			it('ackId 不存在時應為 undefined', () => {
				const input = '{"type":"test:event","requestId":"req-1"}';
				const result = deserialize(input);
				expect(result.ackId).toBeUndefined();
			});
		});

		describe('不合法輸入', () => {
			it('不合法 JSON 字串應 throw 無效的 JSON 格式', () => {
				expect(() => deserialize('不合法的JSON')).toThrow('無效的 JSON 格式');
			});

			it('空字串應 throw 無效的 JSON 格式', () => {
				expect(() => deserialize('')).toThrow('無效的 JSON 格式');
			});

			it('JSON 是原始型別（數字）應 throw 訊息必須是 JSON 物件', () => {
				expect(() => deserialize('42')).toThrow('訊息必須是 JSON 物件');
			});

			it('JSON 是原始型別（字串）應 throw 訊息必須是 JSON 物件', () => {
				expect(() => deserialize('"hello"')).toThrow('訊息必須是 JSON 物件');
			});

			it('JSON 是原始型別（boolean）應 throw 訊息必須是 JSON 物件', () => {
				expect(() => deserialize('true')).toThrow('訊息必須是 JSON 物件');
			});

			it('缺少 type 欄位應 throw 訊息缺少必要欄位: type', () => {
				const input = '{"requestId":"req-1","payload":null}';
				expect(() => deserialize(input)).toThrow('訊息缺少必要欄位: type');
			});

			it('type 為非字串型別應 throw 訊息缺少必要欄位: type', () => {
				const input = '{"type":123,"requestId":"req-1"}';
				expect(() => deserialize(input)).toThrow('訊息缺少必要欄位: type');
			});

			it('type 為 null 應 throw 訊息缺少必要欄位: type', () => {
				const input = '{"type":null,"requestId":"req-1"}';
				expect(() => deserialize(input)).toThrow('訊息缺少必要欄位: type');
			});
		});
	});

	describe('tryDeserialize', () => {
		it('合法輸入時應回傳 success result', () => {
			const message = serialize({ type: 'test', requestId: '', payload: { foo: 'bar' } });
			const result = tryDeserialize(message);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe('test');
			}
		});

		it('不合法 JSON 輸入時應回傳 error result', () => {
			const result = tryDeserialize('not json');
			expect(result.success).toBe(false);
		});

		it('缺少 type 欄位時應回傳 error result', () => {
			const result = tryDeserialize(JSON.stringify({ data: {} }));
			expect(result.success).toBe(false);
		});
	});
});
