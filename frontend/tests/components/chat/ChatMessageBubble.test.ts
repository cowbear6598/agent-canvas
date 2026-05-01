import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMessageBubble from '@/components/chat/ChatMessageBubble.vue'
import type { ToolUseInfo } from '@/types/chat'

vi.mock('@/components/chat/ToolOutputModal.vue', () => ({
  default: {
    name: 'ToolOutputModal',
    props: ['open', 'toolName', 'output', 'status'],
    emits: ['update:open'],
    template: '<div v-if="open" data-testid="tool-output-modal" :data-tool-name="toolName"><slot /></div>',
  },
}))

function createTool(overrides: Partial<ToolUseInfo> = {}): ToolUseInfo {
  return {
    toolUseId: 'tool-1',
    toolName: 'Bash',
    input: { command: 'ls' },
    output: '執行結果',
    status: 'completed',
    ...overrides,
  }
}

describe('ChatMessageBubble', () => {
  it('running 狀態的標籤應該渲染為 div 且不可點擊', () => {
    const tool = createTool({ status: 'running', output: undefined })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    const tag = wrapper.find(`[data-testid="tool-tag-${tool.toolUseId}"]`)
    expect(tag.exists()).toBe(false)

    const allDivs = wrapper.findAll('div')
    const runningDivs = allDivs.filter((el) =>
      el.classes().some((c) => c.includes('blue'))
    )
    expect(runningDivs.length).toBeGreaterThan(0)

    const buttons = wrapper.findAll('button')
    const runningButtons = buttons.filter((el) =>
      el.classes().some((c) => c.includes('blue'))
    )
    expect(runningButtons.length).toBe(0)
  })

  it('completed 狀態的標籤應該渲染為 button 且可點擊', () => {
    const tool = createTool({ status: 'completed' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    const buttons = wrapper.findAll('button')
    const completedButton = buttons.find((btn) =>
      btn.text().includes(tool.toolName)
    )
    expect(completedButton).toBeDefined()
    expect(completedButton!.element.tagName).toBe('BUTTON')
  })

  it('error 狀態的標籤應該渲染為 button 且可點擊', () => {
    const tool = createTool({ status: 'error' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    const buttons = wrapper.findAll('button')
    const errorButton = buttons.find((btn) =>
      btn.text().includes(tool.toolName)
    )
    expect(errorButton).toBeDefined()
    expect(errorButton!.element.tagName).toBe('BUTTON')
  })

  it('點擊 completed 標籤後應該開啟 ToolOutputModal', async () => {
    const tool = createTool({ status: 'completed' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    expect(wrapper.find('[data-testid="tool-output-modal"]').exists()).toBe(false)

    const buttons = wrapper.findAll('button')
    const completedButton = buttons.find((btn) =>
      btn.text().includes(tool.toolName)
    )
    await completedButton!.trigger('click')

    expect(wrapper.find('[data-testid="tool-output-modal"]').exists()).toBe(true)
  })

  it('error 狀態的標籤應該顯示紅色樣式', () => {
    const tool = createTool({ status: 'error' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    const buttons = wrapper.findAll('button')
    const errorButton = buttons.find((btn) =>
      btn.text().includes(tool.toolName)
    )
    expect(errorButton).toBeDefined()
    const classes = errorButton!.classes()
    expect(classes.some((c) => c.includes('red'))).toBe(true)
  })

  it('多個標籤各自獨立管理 Modal 開關狀態', async () => {
    const tool1 = createTool({ toolUseId: 'tool-1', toolName: 'Bash', status: 'completed' })
    const tool2 = createTool({ toolUseId: 'tool-2', toolName: 'Read', status: 'completed' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool1, tool2],
      },
    })

    const buttons = wrapper.findAll('button')
    const bashButton = buttons.find((btn) => btn.text().includes('Bash'))
    await bashButton!.trigger('click')

    const modals = wrapper.findAll('[data-testid="tool-output-modal"]')
    expect(modals).toHaveLength(1)
    expect(modals[0]!.attributes('data-tool-name')).toBe('Bash')
  })

  it('點擊 error 標籤後應該開啟 ToolOutputModal', async () => {
    const tool = createTool({ status: 'error' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    expect(wrapper.find('[data-testid="tool-output-modal"]').exists()).toBe(false)

    const buttons = wrapper.findAll('button')
    const errorButton = buttons.find((btn) =>
      btn.text().includes(tool.toolName)
    )
    await errorButton!.trigger('click')

    expect(wrapper.find('[data-testid="tool-output-modal"]').exists()).toBe(true)
  })

  it('running 狀態的標籤不應該開啟 Modal', async () => {
    const tool = createTool({ status: 'running', output: undefined })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '訊息內容',
        role: 'assistant',
        toolUse: [tool],
      },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons.filter((btn) => btn.text().includes(tool.toolName))).toHaveLength(0)

    expect(wrapper.find('[data-testid="tool-output-modal"]').exists()).toBe(false)
  })

  it('toolUse 為空陣列時不應渲染 tool 區塊', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: { content: '測試', role: 'assistant', toolUse: [] },
    })
    expect(wrapper.findAll('button').length).toBe(0)
  })

  it('toolUse 為 undefined 時不應渲染 tool 區塊', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: { content: '測試', role: 'assistant' },
    })
    expect(wrapper.findAll('button').length).toBe(0)
  })

  it('pending 狀態的標籤應渲染為 div 且不可點擊', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '測試',
        role: 'assistant',
        toolUse: [createTool({ status: 'pending' })],
      },
    })
    // pending 狀態下不是 button，不應有任何 button
    const buttons = wrapper.findAll('button')
    const pendingButtons = buttons.filter((btn) => btn.text().includes('Bash'))
    expect(pendingButtons.length).toBe(0)

    const allDivs = wrapper.findAll('div')
    const pendingDivs = allDivs.filter((el) =>
      el.classes().some((c) => c.includes('gray')),
    )
    expect(pendingDivs.length).toBeGreaterThan(0)
  })

  it('isPartial 為 true 時應顯示閃爍游標', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: { content: '測試', role: 'assistant', isPartial: true },
    })
    expect(wrapper.find('.animate-pulse').exists()).toBe(true)
  })

  it('重複 toolUseId 應只渲染一個標籤', () => {
    const tool = createTool({ toolUseId: 'same-id', status: 'completed' })
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: '測試',
        role: 'assistant',
        toolUse: [tool, { ...tool }],
      },
    })
    const buttons = wrapper.findAll('button')
    const matchedButtons = buttons.filter((btn) => btn.text().includes(tool.toolName))
    expect(matchedButtons.length).toBe(1)
  })

  it('system 訊息應顯示 severity、provider 與 code 標籤', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: {
        content: 'Authentication failed',
        role: 'system',
        metadata: {
          provider: 'claude',
          code: 'AUTH_ERROR',
          severity: 'fatal',
          rawContent: 'Authentication failed',
        },
      },
    })

    expect(wrapper.find('[data-testid="system-severity-tag"]').text()).toContain('Fatal')
    expect(wrapper.find('[data-testid="system-provider-tag"]').text()).toBe('CLAUDE')
    expect(wrapper.find('[data-testid="system-code-tag"]').text()).toBe('AUTH_ERROR')
    expect(wrapper.text()).toContain('Authentication failed')
  })
})
