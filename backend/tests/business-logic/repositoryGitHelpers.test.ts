import { describe, it, expect } from 'vitest';
import { parseRepoName, parseUrlRepoName } from '../../src/handlers/repositoryGitHelpers.js';

describe('parseRepoName', () => {
  describe('HTTPS URL 解析', () => {
    it('標準 HTTPS URL 應解析出正確的 repo name', () => {
      expect(parseRepoName('https://github.com/user/my-repo')).toBe('my-repo');
    });

    it('帶 .git suffix 的 HTTPS URL 應正確移除 suffix', () => {
      expect(parseRepoName('https://github.com/user/my-repo.git')).toBe('my-repo');
    });

    it('多層路徑 HTTPS URL 應取最後一段', () => {
      expect(parseRepoName('https://github.com/org/subgroup/my-project.git')).toBe('my-project');
    });

    it('HTTP URL 應解析出正確的 repo name', () => {
      expect(parseRepoName('http://github.com/user/my-repo')).toBe('my-repo');
    });

    it('git:// 協議 URL 應解析出正確的 repo name', () => {
      expect(parseRepoName('git://github.com/user/my-repo.git')).toBe('my-repo');
    });
  });

  describe('SSH URL 解析', () => {
    it('標準 SSH URL 應解析出正確的 repo name', () => {
      expect(parseRepoName('git@github.com:user/my-repo')).toBe('user-my-repo');
    });

    it('帶 .git suffix 的 SSH URL 應正確移除 suffix', () => {
      expect(parseRepoName('git@github.com:user/my-repo.git')).toBe('user-my-repo');
    });

    it('SSH URL 路徑中的特殊字元應被替換為 dash', () => {
      expect(parseRepoName('git@github.com:my-org/my-repo.git')).toBe('my-org-my-repo');
    });
  });
});

describe('parseUrlRepoName', () => {
  it('標準 HTTPS URL 應解析出正確的 repo name', () => {
    expect(parseUrlRepoName('https://github.com/user/my-repo')).toBe('my-repo');
  });

  it('帶 .git suffix 應正確移除', () => {
    expect(parseUrlRepoName('https://github.com/user/my-repo.git')).toBe('my-repo');
  });

  it('包含底線的 repo name 應保留底線（底線屬於 \\w 字元）', () => {
    expect(parseUrlRepoName('https://github.com/user/my_repo')).toBe('my_repo');
  });

  it('包含空白的 repo name 應被轉換為 dash', () => {
    expect(parseUrlRepoName('https://github.com/user/my%20repo')).toBe('my-20repo');
  });
});

describe('sanitizeRepoNameChars（透過 parseRepoName 間接測試）', () => {
  it('底線屬於 \\w 字元，應保留不轉換', () => {
    expect(parseRepoName('https://github.com/user/my_repo')).toBe('my_repo');
  });

  it('特殊字元（@）應被替換為 dash', () => {
    expect(parseRepoName('https://github.com/user/my@repo')).toBe('my-repo');
  });

  it('允許的字元（英文、數字、dash、點）應保留', () => {
    expect(parseRepoName('https://github.com/user/my-repo.v2')).toBe('my-repo.v2');
  });

  it('開頭為非英數字元時應移除開頭的非法字元', () => {
    expect(parseRepoName('https://github.com/user/-myrepo')).toBe('myrepo');
  });

  it('.git suffix 應被移除再做字元替換', () => {
    expect(parseRepoName('https://github.com/user/my-project.git')).toBe('my-project');
  });
});

describe('ensureNonEmptyRepoName（透過 parseRepoName 間接測試）', () => {
  it('解析出空字串時應回傳 unnamed-repo', () => {
    expect(parseRepoName('https://github.com/')).toBe('unnamed-repo');
  });

  it('只有特殊字元的 repo name 最終為空時應回傳 unnamed-repo', () => {
    expect(parseUrlRepoName('https://github.com/user/@@@')).toBe('unnamed-repo');
  });

  it('正常 repo name 不應受影響', () => {
    expect(parseRepoName('https://github.com/user/valid-repo')).toBe('valid-repo');
  });
});
