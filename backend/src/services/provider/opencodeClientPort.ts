/**
 * opencode v2 client 的 session.prompt 請求 body 形狀。
 */
export interface OpencodeV2PromptInput {
  model?: { providerID: string; modelID: string };
  tools?: { [key: string]: boolean };
  /** v2 支援透過 system 欄位注入 Goal Runtime bootstrap prompt */
  system?: string;
  /** OpenCode v2 prompt 支援 variant，用來套用官方模型 preset。 */
  variant?: string;
  parts: Array<{ type: "text"; text: string }>;
}

/**
 * session.messages 回傳的 message 項目形狀（v2 相容）。
 */
export interface OpencodeMessageItem {
  info: { id: string; role: string };
  parts: Array<{
    id: string;
    type: string;
    callID?: string;
    tool?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
    };
  }>;
}

/**
 * opencode client 操作介面（供測試可以 mock）。
 *
 * 參數形狀對齊 SDK v2 OpencodeClient（Session2 class）：
 * - session.create：使用頂層 directory / workspace，不再放在 query 子物件
 * - session.prompt：以 sessionID（string）取代 path.id，body 欄位平鋪至頂層
 * - session.abort：以 sessionID 取代 path.id
 * - session.messages：以 sessionID 取代 path.id，query 參數平鋪至頂層
 * - event.subscribe：directory 平鋪至頂層（不再放在 query）
 * - tool.ids：directory 平鋪至頂層
 */
export interface OpencodeClientPort {
  session: {
    create(parameters?: {
      directory?: string;
    }): Promise<{ data?: { id?: string } | null; error?: unknown }>;
    prompt(parameters: {
      sessionID: string;
      directory?: string;
      model?: { providerID: string; modelID: string };
      tools?: { [key: string]: boolean };
      system?: string;
      variant?: string;
      parts: Array<{ type: "text"; text: string }>;
    }): Promise<{ data?: unknown; error?: unknown }>;
    abort(parameters: {
      sessionID: string;
      directory?: string;
    }): Promise<unknown>;
    messages(parameters: {
      sessionID: string;
      directory?: string;
      limit?: number;
    }): Promise<{
      data?: Array<OpencodeMessageItem> | null;
      error?: unknown;
    }>;
  };
  tool: {
    ids(parameters?: {
      directory?: string;
    }): Promise<{ data?: string[] | null; error?: unknown }>;
  };
  event: {
    subscribe(parameters?: {
      directory?: string;
    }): Promise<{ stream: AsyncGenerator<unknown> }>;
  };
}
