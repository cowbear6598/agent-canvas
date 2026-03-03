import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSlackBlockedHint from '@/components/chat/ChatSlackBlockedHint.vue'

vi.mock('@/components/icons/SlackIcon.vue', () => ({
  default: {
    name: 'SlackIcon',
    template: '<div data-testid="slack-icon"></div>',
  },
}))

describe('ChatSlackBlockedHint', () => {
  it('應渲染 Slack icon', () => {
    const wrapper = mount(ChatSlackBlockedHint)

    expect(wrapper.find('[data-testid="slack-icon"]').exists()).toBe(true)
  })

  it('應顯示正確提示文字', () => {
    const wrapper = mount(ChatSlackBlockedHint)

    expect(wrapper.text()).toContain('此 Pod 已連接 Slack，訊息由 Slack 驅動')
  })

  it('應具有 data-testid', () => {
    const wrapper = mount(ChatSlackBlockedHint)

    expect(wrapper.find('[data-testid="slack-blocked-hint"]').exists()).toBe(true)
  })
})
