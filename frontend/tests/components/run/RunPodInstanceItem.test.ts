import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RunPodInstanceItem from '@/components/run/RunPodInstanceItem.vue'
import { RUN_RESPONSE_SUMMARY_LENGTH } from '@/lib/constants'
import type { RunPodInstance } from '@/types/run'

function createInstance(overrides?: Partial<RunPodInstance>): RunPodInstance {
  return {
    id: 'pi-1',
    runId: 'run-1',
    podId: 'pod-1',
    podName: '測試 Pod',
    status: 'completed',
    ...overrides,
  }
}

function mountItem(instance: RunPodInstance, runId = 'run-1') {
  return mount(RunPodInstanceItem, {
    props: { instance, runId },
  })
}

describe('RunPodInstanceItem', () => {
  it('應顯示 podName', () => {
    const wrapper = mountItem(createInstance({ podName: '我的 Pod' }))
    expect(wrapper.text()).toContain('我的 Pod')
    wrapper.unmount()
  })

  it('有 lastResponseSummary 時應顯示截斷後的摘要', () => {
    const longSummary = 'a'.repeat(RUN_RESPONSE_SUMMARY_LENGTH + 10)
    const wrapper = mountItem(createInstance({ lastResponseSummary: longSummary }))
    const text = wrapper.text()
    expect(text).toContain('...')
    wrapper.unmount()
  })

  it('沒有 lastResponseSummary 時不應顯示摘要區塊', () => {
    const wrapper = mountItem(createInstance({ lastResponseSummary: undefined }))
    expect(wrapper.find('p.text-xs').exists()).toBe(false)
    wrapper.unmount()
  })

  it('點擊時應 emit click', async () => {
    const wrapper = mountItem(createInstance())
    await wrapper.trigger('click')
    expect(wrapper.emitted('click')).toBeTruthy()
    wrapper.unmount()
  })

  it('應帶有 cursor-pointer class', () => {
    const wrapper = mountItem(createInstance())
    expect(wrapper.classes()).toContain('cursor-pointer')
    wrapper.unmount()
  })
})
