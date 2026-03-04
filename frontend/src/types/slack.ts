export type SlackAppConnectionStatus = 'connected' | 'disconnected' | 'error'

export interface SlackChannel {
  id: string
  name: string
}

export interface SlackApp {
  id: string
  name: string
  connectionStatus: SlackAppConnectionStatus
  channels: SlackChannel[]
}

export interface PodSlackBinding {
  slackAppId: string
  slackChannelId: string
}
