<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2, Plus } from 'lucide-vue-next'
import { useSlackStore } from '@/stores/slackStore'
import { connectionStatusClass } from '@/utils/slackUtils'

interface Props {
  open: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const slackStore = useSlackStore()

const showAddForm = ref(false)
const appName = ref('')
const botToken = ref('')
const signingSecret = ref('')
const isSubmitting = ref(false)
const submitError = ref('')

const nameError = computed(() => {
  if (appName.value === '') return '名稱不可為空'
  return ''
})

const botTokenError = computed(() => {
  if (botToken.value === '') return 'Bot Token 不可為空'
  if (!botToken.value.startsWith('xoxb-')) return 'Bot Token 必須以 xoxb- 開頭'
  return ''
})

const signingSecretError = computed(() => {
  if (signingSecret.value === '') return 'Signing Secret 不可為空'
  return ''
})

const isFormValid = computed(() => {
  return !nameError.value && !botTokenError.value && !signingSecretError.value
})

const isDirty = computed(() => {
  return appName.value !== '' || botToken.value !== '' || signingSecret.value !== ''
})

const handleClose = (): void => {
  emit('update:open', false)
}

const handleOpenAddForm = (): void => {
  showAddForm.value = true
  submitError.value = ''
}

const handleCancelAddForm = (): void => {
  showAddForm.value = false
  resetForm()
}

const resetForm = (): void => {
  appName.value = ''
  botToken.value = ''
  signingSecret.value = ''
  submitError.value = ''
}

const handleConfirmAdd = async (): Promise<void> => {
  if (!isFormValid.value) return

  isSubmitting.value = true
  submitError.value = ''

  const result = await slackStore.createSlackApp(appName.value, botToken.value, signingSecret.value)

  isSubmitting.value = false

  if (!result) return

  showAddForm.value = false
  resetForm()
}

const handleDeleteApp = async (appId: string): Promise<void> => {
  await slackStore.deleteSlackApp(appId)
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="handleClose"
  >
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Slack Apps 管理</DialogTitle>
        <DialogDescription>管理已註冊的 Slack App 與連線狀態</DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div
          v-if="slackStore.slackApps.length === 0 && !showAddForm"
          class="py-6 text-center text-sm text-muted-foreground"
        >
          尚未註冊任何 Slack App
        </div>

        <div
          v-for="app in slackStore.slackApps"
          :key="app.id"
          class="flex items-center gap-3 rounded-md border px-4 py-3"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :class="connectionStatusClass(app)"
          />

          <div class="flex flex-1 flex-col gap-1 overflow-hidden">
            <span class="font-semibold">{{ app.name }}</span>

            <div
              v-if="app.channels.length > 0"
              class="flex flex-wrap gap-1"
            >
              <span
                v-for="channel in app.channels"
                :key="channel.id"
                class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                #{{ channel.name }}
              </span>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-destructive hover:text-destructive"
            @click="handleDeleteApp(app.id)"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>

        <div
          v-if="showAddForm"
          class="space-y-3 rounded-md border px-4 py-3"
        >
          <div class="space-y-1">
            <Input
              v-model="appName"
              placeholder="例如：My Slack Bot"
            />
            <p
              v-if="isDirty && nameError"
              class="text-xs text-red-500"
            >
              {{ nameError }}
            </p>
          </div>

          <div class="space-y-1">
            <Input
              v-model="botToken"
              type="password"
              placeholder="xoxb-..."
            />
            <p
              v-if="isDirty && botTokenError"
              class="text-xs text-red-500"
            >
              {{ botTokenError }}
            </p>
          </div>

          <div class="space-y-1">
            <Input
              v-model="signingSecret"
              type="password"
              placeholder="Signing Secret"
            />
            <p
              v-if="isDirty && signingSecretError"
              class="text-xs text-red-500"
            >
              {{ signingSecretError }}
            </p>
          </div>

          <p
            v-if="submitError"
            class="text-xs text-red-500"
          >
            {{ submitError }}
          </p>

          <div class="flex justify-end gap-2">
            <Button
              variant="outline"
              @click="handleCancelAddForm"
            >
              取消
            </Button>
            <Button
              variant="default"
              :disabled="isSubmitting || !isFormValid"
              @click="handleConfirmAdd"
            >
              {{ isSubmitting ? '連線中...' : '確認新增' }}
            </Button>
          </div>
        </div>

        <Button
          v-if="!showAddForm"
          variant="outline"
          class="w-full"
          @click="handleOpenAddForm"
        >
          <Plus class="size-4" />
          新增 App
        </Button>
      </div>

      <DialogFooter />
    </DialogContent>
  </Dialog>
</template>
