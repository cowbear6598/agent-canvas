import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMultiInstanceInput from '@/components/chat/ChatMultiInstanceInput.vue'

function mountInput(podId = 'pod-1') {
  return mount(ChatMultiInstanceInput, {
    props: { podId },
    attachTo: document.body,
  })
}

describe('ChatMultiInstanceInput', () => {
  it('應渲染輸入框和送出按鈕', () => {
    const wrapper = mountInput()
    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(true)
    wrapper.unmount()
  })

  it('輸入框為空時點擊送出，不應 emit send', async () => {
    const wrapper = mountInput()
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('輸入框只有空白時，不應 emit send', async () => {
    const wrapper = mountInput()
    await wrapper.find('input').setValue('   ')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('send')).toBeFalsy()
    wrapper.unmount()
  })

  it('輸入有效文字後點擊送出，應 emit send 帶 trimmed 訊息', async () => {
    const wrapper = mountInput()
    await wrapper.find('input').setValue('  hello world  ')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('send')).toBeTruthy()
    expect(wrapper.emitted('send')?.[0]).toEqual(['hello world'])
    wrapper.unmount()
  })

  it('按 Enter 鍵應觸發送出', async () => {
    const wrapper = mountInput()
    await wrapper.find('input').setValue('測試訊息')
    await wrapper.find('input').trigger('keydown.enter')
    expect(wrapper.emitted('send')).toBeTruthy()
    expect(wrapper.emitted('send')?.[0]).toEqual(['測試訊息'])
    wrapper.unmount()
  })

  it('送出後輸入框應清空', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.setValue('hello')
    await wrapper.find('button').trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('應顯示 Multi-Instance 說明文字', () => {
    const wrapper = mountInput()
    expect(wrapper.text()).toContain('Multi-Instance')
    wrapper.unmount()
  })
})
