import type { Mock } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('../../src/services/integration/integrationAppStore.js', () => ({
  integrationAppStore: {
    getByProviderAndName: vi.fn(() => undefined),
    getByProviderAndConfigField: vi.fn(() => undefined),
    getById: vi.fn(() => undefined),
    list: vi.fn(() => []),
    updateStatus: vi.fn(),
    updateResources: vi.fn(),
    updateExtraJson: vi.fn(),
  },
}));

vi.mock('../../src/services/integration/integrationEventPipeline.js', () => ({
  integrationEventPipeline: {
    processEvent: vi.fn(() => Promise.resolve()),
    safeProcessEvent: vi.fn(),
  },
}));

vi.mock('../../src/services/socketService.js', () => ({
  socketService: {
    emitToAll: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { jiraProvider } from '../../src/services/integration/providers/jiraProvider.js';
import { integrationAppStore } from '../../src/services/integration/integrationAppStore.js';
import type { IntegrationApp } from '../../src/services/integration/types.js';

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

function makeApp(overrides: Partial<IntegrationApp> = {}): IntegrationApp {
  return {
    id: 'app-jira-1',
    name: 'my-jira',
    provider: 'jira',
    config: {
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret-123',
    },
    connectionStatus: 'disconnected',
    resources: [],
    ...overrides,
  };
}

function buildSignedRequest(body: object, secret: string, appName: string, overrideSignature?: string): Request {
  const rawBody = JSON.stringify(body);
  const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  const signature = overrideSignature ?? `sha256=${hmac}`;

  return new Request(`http://localhost/jira/events/${appName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': signature,
    },
    body: rawBody,
  });
}

const validPayload = {
  webhookEvent: 'jira:issue_created',
  timestamp: Date.now(),
  issue: { key: 'PROJ-1', fields: { summary: 'Test Issue' } },
  user: { displayName: 'John', emailAddress: 'john@example.com' },
};

describe('JiraProvider - 基本屬性', () => {
  it('name 應為 jira', () => {
    expect(jiraProvider.name).toBe('jira');
  });

  it('webhookPath 應為 /jira/events', () => {
    expect(jiraProvider.webhookPath).toBe('/jira/events');
  });

  it('webhookPathMatchMode 應為 prefix', () => {
    expect(jiraProvider.webhookPathMatchMode).toBe('prefix');
  });

  it('allowManualResourceId 應為 true', () => {
    expect(jiraProvider.allowManualResourceId).toBe(true);
  });
});

describe('JiraProvider - createAppSchema', () => {
  it('應接受公開 https siteUrl + webhookSecret', () => {
    const result = jiraProvider.createAppSchema.safeParse({
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(true);
  });

  it('應拒絕 http siteUrl', () => {
    const result = jiraProvider.createAppSchema.safeParse({
      siteUrl: 'http://mysite.atlassian.net',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(false);
  });

  it('應拒絕缺少 webhookSecret', () => {
    const result = jiraProvider.createAppSchema.safeParse({
      siteUrl: 'https://mysite.atlassian.net',
    });
    expect(result.success).toBe(false);
  });

  it('應拒絕空的 webhookSecret', () => {
    const result = jiraProvider.createAppSchema.safeParse({
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: '',
    });
    expect(result.success).toBe(false);
  });

  it('應移除 siteUrl 尾部斜線', () => {
    const result = jiraProvider.createAppSchema.safeParse({
      siteUrl: 'https://mysite.atlassian.net/',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteUrl).toBe('https://mysite.atlassian.net');
    }
  });
});

describe('JiraProvider - validateCreate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('正常的 config 應通過驗證', () => {
    const result = jiraProvider.validateCreate({
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(true);
  });

  it('name 含非法字元應回傳錯誤', () => {
    const result = jiraProvider.validateCreate({
      name: 'invalid name!',
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(false);
  });

  it('name 超過 50 字元應回傳錯誤', () => {
    const result = jiraProvider.validateCreate({
      name: 'a'.repeat(51),
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(false);
  });

  it('合法的 name 格式應通過驗證', () => {
    const result = jiraProvider.validateCreate({
      name: 'my-jira_app123',
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret',
    });
    expect(result.success).toBe(true);
  });
});

describe('JiraProvider - sanitizeConfig', () => {
  it('應只保留 siteUrl，隱藏 webhookSecret', () => {
    const config = {
      siteUrl: 'https://mysite.atlassian.net',
      webhookSecret: 'secret',
    };

    const result = jiraProvider.sanitizeConfig(config);
    expect(result.siteUrl).toBe('https://mysite.atlassian.net');
    expect(result.webhookSecret).toBeUndefined();
  });
});

describe('JiraProvider - initialize', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('應直接設定狀態為 connected', async () => {
    const app = makeApp();
    await jiraProvider.initialize(app);
    expect(asMock(integrationAppStore.updateStatus)).toHaveBeenCalledWith(app.id, 'connected');
  });
});

describe('JiraProvider - handleWebhookRequest 基本驗證', () => {
  const secret = 'my-webhook-secret';
  const appName = 'my-jira';

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(
      makeApp({ config: { siteUrl: 'https://mysite.atlassian.net', webhookSecret: secret } })
    );
  });

  it('缺少 subPath 應回傳 404', async () => {
    const req = new Request('http://localhost/jira/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await jiraProvider.handleWebhookRequest(req);
    expect(res.status).toBe(404);
  });

  it('找不到 App 應回傳 404', async () => {
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(undefined);

    const req = buildSignedRequest(validPayload, secret, appName);
    const res = await jiraProvider.handleWebhookRequest(req, 'nonexistent-app');
    expect(res.status).toBe(404);
  });

  it('缺少 X-Hub-Signature header 應回傳 403', async () => {
    const req = new Request(`http://localhost/jira/events/${appName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await jiraProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(403);
  });

  it('簽章驗證失敗應回傳 403', async () => {
    const req = buildSignedRequest(validPayload, secret, appName, 'sha256=invalidsignature');
    const res = await jiraProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(403);
  });

  it('有效請求應回傳 200', async () => {
    const req = buildSignedRequest(validPayload, secret, appName);
    const res = await jiraProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(200);
  });

  it('無效的 JSON body 應回傳 400', async () => {
    const rawBody = 'not-json';
    const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');

    const req = new Request(`http://localhost/jira/events/${appName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha256=${hmac}`,
      },
      body: rawBody,
    });

    const res = await jiraProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(400);
  });
});

describe('JiraProvider - handleWebhookRequest Body 大小限制', () => {
  const secret = 'my-webhook-secret';
  const appName = 'my-jira';

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(
      makeApp({ config: { siteUrl: 'https://mysite.atlassian.net', webhookSecret: secret } })
    );
  });

  it('Content-Length header 超過限制回傳 413', async () => {
    const req = new Request(`http://localhost/jira/events/${appName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': 'sha256=somesig',
        'content-length': '2000000',
      },
      body: '{}',
    });

    const res = await jiraProvider.handleWebhookRequest(req, appName);
    expect(res.status).toBe(413);
  });
});

describe('JiraProvider - handleWebhookRequest 重複簽章防護', () => {
  const secret = 'my-webhook-secret';
  const appName = 'my-jira';

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(
      makeApp({ config: { siteUrl: 'https://mysite.atlassian.net', webhookSecret: secret } })
    );
  });

  it('相同簽章的請求第二次應被略過（dedup），回傳 200', async () => {
    const { integrationEventPipeline } = await import('../../src/services/integration/integrationEventPipeline.js');
    const body = {
      webhookEvent: 'jira:issue_created',
      timestamp: Date.now(),
      issue: { key: 'DEDUP-1', fields: { summary: 'Test' } },
      user: { displayName: 'Alice' },
    };

    const rawBody = JSON.stringify(body);
    const { createHmac: createHmacFn } = await import('crypto');
    const hmac = createHmacFn('sha256', secret).update(rawBody).digest('hex');
    const signature = `sha256=${hmac}`;

    const makeReq = () =>
      new Request(`http://localhost/jira/events/${appName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': signature,
        },
        body: rawBody,
      });

    await jiraProvider.handleWebhookRequest(makeReq(), appName);
    asMock(integrationEventPipeline.safeProcessEvent).mockClear();

    const res2 = await jiraProvider.handleWebhookRequest(makeReq(), appName);
    expect(res2.status).toBe(200);
    expect(asMock(integrationEventPipeline.safeProcessEvent)).not.toHaveBeenCalled();
  });
});

describe('JiraProvider - handleWebhookRequest safeProcessEvent 呼叫驗證', () => {
  const secret = 'my-webhook-secret';
  const appName = 'my-jira';

  beforeEach(() => {
    vi.resetAllMocks();
    asMock(integrationAppStore.getByProviderAndName).mockReturnValue(
      makeApp({ config: { siteUrl: 'https://mysite.atlassian.net', webhookSecret: secret } })
    );
  });

  it('有效的 jira:issue_created 事件應呼叫 safeProcessEvent，且 resourceId 為 * 且 providerName 為 jira', async () => {
    const { integrationEventPipeline } = await import('../../src/services/integration/integrationEventPipeline.js');
    const body = {
      webhookEvent: 'jira:issue_created',
      timestamp: 1700000001,
      issue: { key: 'PROJ-10', fields: { summary: 'Valid Issue' } },
      user: { displayName: 'Tester' },
    };

    const req = buildSignedRequest(body, secret, appName);
    const res = await jiraProvider.handleWebhookRequest(req, appName);

    expect(res.status).toBe(200);
    expect(asMock(integrationEventPipeline.safeProcessEvent)).toHaveBeenCalledOnce();

    const [providerName, , normalizedEvent] = asMock(integrationEventPipeline.safeProcessEvent).mock.calls[0];
    expect(providerName).toBe('jira');
    expect(normalizedEvent.resourceId).toBe('*');
  });

  it('不支援的事件類型 jira:sprint_started 應回傳 200 且 safeProcessEvent 不被呼叫', async () => {
    const { integrationEventPipeline } = await import('../../src/services/integration/integrationEventPipeline.js');
    const body = {
      webhookEvent: 'jira:sprint_started',
      timestamp: 1700000002,
      issue: { key: 'PROJ-11', fields: { summary: 'Sprint Issue' } },
      user: { displayName: 'Tester' },
    };

    const req = buildSignedRequest(body, secret, appName);
    const res = await jiraProvider.handleWebhookRequest(req, appName);

    expect(res.status).toBe(200);
    expect(asMock(integrationEventPipeline.safeProcessEvent)).not.toHaveBeenCalled();
  });
});

describe('JiraProvider - formatEventMessage', () => {
  it('jira:issue_created 應產生正確格式的訊息，resourceId 固定為 *', () => {
    const app = makeApp();
    const event = {
      webhookEvent: 'jira:issue_created',
      timestamp: Date.now(),
      issue: { key: 'PROJ-1', fields: { summary: 'New bug' } },
      user: { displayName: 'Alice' },
    };

    const result = jiraProvider.formatEventMessage(event, app);
    expect(result).not.toBeNull();
    expect(result?.text).toContain('[Jira: Alice]');
    expect(result?.text).toContain('建立了 Issue');
    expect(result?.resourceId).toBe('*');
  });

  it('jira:issue_updated 應產生正確格式的訊息', () => {
    const app = makeApp();
    const event = {
      webhookEvent: 'jira:issue_updated',
      timestamp: Date.now(),
      issue: { key: 'PROJ-2', fields: { summary: 'Updated issue' } },
      user: { displayName: 'Bob' },
      changelog: { items: [{ field: 'status', fromString: 'Open', toString: 'Closed' }] },
    };

    const result = jiraProvider.formatEventMessage(event, app);
    expect(result).not.toBeNull();
    expect(result?.text).toContain('更新了 Issue');
    expect(result?.text).toContain('status: Open → Closed');
    expect(result?.resourceId).toBe('*');
  });

  it('jira:issue_deleted 應產生正確格式的訊息', () => {
    const app = makeApp();
    const event = {
      webhookEvent: 'jira:issue_deleted',
      timestamp: Date.now(),
      issue: { key: 'PROJ-3', fields: { summary: 'Deleted issue' } },
      user: { emailAddress: 'carol@example.com' },
    };

    const result = jiraProvider.formatEventMessage(event, app);
    expect(result).not.toBeNull();
    expect(result?.text).toContain('刪除了 Issue');
    expect(result?.resourceId).toBe('*');
  });

  it('payload 格式不合法時應回傳 null', () => {
    const app = makeApp();
    const result = jiraProvider.formatEventMessage({ invalid: true }, app);
    expect(result).toBeNull();
  });
});
