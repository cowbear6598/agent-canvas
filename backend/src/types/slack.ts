export type SlackAppConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackApp {
  id: string;
  name: string;
  botToken: string;
  appToken: string;
  connectionStatus: SlackAppConnectionStatus;
  channels: SlackChannel[];
  botUserId: string;
}

export interface PodSlackBinding {
  slackAppId: string;
  slackChannelId: string;
}

export interface SlackMessage {
  id: string;
  slackAppId: string;
  channelId: string;
  userId: string;
  userName: string;
  text: string;
  threadTs?: string;
  eventTs: string;
}

export interface PersistedSlackApp {
  id: string;
  name: string;
  botToken: string;
  appToken: string;
  botUserId: string;
}
