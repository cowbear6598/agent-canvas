export type SlackAppConnectionStatus = 'connected' | 'disconnected' | 'error';

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackApp {
  id: string;
  name: string;
  botToken: string;
  signingSecret: string;
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

export interface SlackEvent {
  type: string;
  channel: string;
  user?: string;
  text: string;
  ts: string;
  event_ts: string;
  thread_ts?: string;
}

export type AppMentionEvent = SlackEvent;

export interface SlackUrlVerificationPayload {
  type: 'url_verification';
  challenge: string;
  token: string;
}
