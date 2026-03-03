import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ToolOutputModal from '@/components/chat/ToolOutputModal.vue'
import type { ToolUseStatus } from '@/types/chat'

vi.mock('@/utils/renderMarkdown', () => ({
  renderMarkdown: async (raw: string | undefined) => {
    if (!raw || raw.trim().length === 0) return ''
    return `<p>${raw}</p>`
  },
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: {
    name: 'Dialog',
    props: ['open'],
    emits: ['update:open'],
    template: '<div v-if="open" data-testid="dialog"><slot /></div>',
  },
  DialogContent: {
    name: 'DialogContent',
    template: '<div data-testid="dialog-content"><slot /></div>',
  },
  DialogHeader: {
    name: 'DialogHeader',
    template: '<div data-testid="dialog-header"><slot /></div>',
  },
  DialogTitle: {
    name: 'DialogTitle',
    template: '<div data-testid="dialog-title"><slot /></div>',
  },
  DialogDescription: {
    name: 'DialogDescription',
    template: '<div data-testid="dialog-description"><slot /></div>',
  },
}))

function mountModal(props: {
  open: boolean
  toolName: string
  input: Record<string, unknown>
  output: string | undefined
  status: ToolUseStatus
}) {
  return mount(ToolOutputModal, { props })
}

describe('ToolOutputModal', () => {
  it('當 open 為 true 時應該渲染 Modal', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: '執行結果',
      status: 'completed',
    })

    expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(true)
  })

  it('當 open 為 false 時不應該渲染 Modal', () => {
    const wrapper = mountModal({
      open: false,
      toolName: 'Bash',
      input: {},
      output: '執行結果',
      status: 'completed',
    })

    expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false)
  })

  it('應該在標題中顯示 tool 名稱（completed 狀態）', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Read',
      input: {},
      output: '檔案內容',
      status: 'completed',
    })

    const title = wrapper.find('[data-testid="dialog-title"]')
    expect(title.text()).toContain('Read')
    expect(title.text()).toContain('執行結果')
  })

  it('應該以 Markdown 渲染 output 內容', async () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: 'ls -la 輸出結果',
      status: 'completed',
    })

    await nextTick()
    await nextTick()

    const html = wrapper.html()
    expect(html).toContain('ls -la 輸出結果')
  })

  it('當 output 為空字串時應該顯示「無執行結果」提示', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: '',
      status: 'completed',
    })

    expect(wrapper.text()).toContain('無執行結果')
  })

  it('當 output 為 undefined 時應該顯示「無執行結果」提示', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: undefined,
      status: 'completed',
    })

    expect(wrapper.text()).toContain('無執行結果')
  })

  it('應該在 error 狀態時顯示錯誤樣式標記', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: '錯誤輸出',
      status: 'error',
    })

    expect(wrapper.text()).toContain('此工具執行時發生錯誤')
  })

  it('應該在 error 狀態時標題顯示錯誤資訊', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Write',
      input: {},
      output: undefined,
      status: 'error',
    })

    const title = wrapper.find('[data-testid="dialog-title"]')
    expect(title.text()).toContain('Write')
    expect(title.text()).toContain('錯誤資訊')
  })

  it('應該在關閉時發出 update:open 事件', async () => {
    const wrapper = mount(ToolOutputModal, {
      props: {
        open: true,
        toolName: 'Bash',
        input: {},
        output: '結果',
        status: 'completed',
      },
    })

    await wrapper.vm.$emit('update:open', false)

    expect(wrapper.emitted('update:open')).toBeTruthy()
    expect(wrapper.emitted('update:open')![0]).toEqual([false])
  })

  it('completed 狀態不應該顯示錯誤標記', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: '正常輸出',
      status: 'completed',
    })

    expect(wrapper.text()).not.toContain('此工具執行時發生錯誤')
  })

  it('應該顯示格式化的 input 內容', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: { command: 'ls -la', cwd: '/tmp' },
      output: '執行結果',
      status: 'completed',
    })

    expect(wrapper.text()).toContain('輸入參數')
    expect(wrapper.text()).toContain('command')
    expect(wrapper.text()).toContain('ls -la')
    expect(wrapper.text()).toContain('cwd')
    expect(wrapper.text()).toContain('/tmp')
  })

  it('應該在 input 為空物件時不顯示 input 區塊', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: {},
      output: '執行結果',
      status: 'completed',
    })

    expect(wrapper.text()).not.toContain('輸入參數')
  })

  it('應該在 input 和 output 都有值時顯示分隔線', () => {
    const wrapper = mountModal({
      open: true,
      toolName: 'Bash',
      input: { command: 'ls' },
      output: '執行結果',
      status: 'completed',
    })

    expect(wrapper.find('hr').exists()).toBe(true)
  })
})
