import type { Mock } from 'vitest';

vi.mock('../../src/services/socketService.js', () => ({
  socketService: {
    emitToConnection: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createResourceHandlers } from '../../src/handlers/factories/createResourceHandlers.js';
import { socketService } from '../../src/services/socketService.js';

function asMock(fn: unknown): Mock<any> {
  return fn as Mock<any>;
}

function makeService(overrides: Partial<{
  list: () => Promise<unknown[]>;
  exists: (id: string) => Promise<boolean>;
  create: (name: string, content: string) => Promise<{ id: string; name: string }>;
  update: (id: string, content: string) => Promise<{ id: string; name: string }>;
  getContent: (id: string) => Promise<string | null>;
  delete: (id: string) => Promise<void>;
}> = {}) {
  return {
    list: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({ id: 'cmd-1', name: 'test' }),
    update: vi.fn().mockResolvedValue({ id: 'cmd-1', name: 'test' }),
    getContent: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeHandlers(getContentImpl: () => Promise<string | null>) {
  return createResourceHandlers({
    service: makeService({ getContent: vi.fn().mockImplementation(getContentImpl) }),
    events: {
      listResult: 'command:list:result' as any,
      created: 'command:created' as any,
      updated: 'command:updated' as any,
      readResult: 'command:read:result' as any,
    },
    resourceName: 'Command' as any,
    responseKey: 'command',
    listResponseKey: 'commands',
    idField: 'commandId',
  });
}

describe('createResourceHandlers — handleRead', () => {
  const connectionId = 'conn-1';
  const requestId = 'req-1';
  const commandId = 'cmd-1';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('正常內容：emitToConnection 收到包含 content 的成功 response', async () => {
    const { handleRead } = makeHandlers(() => Promise.resolve('some content'));

    await handleRead(connectionId, { commandId }, requestId);

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      connectionId,
      'command:read:result',
      expect.objectContaining({
        success: true,
        command: expect.objectContaining({ content: 'some content' }),
      }),
    );
  });

  it('空字串內容：emitToConnection 收到包含 content 為空字串的成功 response（非 not found）', async () => {
    const { handleRead } = makeHandlers(() => Promise.resolve(''));

    await handleRead(connectionId, { commandId }, requestId);

    const call = asMock(socketService.emitToConnection).mock.calls[0];
    expect(call[2]).toHaveProperty('success', true);
    expect(call[2]).toHaveProperty('command');
    expect((call[2] as any).command).toHaveProperty('content', '');
    expect(call[2]).not.toHaveProperty('code', 'NOT_FOUND');
  });

  it('content 為 null 時：emitToConnection 收到 NOT_FOUND 錯誤', async () => {
    const { handleRead } = makeHandlers(() => Promise.resolve(null));

    await handleRead(connectionId, { commandId }, requestId);

    expect(socketService.emitToConnection).toHaveBeenCalledWith(
      connectionId,
      'command:read:result',
      expect.objectContaining({
        success: false,
        code: 'NOT_FOUND',
      }),
    );
  });
});
