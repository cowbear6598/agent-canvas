import { safeExecute, safeExecuteAsync } from '../../src/utils/operationHelpers.js';

describe('safeExecute', () => {
	it('操作成功時應回傳 ok result', () => {
		const result = safeExecute(() => 42);
		expect(result).toEqual({ success: true, data: 42 });
	});

	it('操作拋出 Error 時應回傳 err result', () => {
		const result = safeExecute(() => { throw new Error('測試錯誤'); });
		expect(result).toEqual({ success: false, error: '測試錯誤' });
	});

	it('操作拋出非 Error 物件時應回傳字串化的 err result', () => {
		const result = safeExecute(() => { throw '字串錯誤'; });
		expect(result).toEqual({ success: false, error: '字串錯誤' });
	});
});

describe('safeExecuteAsync', () => {
	it('非同步操作成功時應回傳 ok result', async () => {
		const result = await safeExecuteAsync(async () => 42);
		expect(result).toEqual({ success: true, data: 42 });
	});

	it('非同步操作拋出 Error 時應回傳 err result', async () => {
		const result = await safeExecuteAsync(async () => { throw new Error('非同步錯誤'); });
		expect(result).toEqual({ success: false, error: '非同步錯誤' });
	});

	it('非同步操作拋出非 Error 物件時應回傳字串化的 err result', async () => {
		const result = await safeExecuteAsync(async () => { throw '字串錯誤'; });
		expect(result).toEqual({ success: false, error: '字串錯誤' });
	});
});
