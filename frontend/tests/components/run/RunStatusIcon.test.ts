import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { CheckCircle, Loader2, Clock, XCircle, SkipForward, FileText } from 'lucide-vue-next'
import RunStatusIcon from '@/components/run/RunStatusIcon.vue'
import type { RunStatus, RunPodStatus } from '@/types/run'

function mountIcon(status: RunStatus | RunPodStatus) {
  return mount(RunStatusIcon, {
    props: { status },
  })
}

describe('RunStatusIcon', () => {
  it('completed 狀態應渲染 CheckCircle', () => {
    const wrapper = mountIcon('completed')
    expect(wrapper.findComponent(CheckCircle).exists()).toBe(true)
    wrapper.unmount()
  })

  it('running 狀態應渲染 Loader2 並帶 animate-spin', () => {
    const wrapper = mountIcon('running')
    const icon = wrapper.findComponent(Loader2)
    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('animate-spin')
    wrapper.unmount()
  })

  it('pending 狀態應渲染 Clock', () => {
    const wrapper = mountIcon('pending')
    expect(wrapper.findComponent(Clock).exists()).toBe(true)
    wrapper.unmount()
  })

  it('error 狀態應渲染 XCircle', () => {
    const wrapper = mountIcon('error')
    expect(wrapper.findComponent(XCircle).exists()).toBe(true)
    wrapper.unmount()
  })

  it('skipped 狀態應渲染 SkipForward', () => {
    const wrapper = mountIcon('skipped')
    expect(wrapper.findComponent(SkipForward).exists()).toBe(true)
    wrapper.unmount()
  })

  it('summarizing 狀態應渲染 FileText 並帶 animate-pulse', () => {
    const wrapper = mountIcon('summarizing')
    const icon = wrapper.findComponent(FileText)
    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('animate-pulse')
    wrapper.unmount()
  })

  it('completed 圖標應帶 text-doodle-green class', () => {
    const wrapper = mountIcon('completed')
    const icon = wrapper.findComponent(CheckCircle)
    expect(icon.classes()).toContain('text-doodle-green')
    wrapper.unmount()
  })

  it('running 圖標應帶 text-doodle-blue class', () => {
    const wrapper = mountIcon('running')
    const icon = wrapper.findComponent(Loader2)
    expect(icon.classes()).toContain('text-doodle-blue')
    wrapper.unmount()
  })

  it('error 圖標應帶 text-destructive class', () => {
    const wrapper = mountIcon('error')
    const icon = wrapper.findComponent(XCircle)
    expect(icon.classes()).toContain('text-destructive')
    wrapper.unmount()
  })

  it('summarizing 圖標應帶 text-doodle-orange class', () => {
    const wrapper = mountIcon('summarizing')
    const icon = wrapper.findComponent(FileText)
    expect(icon.classes()).toContain('text-doodle-orange')
    wrapper.unmount()
  })
})
