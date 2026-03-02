import path from 'path';
import type {StdioMcpServerConfig} from '../../types/index.js';
import {config} from '../../config/index.js';

export const SLACK_REPLY_MCP_SERVER_ID = '__slack_reply__';

class SlackMcpToolProvider {
    createSlackReplyMcpConfig(slackAppId: string, channelId: string): StdioMcpServerConfig {
        return {
            command: 'bun',
            args: ['run', this.getScriptPath()],
            env: {
                SLACK_APP_ID: slackAppId,
                SLACK_CHANNEL_ID: channelId,
                CALLBACK_URL: `http://localhost:${config.port}/api/internal/slack/reply`,
            },
        };
    }

    private getScriptPath(): string {
        return path.join(import.meta.dir, 'slack-reply-mcp-server.ts');
    }
}

export const slackMcpToolProvider = new SlackMcpToolProvider();
