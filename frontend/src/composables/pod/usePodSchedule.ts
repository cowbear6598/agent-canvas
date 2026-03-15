import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import type { Pod, Schedule } from '@/types'
import { formatScheduleTooltip } from '@/utils/scheduleUtils'

interface ScheduleStores {
  podStore: {
    setScheduleWithBackend: (podId: string, schedule: Schedule | null) => Promise<Pod | null>
    isScheduleFiredAnimating: (podId: string) => boolean
    clearScheduleFiredAnimation: (podId: string) => void
  }
}

interface UsePodScheduleReturn {
  showScheduleModal: Ref<boolean>
  hasSchedule: Ref<boolean>
  scheduleEnabled: Ref<boolean>
  scheduleTooltip: Ref<string>
  isScheduleFiredAnimating: Ref<boolean>
  handleOpenScheduleModal: () => void
  handleScheduleConfirm: (schedule: Schedule) => Promise<void>
  handleScheduleDelete: () => Promise<void>
  handleScheduleToggle: () => Promise<void>
  handleClearScheduleFiredAnimation: () => void
}

export function usePodSchedule(
  podId: Ref<string>,
  getPodSchedule: () => Schedule | null | undefined,
  stores: ScheduleStores
): UsePodScheduleReturn {
  const { podStore } = stores

  const showScheduleModal = ref(false)

  const hasSchedule = computed(() => {
    const schedule = getPodSchedule()
    return schedule !== null && schedule !== undefined
  })

  const scheduleEnabled = computed(() => getPodSchedule()?.enabled ?? false)

  const scheduleTooltip = computed(() => {
    const schedule = getPodSchedule()
    if (!schedule) return ''
    return formatScheduleTooltip(schedule)
  })

  const isScheduleFiredAnimating = computed(() => podStore.isScheduleFiredAnimating(podId.value))

  const handleOpenScheduleModal = (): void => {
    showScheduleModal.value = true
  }

  const handleScheduleConfirm = async (schedule: Schedule): Promise<void> => {
    await podStore.setScheduleWithBackend(podId.value, schedule)
    showScheduleModal.value = false
  }

  const handleScheduleDelete = async (): Promise<void> => {
    await podStore.setScheduleWithBackend(podId.value, null)
    showScheduleModal.value = false
  }

  const handleScheduleToggle = async (): Promise<void> => {
    const schedule = getPodSchedule()
    if (!schedule) return

    const newSchedule = {
      ...schedule,
      enabled: !schedule.enabled
    }

    await podStore.setScheduleWithBackend(podId.value, newSchedule)
  }

  const handleClearScheduleFiredAnimation = (): void => {
    podStore.clearScheduleFiredAnimation(podId.value)
  }

  return {
    showScheduleModal,
    hasSchedule,
    scheduleEnabled,
    scheduleTooltip,
    isScheduleFiredAnimating,
    handleOpenScheduleModal,
    handleScheduleConfirm,
    handleScheduleDelete,
    handleScheduleToggle,
    handleClearScheduleFiredAnimation,
  }
}
