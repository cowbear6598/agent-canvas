import { ContentBlock } from '../../types';

type ClaudeTextContent = {
  type: 'text';
  text: string;
};

type ClaudeImageContent = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
};

export type ClaudeMessageContent = ClaudeTextContent | ClaudeImageContent;

export type SDKUserMessage = {
  type: 'user';
  message: {
    role: 'user';
    content: ClaudeMessageContent[];
  };
  parent_tool_use_id: null;
  session_id: string;
};

function processTextBlock(text: string): ClaudeTextContent | null {
  if (text.trim().length === 0) {
    return null;
  }
  return { type: 'text', text };
}

function processImageBlock(block: Extract<ContentBlock, { type: 'image' }>): ClaudeImageContent {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: block.mediaType,
      data: block.base64Data,
    },
  };
}

function applyCommandPrefix(
  text: string,
  prefix: string,
  prefixApplied: boolean
): {text: string; prefixApplied: boolean} {
  if (!prefix || prefixApplied) {
    return {text, prefixApplied};
  }
  return {text: `${prefix}${text}`, prefixApplied: true};
}

function convertBlockToContent(
  block: ContentBlock,
  prefix: string,
  prefixApplied: boolean
): {content: ClaudeMessageContent | null; prefixApplied: boolean} {
  if (block.type === 'text') {
    const {text, prefixApplied: applied} = applyCommandPrefix(block.text, prefix, prefixApplied);
    return {content: processTextBlock(text), prefixApplied: applied};
  }
  if (block.type === 'image') {
    return {content: processImageBlock(block), prefixApplied};
  }
  return {content: null, prefixApplied};
}

export function buildClaudeContentBlocks(
  message: ContentBlock[],
  commandId: string | null
): ClaudeMessageContent[] {
  const prefix = commandId ? `/${commandId} ` : '';
  let prefixApplied = false;
  const contentArray: ClaudeMessageContent[] = [];

  for (const block of message) {
    const {content, prefixApplied: applied} = convertBlockToContent(block, prefix, prefixApplied);
    prefixApplied = applied;
    if (content) {
      contentArray.push(content);
    }
  }

  if (contentArray.length === 0) {
    contentArray.push({type: 'text', text: '請開始執行'});
  }

  return contentArray;
}

export function createUserMessageStream(
  content: ClaudeMessageContent[],
  sessionId: string
): AsyncIterable<SDKUserMessage> {
  return (async function* (): AsyncGenerator<SDKUserMessage, void, undefined> {
    yield {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content,
      },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
  })();
}
