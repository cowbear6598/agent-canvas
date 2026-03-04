import { mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chatPersistenceService } from '../../src/services/persistence/chatPersistence';
import { persistenceService } from '../../src/services/persistence';
import type { PersistedMessage, ChatHistory } from '../../src/types';

// 相容 Node.js 和 Bun：import.meta.dir 是 Bun 專屬，Node.js 需要用 fileURLToPath
const __dirname = import.meta.dir ?? dirname(fileURLToPath(import.meta.url));

describe('ChatPersistenceService getChatFilePath podId 格式驗證', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(__dirname, `temp-test-validate-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('有效的 podId 應回傳 success: true', () => {
    const result = chatPersistenceService.getChatFilePath(tempDir, 'valid-pod-123');
    expect(result.success).toBe(true);
    expect(result.data).toContain('pod-valid-pod-123');
  });

  it('包含路徑穿越字元的 podId 應回傳 success: false', () => {
    const result = chatPersistenceService.getChatFilePath(tempDir, '../etc/passwd');
    expect(result.success).toBe(false);
  });

  it('包含斜線的 podId 應回傳 success: false', () => {
    const result = chatPersistenceService.getChatFilePath(tempDir, 'pod/malicious');
    expect(result.success).toBe(false);
  });

  it('空白字元的 podId 應回傳 success: false', () => {
    const result = chatPersistenceService.getChatFilePath(tempDir, 'pod name with spaces');
    expect(result.success).toBe(false);
  });

  it('saveMessage 使用無效 podId 應回傳 success: false', async () => {
    const result = await chatPersistenceService.saveMessage(tempDir, '../evil', {
      id: 'msg-1',
      role: 'assistant',
      content: 'Test',
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('loadChatHistory 使用無效 podId 應回傳 null', async () => {
    const result = await chatPersistenceService.loadChatHistory(tempDir, '../evil');
    expect(result).toBeNull();
  });

  it('clearChatHistory 使用無效 podId 應回傳 success: false', async () => {
    const result = await chatPersistenceService.clearChatHistory(tempDir, '../evil');
    expect(result.success).toBe(false);
  });
});

describe('ChatPersistenceService upsertMessage', () => {
  let tempDir: string;
  const podId = 'test-pod-1';

  beforeEach(async () => {
    tempDir = join(__dirname, `temp-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('chat.json 不存在時建立新檔案並寫入 message', async () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Hello, world!',
      timestamp: new Date().toISOString(),
    };

    const result = await chatPersistenceService.upsertMessage(tempDir, podId, message);
    expect(result.success).toBe(true);

    const filePathResult = chatPersistenceService.getChatFilePath(tempDir, podId);
    expect(filePathResult.success).toBe(true);
    const readResult = await persistenceService.readJson<ChatHistory>(filePathResult.data!);
    expect(readResult.success).toBe(true);
    expect(readResult.data?.messages).toHaveLength(1);
    expect(readResult.data?.messages[0].id).toBe('msg-1');
    expect(readResult.data?.messages[0].content).toBe('Hello, world!');
  });

  it('message id 不存在時 push 新 message', async () => {
    // 預先建立一筆 message
    const message1: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'First message',
      timestamp: new Date().toISOString(),
    };
    await chatPersistenceService.upsertMessage(tempDir, podId, message1);

    // 新增不同 id 的 message
    const message2: PersistedMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Second message',
      timestamp: new Date().toISOString(),
    };
    const result = await chatPersistenceService.upsertMessage(tempDir, podId, message2);
    expect(result.success).toBe(true);

    const filePathResult = chatPersistenceService.getChatFilePath(tempDir, podId);
    const readResult = await persistenceService.readJson<ChatHistory>(filePathResult.data!);
    expect(readResult.data?.messages).toHaveLength(2);
    expect(readResult.data?.messages[0].id).toBe('msg-1');
    expect(readResult.data?.messages[1].id).toBe('msg-2');
  });

  it('message id 已存在時更新該 message', async () => {
    // 預先建立一筆 message
    const message1: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Original content',
      timestamp: new Date().toISOString(),
    };
    await chatPersistenceService.upsertMessage(tempDir, podId, message1);

    // 更新相同 id 的 message
    const message2: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Updated content',
      timestamp: new Date().toISOString(),
    };
    const result = await chatPersistenceService.upsertMessage(tempDir, podId, message2);
    expect(result.success).toBe(true);

    const filePathResult = chatPersistenceService.getChatFilePath(tempDir, podId);
    const readResult = await persistenceService.readJson<ChatHistory>(filePathResult.data!);
    expect(readResult.data?.messages).toHaveLength(1);
    expect(readResult.data?.messages[0].id).toBe('msg-1');
    expect(readResult.data?.messages[0].content).toBe('Updated content');
  });

  it('連續呼叫不會產生重複', async () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Content 1',
      timestamp: new Date().toISOString(),
    };

    // 連續呼叫 3 次，每次 content 不同
    await chatPersistenceService.upsertMessage(tempDir, podId, message);

    message.content = 'Content 2';
    await chatPersistenceService.upsertMessage(tempDir, podId, message);

    message.content = 'Content 3';
    await chatPersistenceService.upsertMessage(tempDir, podId, message);

    const filePathResult = chatPersistenceService.getChatFilePath(tempDir, podId);
    const readResult = await persistenceService.readJson<ChatHistory>(filePathResult.data!);
    expect(readResult.data?.messages).toHaveLength(1);
    expect(readResult.data?.messages[0].id).toBe('msg-1');
    expect(readResult.data?.messages[0].content).toBe('Content 3');
  });
});

describe('ChatPersistenceService saveMessage', () => {
  let tempDir: string;
  const podId = 'test-pod-save';

  beforeEach(async () => {
    tempDir = join(__dirname, `temp-test-save-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('新增訊息到空檔案應成功', async () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: '第一則訊息',
      timestamp: new Date().toISOString(),
    };

    const result = await chatPersistenceService.saveMessage(tempDir, podId, message);
    expect(result.success).toBe(true);

    const filePathResult = chatPersistenceService.getChatFilePath(tempDir, podId);
    const readResult = await persistenceService.readJson<ChatHistory>(filePathResult.data!);
    expect(readResult.data?.messages).toHaveLength(1);
    expect(readResult.data?.messages[0].id).toBe('msg-1');
    expect(readResult.data?.messages[0].content).toBe('第一則訊息');
  });

  it('新增訊息到有既有訊息的檔案應 push 到最後', async () => {
    const message1: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: '第一則訊息',
      timestamp: new Date().toISOString(),
    };
    await chatPersistenceService.saveMessage(tempDir, podId, message1);

    const message2: PersistedMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: '第二則訊息',
      timestamp: new Date().toISOString(),
    };
    const result = await chatPersistenceService.saveMessage(tempDir, podId, message2);
    expect(result.success).toBe(true);

    const filePathResult = chatPersistenceService.getChatFilePath(tempDir, podId);
    const readResult = await persistenceService.readJson<ChatHistory>(filePathResult.data!);
    expect(readResult.data?.messages).toHaveLength(2);
    expect(readResult.data?.messages[0].id).toBe('msg-1');
    expect(readResult.data?.messages[1].id).toBe('msg-2');
  });

  it('persistenceService.readJson 失敗時應回傳 err', async () => {
    vi.spyOn(persistenceService, 'readJson').mockResolvedValue({
      success: false,
      error: '讀取失敗',
    });

    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: '訊息內容',
      timestamp: new Date().toISOString(),
    };

    const result = await chatPersistenceService.saveMessage(tempDir, podId, message);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain(podId);
  });
});

describe('ChatPersistenceService loadChatHistory', () => {
  let tempDir: string;
  const podId = 'test-pod-load';

  beforeEach(async () => {
    tempDir = join(__dirname, `temp-test-load-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('檔案不存在時應回傳 null', async () => {
    const result = await chatPersistenceService.loadChatHistory(tempDir, podId);
    expect(result).toBeNull();
  });

  it('檔案存在時應正確回傳 ChatHistory 資料', async () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '歷史訊息',
      timestamp: new Date().toISOString(),
    };
    await chatPersistenceService.saveMessage(tempDir, podId, message);

    const result = await chatPersistenceService.loadChatHistory(tempDir, podId);
    expect(result).not.toBeNull();
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0].id).toBe('msg-1');
    expect(result?.messages[0].content).toBe('歷史訊息');
  });
});

describe('ChatPersistenceService clearChatHistory', () => {
  let tempDir: string;
  const podId = 'test-pod-clear';

  beforeEach(async () => {
    tempDir = join(__dirname, `temp-test-clear-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('刪除成功時應回傳 ok', async () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: '待清除的訊息',
      timestamp: new Date().toISOString(),
    };
    await chatPersistenceService.saveMessage(tempDir, podId, message);

    const result = await chatPersistenceService.clearChatHistory(tempDir, podId);
    expect(result.success).toBe(true);

    const history = await chatPersistenceService.loadChatHistory(tempDir, podId);
    expect(history).toBeNull();
  });

  it('刪除失敗時應回傳 err 並包含 podId', async () => {
    vi.spyOn(persistenceService, 'deleteFile').mockResolvedValue({
      success: false,
      error: '刪除失敗',
    });

    // 先建立檔案讓 getChatFilePath 成功，實際刪除由 mock 控制
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: '訊息',
      timestamp: new Date().toISOString(),
    };
    await chatPersistenceService.saveMessage(tempDir, podId, message);

    const result = await chatPersistenceService.clearChatHistory(tempDir, podId);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain(podId);
  });
});
