import { sanitizePathSegment } from '../../src/utils/pathValidator.js';

describe('路徑驗證工具', () => {
  describe('sanitizePathSegment', () => {
    it('回傳有效的路徑名稱', () => {
      expect(sanitizePathSegment('valid-name')).toBe('valid-name');
      expect(sanitizePathSegment('test123')).toBe('test123');
    });

    it('使用basename萃取檔名，path/to/file 應萃取出 file', () => {
      expect(sanitizePathSegment('path/to/file')).toBe('file');
    });

    it('空字串應拋出錯誤', () => {
      expect(() => sanitizePathSegment('')).toThrow('名稱格式不正確，只能包含英文、數字、dash');
    });

    it('拋出錯誤當路徑包含不允許的字元', () => {
      expect(() => sanitizePathSegment('test@group')).toThrow('名稱格式不正確，只能包含英文、數字、dash');
      expect(() => sanitizePathSegment('test group')).toThrow('名稱格式不正確，只能包含英文、數字、dash');
      expect(() => sanitizePathSegment('test_group')).toThrow('名稱格式不正確，只能包含英文、數字、dash');
    });

    it('拋出錯誤當路徑包含遍歷字元', () => {
      expect(() => sanitizePathSegment('..')).toThrow('名稱格式不正確，只能包含英文、數字、dash');
      expect(() => sanitizePathSegment('.')).toThrow('名稱格式不正確，只能包含英文、數字、dash');
    });

    it('拋出錯誤當路徑超過100字元', () => {
      const longName = 'a'.repeat(101);
      expect(() => sanitizePathSegment(longName)).toThrow('名稱格式不正確，只能包含英文、數字、dash');
    });
  });
});
