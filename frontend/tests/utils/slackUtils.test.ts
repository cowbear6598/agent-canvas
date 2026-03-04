import { describe, it, expect } from 'vitest'
import { connectionStatusClass } from '@/utils/slackUtils'
import type { SlackApp } from '@/types/slack'

function createMockSlackApp(overrides?: Partial<SlackApp>): SlackApp {
  return {
    id: 'slack-app-1',
    name: 'Test Slack App',
    connectionStatus: 'disconnected',
    channels: [],
    ...overrides,
  }
}

describe('slackUtils', () => {
  describe('connectionStatusClass', () => {
    it('connected 狀態應回傳 bg-green-500', () => {
      const app = createMockSlackApp({ connectionStatus: 'connected' })
      expect(connectionStatusClass(app)).toBe('bg-green-500')
    })

    it('disconnected 狀態應回傳 bg-red-500', () => {
      const app = createMockSlackApp({ connectionStatus: 'disconnected' })
      expect(connectionStatusClass(app)).toBe('bg-red-500')
    })

    it('error 狀態應回傳 bg-red-500', () => {
      const app = createMockSlackApp({ connectionStatus: 'error' })
      expect(connectionStatusClass(app)).toBe('bg-red-500')
    })
  })
})
