import { WebClient } from "@slack/web-api";

export interface SlackClient {
  auth: {
    test(): Promise<{ user_id?: string }>;
  };
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
    }): Promise<unknown>;
  };
  conversations: {
    list(args: {
      types: string;
      cursor?: string;
      limit: number;
    }): Promise<{
      channels?: Array<{
        id?: string;
        name?: string;
        is_member?: boolean;
      }>;
      response_metadata?: {
        next_cursor?: string;
      };
    }>;
  };
}

export interface SlackClientFactory {
  create(botToken: string): SlackClient;
}

export const slackClientFactory: SlackClientFactory = {
  create(botToken: string): SlackClient {
    return new WebClient(botToken) as SlackClient;
  },
};
