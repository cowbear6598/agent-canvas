import { AbortError } from '@anthropic-ai/claude-agent-sdk';
import { getErrorMessage, isAbortError } from '../../src/utils/errorHelpers.js';

describe('錯誤處理工具', () => {
	describe('isAbortError', () => {
		it('傳入 AbortError 實例回傳 true', () => {
			const error = new AbortError('操作已中止');
			expect(isAbortError(error)).toBe(true);
		});

		it('傳入 name 為 AbortError 的一般 Error 回傳 true', () => {
			const error = new Error('操作已中止');
			error.name = 'AbortError';
			expect(isAbortError(error)).toBe(true);
		});

		it('傳入一般 Error 回傳 false', () => {
			const error = new Error('一般錯誤');
			expect(isAbortError(error)).toBe(false);
		});

		it('傳入 null 回傳 false', () => {
			expect(isAbortError(null)).toBe(false);
		});

		it('傳入 undefined 回傳 false', () => {
			expect(isAbortError(undefined)).toBe(false);
		});

		it('傳入字串回傳 false', () => {
			expect(isAbortError('錯誤訊息')).toBe(false);
		});
	});

	describe('getErrorMessage', () => {
		it('傳入 Error 實例回傳 message', () => {
			const error = new Error('這是錯誤訊息');
			expect(getErrorMessage(error)).toBe('這是錯誤訊息');
		});

		it('傳入字串直接回傳', () => {
			expect(getErrorMessage('錯誤訊息字串')).toBe('錯誤訊息字串');
		});

		it('傳入數字回傳預設訊息', () => {
			expect(getErrorMessage(123)).toBe('發生未知錯誤');
		});

		it('傳入物件回傳預設訊息', () => {
			expect(getErrorMessage({ error: '錯誤' })).toBe('發生未知錯誤');
		});

		it('傳入 null 回傳預設訊息', () => {
			expect(getErrorMessage(null)).toBe('發生未知錯誤');
		});

		it('傳入 undefined 回傳預設訊息', () => {
			expect(getErrorMessage(undefined)).toBe('發生未知錯誤');
		});
	});
});
