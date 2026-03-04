<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import type { FrequencyType, Schedule } from '@/types/pod'

interface Props {
  open: boolean
  podId: string
  existingSchedule?: Schedule | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [schedule: Schedule]
  delete: []
}>()

const frequency = ref<FrequencyType>('every-second')
const second = ref(10)
const intervalMinute = ref(5)
const intervalHour = ref(1)
const hour = ref(0)
const minute = ref(0)
const weekdays = ref<number[]>([])
const weekdaysError = ref('')

const createRange = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => i + start)

const secondOptions = createRange(1, 59)
const intervalMinuteOptions = createRange(1, 59)
const intervalHourOptions = createRange(1, 23)
const hourOptions = createRange(0, 23)
const minuteOptions = createRange(0, 59)
const weekdayOptions = [
  { value: 0, label: '週一' },
  { value: 1, label: '週二' },
  { value: 2, label: '週三' },
  { value: 3, label: '週四' },
  { value: 4, label: '週五' },
  { value: 5, label: '週六' },
  { value: 6, label: '週日' },
]

const isEditMode = computed(() => props.existingSchedule !== undefined && props.existingSchedule !== null)

watch(() => props.open, (newOpen) => {
  if (newOpen && props.existingSchedule) {
    frequency.value = props.existingSchedule.frequency
    second.value = props.existingSchedule.second
    intervalMinute.value = props.existingSchedule.intervalMinute
    intervalHour.value = props.existingSchedule.intervalHour
    hour.value = props.existingSchedule.hour
    minute.value = props.existingSchedule.minute
    weekdays.value = [...props.existingSchedule.weekdays]
  } else if (newOpen) {
    resetState()
  }
})

const validate = (): boolean => {
  weekdaysError.value = ''

  if (frequency.value === 'every-week' && weekdays.value.length === 0) {
    weekdaysError.value = '請至少選擇一天'
    return false
  }

  return true
}

const toggleWeekday = (day: number): void => {
  const index = weekdays.value.indexOf(day)
  if (index > -1) {
    weekdays.value.splice(index, 1)
  } else {
    weekdays.value.push(day)
  }
}

const resetState = (): void => {
  frequency.value = 'every-second'
  second.value = 10
  intervalMinute.value = 5
  intervalHour.value = 1
  hour.value = 0
  minute.value = 0
  weekdays.value = []
  weekdaysError.value = ''
}

const handleClose = (): void => {
  emit('update:open', false)
  resetState()
}

const handleConfirm = (): void => {
  if (!validate()) {
    return
  }

  const schedule: Schedule = {
    frequency: frequency.value,
    second: second.value,
    intervalMinute: intervalMinute.value,
    intervalHour: intervalHour.value,
    hour: hour.value,
    minute: minute.value,
    weekdays: weekdays.value,
    enabled: true,
    lastTriggeredAt: props.existingSchedule?.lastTriggeredAt ?? null
  }

  emit('confirm', schedule)
  emit('update:open', false)
  resetState()
}

const handleToggle = (): void => {
  if (isEditMode.value && props.existingSchedule?.enabled) {
    emit('delete')
    emit('update:open', false)
    resetState()
  } else {
    handleConfirm()
  }
}

const formatMinute = (min: number): string => {
  return min.toString().padStart(2, '0')
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-md font-mono">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? '編輯排程' : '設定排程' }}</DialogTitle>
        <DialogDescription>
          設定 Pod 的自動執行排程
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div class="space-y-2">
          <Label>執行頻率</Label>
          <RadioGroup
            v-model="frequency"
            class="space-y-2"
          >
            <div class="flex items-center space-x-2">
              <RadioGroupItem
                id="every-second"
                value="every-second"
              />
              <Label
                for="every-second"
                class="font-normal cursor-pointer"
              >
                每x秒
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem
                id="every-x-minute"
                value="every-x-minute"
              />
              <Label
                for="every-x-minute"
                class="font-normal cursor-pointer"
              >
                每x分
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem
                id="every-x-hour"
                value="every-x-hour"
              />
              <Label
                for="every-x-hour"
                class="font-normal cursor-pointer"
              >
                每x小時
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem
                id="every-day"
                value="every-day"
              />
              <Label
                for="every-day"
                class="font-normal cursor-pointer"
              >
                每天
              </Label>
            </div>
            <div class="flex items-center space-x-2">
              <RadioGroupItem
                id="every-week"
                value="every-week"
              />
              <Label
                for="every-week"
                class="font-normal cursor-pointer"
              >
                每週
              </Label>
            </div>
          </RadioGroup>
        </div>

        <hr
          v-if="frequency === 'every-second'"
          class="border-border"
        >

        <div
          v-if="frequency === 'every-second'"
          class="space-y-2"
        >
          <Label for="second-select">秒</Label>
          <Select
            id="second-select"
            v-model="second"
          >
            <SelectTrigger>
              <SelectValue>{{ second }}</SelectValue>
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
            >
              <SelectItem
                v-for="s in secondOptions"
                :key="s"
                :value="s"
              >
                {{ s }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <hr
          v-if="frequency === 'every-x-minute'"
          class="border-border"
        >

        <div
          v-if="frequency === 'every-x-minute'"
          class="space-y-2"
        >
          <Label for="interval-minute-select">分鐘</Label>
          <Select
            id="interval-minute-select"
            v-model="intervalMinute"
          >
            <SelectTrigger>
              <SelectValue>{{ intervalMinute }}</SelectValue>
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
            >
              <SelectItem
                v-for="m in intervalMinuteOptions"
                :key="m"
                :value="m"
              >
                {{ m }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <hr
          v-if="frequency === 'every-x-hour'"
          class="border-border"
        >

        <div
          v-if="frequency === 'every-x-hour'"
          class="space-y-2"
        >
          <Label for="interval-hour-select">小時數</Label>
          <Select
            id="interval-hour-select"
            v-model="intervalHour"
          >
            <SelectTrigger>
              <SelectValue>{{ intervalHour }}</SelectValue>
            </SelectTrigger>
            <SelectContent
              position="popper"
              side="top"
            >
              <SelectItem
                v-for="h in intervalHourOptions"
                :key="h"
                :value="h"
              >
                {{ h }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <hr
          v-if="frequency === 'every-day'"
          class="border-border"
        >

        <div
          v-if="frequency === 'every-day'"
          class="space-y-2"
        >
          <Label>執行時間</Label>
          <div class="flex gap-4">
            <div class="flex-1">
              <Label
                for="hour-select"
                class="text-xs text-muted-foreground"
              >
                時
              </Label>
              <Select
                id="hour-select"
                v-model="hour"
              >
                <SelectTrigger>
                  <SelectValue>{{ hour }}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="top"
                >
                  <SelectItem
                    v-for="h in hourOptions"
                    :key="h"
                    :value="h"
                  >
                    {{ h }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex-1">
              <Label
                for="minute-select"
                class="text-xs text-muted-foreground"
              >
                分
              </Label>
              <Select
                id="minute-select"
                v-model="minute"
              >
                <SelectTrigger>
                  <SelectValue>{{ formatMinute(minute) }}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="top"
                >
                  <SelectItem
                    v-for="m in minuteOptions"
                    :key="m"
                    :value="m"
                  >
                    {{ formatMinute(m) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <hr
          v-if="frequency === 'every-week'"
          class="border-border"
        >

        <div
          v-if="frequency === 'every-week'"
          class="space-y-2"
        >
          <Label>選擇星期</Label>
          <div class="flex flex-wrap gap-3">
            <div
              v-for="day in weekdayOptions"
              :key="day.value"
              class="flex items-center space-x-2"
            >
              <Checkbox
                :id="`weekday-${day.value}`"
                :checked="weekdays.includes(day.value)"
                @update:checked="toggleWeekday(day.value)"
              />
              <Label
                :for="`weekday-${day.value}`"
                class="font-normal cursor-pointer"
              >
                {{ day.label }}
              </Label>
            </div>
          </div>
          <p
            v-if="weekdaysError"
            class="text-sm text-red-500"
          >
            {{ weekdaysError }}
          </p>

          <Label>執行時間</Label>
          <div class="flex gap-4">
            <div class="flex-1">
              <Label
                for="custom-hour-select"
                class="text-xs text-muted-foreground"
              >
                時
              </Label>
              <Select
                id="custom-hour-select"
                v-model="hour"
              >
                <SelectTrigger>
                  <SelectValue>{{ hour }}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="top"
                >
                  <SelectItem
                    v-for="h in hourOptions"
                    :key="h"
                    :value="h"
                  >
                    {{ h }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex-1">
              <Label
                for="custom-minute-select"
                class="text-xs text-muted-foreground"
              >
                分
              </Label>
              <Select
                id="custom-minute-select"
                v-model="minute"
              >
                <SelectTrigger>
                  <SelectValue>{{ formatMinute(minute) }}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="top"
                >
                  <SelectItem
                    v-for="m in minuteOptions"
                    :key="m"
                    :value="m"
                  >
                    {{ formatMinute(m) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="flex justify-end gap-2">
        <Button
          variant="outline"
          @click="handleClose"
        >
          取消
        </Button>
        <Button
          variant="default"
          @click="handleToggle"
        >
          {{ isEditMode && existingSchedule?.enabled ? '停用' : '啟用' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
