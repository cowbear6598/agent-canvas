import { vi } from 'vitest';
import {
  detectGitSource,
  buildAuthenticatedUrl,
  parseCloneErrorMessage,
  extractDomainFromUrl,
  getPullLatestError,
  gitService,
} from '../../src/services/workspace/gitService';
import { ok, err } from '../../src/types';
import { config } from '../../src/config';
import path from 'path';

describe('GitService - Git 來源偵測與認證', () => {
  describe('extractDomainFromUrl', () => {
    it('從 HTTPS URL 提取域名', () => {
      expect(extractDomainFromUrl('https://github.com/user/repo.git')).toBe('github.com');
      expect(extractDomainFromUrl('https://gitlab.com/user/repo.git')).toBe('gitlab.com');
      expect(extractDomainFromUrl('https://gitlab.example.com/user/repo.git')).toBe('gitlab.example.com');
    });

    it('從 HTTP URL 提取域名', () => {
      expect(extractDomainFromUrl('http://github.com/user/repo.git')).toBe('github.com');
    });

    it('從 SSH URL 提取域名', () => {
      expect(extractDomainFromUrl('git@github.com:user/repo.git')).toBe('github.com');
      expect(extractDomainFromUrl('git@gitlab.com:user/repo.git')).toBe('gitlab.com');
      expect(extractDomainFromUrl('git@gitlab.example.com:user/repo.git')).toBe('gitlab.example.com');
    });

    it('無法解析的 URL 返回空字串', () => {
      expect(extractDomainFromUrl('invalid-url')).toBe('');
      expect(extractDomainFromUrl('')).toBe('');
    });
  });

  describe('detectGitSource', () => {
    it('偵測 GitHub HTTPS URL', () => {
      expect(detectGitSource('https://github.com/user/repo.git')).toBe('github');
    });

    it('偵測 GitHub SSH URL', () => {
      expect(detectGitSource('git@github.com:user/repo.git')).toBe('github');
    });

    it('偵測 GitLab.com HTTPS URL', () => {
      expect(detectGitSource('https://gitlab.com/user/repo.git')).toBe('gitlab');
    });

    it('偵測 GitLab.com SSH URL', () => {
      expect(detectGitSource('git@gitlab.com:user/repo.git')).toBe('gitlab');
    });

    it('偵測 Self-hosted GitLab URL', () => {
      if (config.gitlabUrl) {
        const url = `${config.gitlabUrl}/user/repo.git`;
        expect(detectGitSource(url)).toBe('gitlab');
      }
    });

    it('偵測其他 Git 服務', () => {
      expect(detectGitSource('https://bitbucket.org/user/repo.git')).toBe('other');
      expect(detectGitSource('https://example.com/user/repo.git')).toBe('other');
    });
  });

  describe('buildAuthenticatedUrl', () => {
    it('GitHub Token 注入格式正確', () => {
      if (!config.githubToken) {
        return;
      }

      const url = 'https://github.com/user/repo.git';
      const result = buildAuthenticatedUrl(url);

      expect(result).toContain(config.githubToken);
      expect(result).toContain('@github.com');
      expect(result).toMatch(/^https:\/\/.*@github\.com\//);
    });

    it('GitLab.com Token 注入格式正確', () => {
      if (!config.gitlabToken) {
        return;
      }

      const url = 'https://gitlab.com/user/repo.git';
      const result = buildAuthenticatedUrl(url);

      expect(result).toContain('oauth2');
      expect(result).toContain(config.gitlabToken);
      expect(result).toContain('@gitlab.com');
      expect(result).toMatch(/^https:\/\/oauth2:.*@gitlab\.com\//);
    });

    it('Self-hosted GitLab Token 注入格式正確', () => {
      if (!config.gitlabToken || !config.gitlabUrl) {
        return;
      }

      const url = `${config.gitlabUrl}/user/repo.git`;
      const result = buildAuthenticatedUrl(url);

      expect(result).toContain('oauth2');
      expect(result).toContain(config.gitlabToken);
    });

    it('無 Token 時返回原始 URL', () => {
      const url = 'https://bitbucket.org/user/repo.git';
      const result = buildAuthenticatedUrl(url);

      expect(result).toBe(url);
    });

    it('非 HTTPS 格式返回原始 URL', () => {
      const sshUrl = 'git@github.com:user/repo.git';
      const result = buildAuthenticatedUrl(sshUrl);

      expect(result).toBe(sshUrl);
    });
  });

  describe('parseCloneErrorMessage', () => {
    it('認證失敗錯誤訊息', () => {
      const error = new Error('Authentication failed');
      const result = parseCloneErrorMessage(error, 'github');

      expect(result).toBe('認證失敗，請檢查 Token 是否正確');
    });

    it('倉庫不存在錯誤訊息', () => {
      const error = new Error('Repository not found');
      const result = parseCloneErrorMessage(error, 'github');

      expect(result).toBe('找不到指定的倉庫');
    });

    it('無法讀取使用者名稱 - GitHub', () => {
      const error = new Error('could not read Username');
      const result = parseCloneErrorMessage(error, 'github');

      expect(result).toBe('無法存取私有倉庫，請設定 GITHUB_TOKEN');
    });

    it('無法讀取使用者名稱 - GitLab', () => {
      const error = new Error('could not read Username');
      const result = parseCloneErrorMessage(error, 'gitlab');

      expect(result).toBe('無法存取私有倉庫，請設定 GITLAB_TOKEN');
    });

    it('無法讀取使用者名稱 - 其他', () => {
      const error = new Error('could not read Username');
      const result = parseCloneErrorMessage(error, 'other');

      expect(result).toBe('無法存取私有倉庫，請設定對應的 Token');
    });

    it('通用錯誤訊息', () => {
      const error = new Error('Some other error');
      const result = parseCloneErrorMessage(error, 'github');

      expect(result).toBe('複製儲存庫失敗');
    });

    it('處理非 Error 物件', () => {
      const result = parseCloneErrorMessage('string error', 'github');

      expect(result).toBe('複製儲存庫失敗');
    });
  });

  describe('getPullLatestError', () => {
    it("包含 'Could not resolve host' 回傳無法連線訊息", () => {
      const result = getPullLatestError('Could not resolve host: github.com');

      expect(result).toBe('無法連線至遠端伺服器');
    });

    it("包含 'Network error' 回傳無法連線訊息", () => {
      const result = getPullLatestError('Network error occurred');

      expect(result).toBe('無法連線至遠端伺服器');
    });

    it("包含 \"couldn't find remote ref\" 回傳遠端分支不存在訊息", () => {
      const result = getPullLatestError("couldn't find remote ref main");

      expect(result).toBe('遠端分支不存在');
    });

    it('其他未知錯誤回傳預設失敗訊息', () => {
      const result = getPullLatestError('Some unknown git error');

      expect(result).toBe('Pull 至最新版本失敗');
    });
  });
});

describe('GitService - clone 路徑驗證', () => {
  it('targetPath 在允許範圍外時應回傳錯誤，不執行 git clone', async () => {
    const outsidePath = path.join('/tmp', 'outside-repo');
    const result = await gitService.clone('https://github.com/user/repo.git', outsidePath);

    expect(result.success).toBe(false);
    expect(result.error).toBe('目標路徑不在允許的範圍內');
  });
});

describe('GitService - fetchRemoteBranch 分支名驗證', () => {
  it('無效分支名稱（含路徑穿越）應回傳錯誤', async () => {
    const result = await gitService.fetchRemoteBranch('/fake/path', '../evil-branch');

    expect(result.success).toBe(false);
    expect(result.error).toBe('無效的分支名稱');
  });

  it('含特殊字元的無效分支名稱應回傳錯誤', async () => {
    const result = await gitService.fetchRemoteBranch('/fake/path', 'branch; rm -rf /');

    expect(result.success).toBe(false);
    expect(result.error).toBe('無效的分支名稱');
  });
});

describe('GitService - smartCheckoutBranch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('本地分支存在時直接 checkout，回傳 switched', async () => {
    vi.spyOn(gitService, 'branchExists').mockResolvedValue(ok(true));
    vi.spyOn(gitService, 'checkoutBranch').mockResolvedValue(ok(undefined));

    const progressCalls: Array<[number, string]> = [];
    const result = await gitService.smartCheckoutBranch('/fake/path', 'feature-branch', {
      onProgress: (progress, message) => progressCalls.push([progress, message]),
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('switched');
    expect(progressCalls).toContainEqual([10, '檢查本地分支...']);
    expect(progressCalls).toContainEqual([80, '切換分支...']);
    expect(gitService.checkoutBranch).toHaveBeenCalledWith('/fake/path', 'feature-branch', undefined);
  });

  it('本地不存在、遠端存在時 fetch 後 checkout，回傳 fetched', async () => {
    vi.spyOn(gitService, 'branchExists').mockResolvedValue(ok(false));
    vi.spyOn(gitService, 'checkRemoteBranchExists').mockResolvedValue(ok(true));
    vi.spyOn(gitService, 'fetchRemoteBranch').mockResolvedValue(ok(undefined));
    vi.spyOn(gitService, 'checkoutBranch').mockResolvedValue(ok(undefined));

    const progressCalls: Array<[number, string]> = [];
    const result = await gitService.smartCheckoutBranch('/fake/path', 'feature-branch', {
      onProgress: (progress, message) => progressCalls.push([progress, message]),
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('fetched');
    expect(progressCalls).toContainEqual([20, '檢查遠端分支...']);
    expect(progressCalls).toContainEqual([80, '切換分支...']);
    expect(gitService.fetchRemoteBranch).toHaveBeenCalledWith('/fake/path', 'feature-branch', expect.any(Function));
    expect(gitService.checkoutBranch).toHaveBeenCalledWith('/fake/path', 'feature-branch', undefined);
  });

  it('本地與遠端都不存在時建立新分支，回傳 created', async () => {
    vi.spyOn(gitService, 'branchExists').mockResolvedValue(ok(false));
    vi.spyOn(gitService, 'checkRemoteBranchExists').mockResolvedValue(ok(false));
    vi.spyOn(gitService, 'createAndCheckoutBranch').mockResolvedValue(ok(undefined));

    const progressCalls: Array<[number, string]> = [];
    const result = await gitService.smartCheckoutBranch('/fake/path', 'new-branch', {
      onProgress: (progress, message) => progressCalls.push([progress, message]),
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('created');
    expect(progressCalls).toContainEqual([80, '建立並切換分支...']);
    expect(gitService.createAndCheckoutBranch).toHaveBeenCalledWith('/fake/path', 'new-branch');
  });

  it('無效分支名稱回傳錯誤，不執行任何 git 操作', async () => {
    const branchExistsSpy = vi.spyOn(gitService, 'branchExists');

    const result = await gitService.smartCheckoutBranch('/fake/path', '../bad');

    expect(result.success).toBe(false);
    expect(result.error).toBe('無效的分支名稱格式');
    expect(branchExistsSpy).not.toHaveBeenCalled();
  });

  it('checkout 失敗時回傳對應錯誤', async () => {
    vi.spyOn(gitService, 'branchExists').mockResolvedValue(ok(true));
    vi.spyOn(gitService, 'checkoutBranch').mockResolvedValue(err('切換分支失敗'));

    const result = await gitService.smartCheckoutBranch('/fake/path', 'feature-branch');

    expect(result.success).toBe(false);
    expect(result.error).toBe('切換分支失敗');
  });

  it('branchExists 失敗時提早回傳錯誤', async () => {
    vi.spyOn(gitService, 'branchExists').mockResolvedValue(err('檢查分支失敗'));
    const checkRemoteSpy = vi.spyOn(gitService, 'checkRemoteBranchExists');

    const result = await gitService.smartCheckoutBranch('/fake/path', 'feature-branch');

    expect(result.success).toBe(false);
    expect(result.error).toBe('檢查分支失敗');
    expect(checkRemoteSpy).not.toHaveBeenCalled();
  });

  it('fetchRemoteBranch 失敗時回傳對應錯誤', async () => {
    vi.spyOn(gitService, 'branchExists').mockResolvedValue(ok(false));
    vi.spyOn(gitService, 'checkRemoteBranchExists').mockResolvedValue(ok(true));
    vi.spyOn(gitService, 'fetchRemoteBranch').mockResolvedValue(err('從遠端 fetch 分支失敗'));

    const result = await gitService.smartCheckoutBranch('/fake/path', 'feature-branch');

    expect(result.success).toBe(false);
    expect(result.error).toBe('從遠端 fetch 分支失敗');
  });
});
