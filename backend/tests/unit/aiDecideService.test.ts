// Mock @anthropic-ai/claude-agent-sdk，讓 createSdkMcpServer 保留 tools 供測試訪問
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual('@anthropic-ai/claude-agent-sdk') as any;
  return {
    ...actual,
    createSdkMcpServer: vi.fn((options: { name: string; tools?: any[] }) => ({
      type: 'sdk',
      name: options.name,
      tools: options.tools ?? [],
    })),
  };
});

import { aiDecideService } from '../../src/services/workflow';
import { claudeService } from '../../src/services/claude/claudeService.js';
import { podStore } from '../../src/services/podStore.js';
import { messageStore } from '../../src/services/messageStore.js';
import { outputStyleService } from '../../src/services/outputStyleService.js';
import { commandService } from '../../src/services/commandService.js';
import { summaryPromptBuilder } from '../../src/services/summaryPromptBuilder.js';
import { logger } from '../../src/utils/logger.js';
import type { Connection } from '../../src/types';

describe('AiDecideService', () => {
  const mockSourcePod = {
    id: 'source-pod',
    name: 'Source Pod',
    model: 'claude-sonnet-4-5-20250929' as const,
    claudeSessionId: null,
    repositoryId: null,
    workspacePath: '/test/workspace',
    commandId: null,
    outputStyleId: null,
    status: 'idle' as const,
  } as any;

  const mockTargetPod = {
    id: 'target-pod',
    name: 'Target Pod',
    model: 'claude-sonnet-4-5-20250929' as const,
    claudeSessionId: null,
    repositoryId: null,
    workspacePath: '/test/workspace',
    commandId: null,
    outputStyleId: null,
    status: 'idle' as const,
  } as any;

  const mockMessages = [
    {
      id: 'msg-1',
      podId: 'source-pod',
      role: 'user' as const,
      content: 'Analyze this data',
      timestamp: new Date().toISOString(),
      toolUse: null,
    },
    {
      id: 'msg-2',
      podId: 'source-pod',
      role: 'assistant' as const,
      content: 'Analysis complete: found 3 issues',
      timestamp: new Date().toISOString(),
      toolUse: null,
    },
  ];

  const mockConnection: Connection = {
    id: 'conn-1',
    sourcePodId: 'source-pod',
    sourceAnchor: 'right',
    targetPodId: 'target-pod',
    targetAnchor: 'left',
    triggerMode: 'ai-decide',
    decideStatus: 'none',
    decideReason: null,
    connectionStatus: 'idle',
  };

  beforeEach(() => {
    // podStore
    vi.spyOn(podStore, 'getById').mockImplementation((canvasId: string, podId: string) => {
      if (podId === 'source-pod') return mockSourcePod;
      if (podId === 'target-pod') return mockTargetPod;
      return undefined;
    });

    // messageStore
    vi.spyOn(messageStore, 'getMessages').mockReturnValue(mockMessages);

    // outputStyleService
    vi.spyOn(outputStyleService, 'getContent').mockResolvedValue(null);

    // commandService
    vi.spyOn(commandService, 'getContent').mockResolvedValue(null);

    // claudeService
    vi.spyOn(claudeService, 'executeDisposableChat').mockResolvedValue({
      success: true,
      content: 'Summary: Analysis found 3 issues',
    });

    // summaryPromptBuilder
    vi.spyOn(summaryPromptBuilder, 'formatConversationHistory').mockReturnValue('[User]: Hello\n\n[Assistant]: Hi');

    // logger
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    vi.spyOn(claudeService, 'executeMcpChat').mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success' };
      })() as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AI Decide 單一 connection 判斷為觸發（shouldTrigger = true）', () => {
    it('正確回傳 shouldTrigger: true 和 reason', async () => {
      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation((options: any) => {
        return (async function* () {
          const mcpServer = options.mcpServers['ai-decide'];
          const decideTool = mcpServer.tools[0];

          await decideTool.handler({
            decisions: [
              {
                connectionId: 'conn-1',
                shouldTrigger: true,
                reason: '上游分析結果與下游需求相關',
              },
            ],
          });

          yield { type: 'result', subtype: 'success' };
        })() as any;
      });

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [mockConnection]);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].connectionId).toBe('conn-1');
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(result.results[0].reason).toBe('上游分析結果與下游需求相關');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('AI Decide 單一 connection 判斷為不觸發（shouldTrigger = false），包含 reason', () => {
    it('正確回傳 shouldTrigger: false 和 reason', async () => {
      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation((options: any) => {
        return (async function* () {
          const mcpServer = options.mcpServers['ai-decide'];
          const decideTool = mcpServer.tools[0];

          await decideTool.handler({
            decisions: [
              {
                connectionId: 'conn-1',
                shouldTrigger: false,
                reason: '上游產出與下游任務無關',
              },
            ],
          });

          yield { type: 'result', subtype: 'success' };
        })() as any;
      });

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [mockConnection]);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].connectionId).toBe('conn-1');
      expect(result.results[0].shouldTrigger).toBe(false);
      expect(result.results[0].reason).toBe('上游產出與下游任務無關');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('AI Decide 批次判斷多條 connections，全部觸發', () => {
    it('正確回傳所有 connections 的判斷結果', async () => {
      const mockConnection2: Connection = {
        ...mockConnection,
        id: 'conn-2',
        targetPodId: 'target-pod-2',
      };
      const mockConnection3: Connection = {
        ...mockConnection,
        id: 'conn-3',
        targetPodId: 'target-pod-3',
      };

      (podStore.getById as any).mockImplementation((canvasId: string, podId: string) => {
        if (podId === 'source-pod') return mockSourcePod;
        if (podId.startsWith('target-pod')) return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
        return null;
      });

      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation((options: any) => {
        return (async function* () {
          const mcpServer = options.mcpServers['ai-decide'];
          const decideTool = mcpServer.tools[0];

          await decideTool.handler({
            decisions: [
              { connectionId: 'conn-1', shouldTrigger: true, reason: '相關任務 1' },
              { connectionId: 'conn-2', shouldTrigger: true, reason: '相關任務 2' },
              { connectionId: 'conn-3', shouldTrigger: true, reason: '相關任務 3' },
            ],
          });

          yield { type: 'result', subtype: 'success' };
        })() as any;
      });

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [
        mockConnection,
        mockConnection2,
        mockConnection3,
      ]);

      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(claudeService.executeMcpChat).toHaveBeenCalledTimes(1); // 批次處理，只呼叫一次
    });
  });

  describe('AI Decide 批次判斷多條 connections，部分觸發部分不觸發', () => {
    it('正確回傳混合的判斷結果', async () => {
      const mockConnection2: Connection = {
        ...mockConnection,
        id: 'conn-2',
        targetPodId: 'target-pod-2',
      };

      (podStore.getById as any).mockImplementation((canvasId: string, podId: string) => {
        if (podId === 'source-pod') return mockSourcePod;
        if (podId.startsWith('target-pod')) return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
        return null;
      });

      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation((options: any) => {
        return (async function* () {
          const mcpServer = options.mcpServers['ai-decide'];
          const decideTool = mcpServer.tools[0];

          await decideTool.handler({
            decisions: [
              { connectionId: 'conn-1', shouldTrigger: true, reason: '相關任務' },
              { connectionId: 'conn-2', shouldTrigger: false, reason: '不相關任務' },
            ],
          });

          yield { type: 'result', subtype: 'success' };
        })() as any;
      });

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [
        mockConnection,
        mockConnection2,
      ]);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].shouldTrigger).toBe(true);
      expect(result.results[1].shouldTrigger).toBe(false);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('AI Decide 批次判斷中缺少某條 connection 的結果（部分失敗）', () => {
    it('缺少結果的 connection 進入 errors 陣列', async () => {
      const mockConnection2: Connection = {
        ...mockConnection,
        id: 'conn-2',
        targetPodId: 'target-pod-2',
      };
      const mockConnection3: Connection = {
        ...mockConnection,
        id: 'conn-3',
        targetPodId: 'target-pod-3',
      };

      (podStore.getById as any).mockImplementation((canvasId: string, podId: string) => {
        if (podId === 'source-pod') return mockSourcePod;
        if (podId.startsWith('target-pod')) return { ...mockTargetPod, id: podId, name: `Target ${podId}` };
        return null;
      });

      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation((options: any) => {
        return (async function* () {
          const mcpServer = options.mcpServers['ai-decide'];
          const decideTool = mcpServer.tools[0];

          // 只回傳 2 條結果，conn-3 缺失
          await decideTool.handler({
            decisions: [
              { connectionId: 'conn-1', shouldTrigger: true, reason: '相關任務 1' },
              { connectionId: 'conn-2', shouldTrigger: false, reason: '不相關任務 2' },
            ],
          });

          yield { type: 'result', subtype: 'success' };
        })() as any;
      });

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [
        mockConnection,
        mockConnection2,
        mockConnection3,
      ]);

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe('conn-3');
      expect(result.errors[0].error).toBe('此連線未獲得 AI 決策結果');
    });
  });

  describe('Claude API 請求失敗時的錯誤處理', () => {
    it('所有 connections 進入 errors 陣列', async () => {
      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation(() => {
        throw new Error('Claude API Error');
      });

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [mockConnection]);

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe('conn-1');
      expect(result.errors[0].error).toContain('Claude API Error');
    });
  });

  describe('Custom Tool handler 未被呼叫時的錯誤處理', () => {
    it('所有 connections 進入 errors 陣列', async () => {
      // Mock executeMcpChat 但不呼叫 tool handler
      vi.spyOn(claudeService, 'executeMcpChat').mockReturnValue(
        (async function* () {
          yield { type: 'result', subtype: 'success' };
        })() as any
      );

      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', [mockConnection]);

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].connectionId).toBe('conn-1');
      expect(result.errors[0].error).toBe('AI 決策工具未被執行');
    });
  });

  describe('正確組裝 prompt（包含 source 摘要、target OutputStyle、target Command）', () => {
    it('傳給 executeMcpChat 的 options 包含正確資訊', async () => {
      const targetPodWithResources = {
        ...mockTargetPod,
        outputStyleId: 'style-1',
        commandId: 'command-1',
      };

      (podStore.getById as any).mockImplementation((canvasId: string, podId: string) => {
        if (podId === 'source-pod') return mockSourcePod;
        if (podId === 'target-pod') return targetPodWithResources;
        return null;
      });

      (outputStyleService.getContent as any).mockResolvedValue('You are a code reviewer.');
      (commandService.getContent as any).mockResolvedValue('Review the code for bugs.');

      vi.spyOn(claudeService, 'executeMcpChat').mockImplementation((options: any) => {
        return (async function* () {
          const mcpServer = options.mcpServers['ai-decide'];
          const decideTool = mcpServer.tools[0];

          await decideTool.handler({
            decisions: [{ connectionId: 'conn-1', shouldTrigger: true, reason: '相關' }],
          });

          yield { type: 'result', subtype: 'success' };
        })() as any;
      });

      await aiDecideService.decideConnections('canvas-1', 'source-pod', [mockConnection]);

      expect(claudeService.executeMcpChat).toHaveBeenCalledTimes(1);
      const callOptions = (claudeService.executeMcpChat as any).mock.calls[0][0];

      expect(callOptions.prompt).toContain('Target Pod');
      expect(callOptions.systemPrompt).toContain('Workflow 觸發判斷者');
      expect(outputStyleService.getContent).toHaveBeenCalledWith('style-1');
      expect(commandService.getContent).toHaveBeenCalledWith('command-1');
    });
  });

  describe('空的 ai-decide connections 陣列時直接回傳空結果', () => {
    it('不呼叫 Claude API，直接回傳空結果', async () => {
      const result = await aiDecideService.decideConnections('canvas-1', 'source-pod', []);

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(claudeService.executeMcpChat).not.toHaveBeenCalled();
    });
  });
});
