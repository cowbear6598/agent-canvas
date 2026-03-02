const SLACK_APP_ID = process.env.SLACK_APP_ID!;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;
const CALLBACK_URL = process.env.CALLBACK_URL!;

const TOOL_DEFINITION = {
    name: 'slack_reply',
    description: 'Reply to a Slack message in the specified channel',
    inputSchema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'The text to send to the Slack channel',
            },
            thread_ts: {
                type: 'string',
                description: 'The timestamp of the thread to reply to (optional)',
            },
        },
        required: ['text'],
    },
};

function buildResponse(id: unknown, result: unknown): string {
    const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        result,
    });
    const bytes = Buffer.byteLength(message, 'utf8');
    return `Content-Length: ${bytes}\r\n\r\n${message}`;
}

function buildErrorResponse(id: unknown, code: number, message: string): string {
    const msg = JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {code, message},
    });
    const bytes = Buffer.byteLength(msg, 'utf8');
    return `Content-Length: ${bytes}\r\n\r\n${msg}`;
}

async function handleToolCall(id: unknown, params: Record<string, unknown>): Promise<string> {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const text = args.text as string;
    const threadTs = args.thread_ts as string | undefined;

    try {
        const response = await fetch(CALLBACK_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                slackAppId: SLACK_APP_ID,
                channelId: SLACK_CHANNEL_ID,
                text,
                threadTs,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return buildResponse(id, {
                content: [{type: 'text', text: `發送訊息失敗：${response.status} ${errorText}`}],
                isError: true,
            });
        }

        return buildResponse(id, {
            content: [{type: 'text', text: '訊息已成功發送至 Slack 頻道'}],
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return buildResponse(id, {
            content: [{type: 'text', text: `發送訊息時發生錯誤：${errorMessage}`}],
            isError: true,
        });
    }
}

function handleInitialize(id: unknown): string {
    return buildResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {tools: {}},
        serverInfo: {name: 'slack-reply-mcp-server', version: '1.0.0'},
    });
}

function handleToolsList(id: unknown): string {
    return buildResponse(id, {tools: [TOOL_DEFINITION]});
}

async function processMessage(rawMessage: string): Promise<string | null> {
    let parsed: {id?: unknown; method?: string; params?: Record<string, unknown>};

    try {
        parsed = JSON.parse(rawMessage);
    } catch {
        return null;
    }

    const {id, method, params = {}} = parsed;

    if (method === 'initialize') {
        return handleInitialize(id);
    }

    if (method === 'notifications/initialized') {
        return null;
    }

    if (method === 'tools/list') {
        return handleToolsList(id);
    }

    if (method === 'tools/call') {
        return handleToolCall(id, params);
    }

    return buildErrorResponse(id, -32601, `找不到方法：${method}`);
}

// 從 stdin 讀取 MCP 訊息（使用 LSP-like Content-Length 協議）
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

let buffer = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;

    if (buffer.length > MAX_BUFFER_SIZE) {
        process.stderr.write('MCP buffer 超過上限，強制結束\n');
        process.exit(1);
    }

    while (true) {
        // 尋找 Content-Length header
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
            break;
        }

        const header = buffer.slice(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!contentLengthMatch) {
            break;
        }

        const contentLength = parseInt(contentLengthMatch[1], 10);
        const messageStart = headerEnd + 4;

        if (buffer.length < messageStart + contentLength) {
            break;
        }

        const rawMessage = buffer.slice(messageStart, messageStart + contentLength);
        buffer = buffer.slice(messageStart + contentLength);

        const response = await processMessage(rawMessage);
        if (response) {
            process.stdout.write(response);
        }
    }
});

process.stdin.on('end', () => {
    process.exit(0);
});
