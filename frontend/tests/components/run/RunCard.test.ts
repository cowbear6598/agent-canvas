import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RunCard from '@/components/run/RunCard.vue'
import { RUN_TRIGGER_MESSAGE_PREVIEW_LENGTH } from '@/lib/constants'
import type { WorkflowRun } from '@/types/run'

function createRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: 'run-1',
    canvasId: 'canvas-1',
    sourcePodId: 'pod-1',
    sourcePodName: '來源 Pod',
    triggerMessage: '這是觸發訊息',
    status: 'completed',
    podInstances: [
      {
        id: 'pi-1',
        runId: 'run-1',
        podId: 'pod-1',
        podName: 'Pod 1',
        status: 'completed',
      },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function mountCard(run: WorkflowRun, isExpanded = false) {
  return mount(RunCard, {
    props: { run, isExpanded },
  })
}

describe('RunCard', () => {
  it('應顯示 sourcePodName', () => {
    const wrapper = mountCard(createRun())
    expect(wrapper.text()).toContain('來源 Pod')
    wrapper.unmount()
  })

  it('triggerMessage 超過長度時應截斷顯示', () => {
    const longMessage = 'a'.repeat(RUN_TRIGGER_MESSAGE_PREVIEW_LENGTH + 10)
    const wrapper = mountCard(createRun({ triggerMessage: longMessage }))
    expect(wrapper.text()).toContain('...')
    wrapper.unmount()
  })

  it('點擊卡片應 emit toggle-expand', async () => {
    const wrapper = mountCard(createRun())
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle-expand')).toBeTruthy()
    wrapper.unmount()
  })

  it('點擊刪除按鈕應 emit delete（不觸發 toggle-expand）', async () => {
    const wrapper = mountCard(createRun())
    const deleteBtn = wrapper.find('button')
    await deleteBtn.trigger('click')
    expect(wrapper.emitted('delete')).toBeTruthy()
    expect(wrapper.emitted('toggle-expand')).toBeFalsy()
    wrapper.unmount()
  })

  it('isExpanded=false 時不顯示 podInstances', () => {
    const wrapper = mountCard(createRun(), false)
    expect(wrapper.text()).not.toContain('Pod 1')
    wrapper.unmount()
  })

  it('isExpanded=true 時顯示 podInstances', () => {
    const wrapper = mountCard(createRun(), true)
    expect(wrapper.text()).toContain('Pod 1')
    wrapper.unmount()
  })

  it('點擊 podInstance 時應 emit open-pod-chat 帶有正確參數', async () => {
    const wrapper = mountCard(createRun(), true)
    const instanceItem = wrapper.findComponent({ name: 'RunPodInstanceItem' })
    await instanceItem.trigger('click')
    const emitted = wrapper.emitted('open-pod-chat')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]).toEqual(['run-1', 'pod-1', 'Pod 1'])
    wrapper.unmount()
  })
})
