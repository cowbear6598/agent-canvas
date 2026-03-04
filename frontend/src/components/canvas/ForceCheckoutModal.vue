<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import WarningBox from '@/components/ui/WarningBox.vue'

interface Props {
  open: boolean
  targetBranch: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'cancel': []
  'force-checkout': []
}>()

const handleCancel = (): void => {
  emit('cancel')
  emit('update:open', false)
}

const handleForceCheckout = (): void => {
  emit('force-checkout')
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>有未儲存的修改</DialogTitle>
        <DialogDescription class="space-y-3">
          <WarningBox
            title="目前有未 commit 的修改"
            :description="`切換到 ${props.targetBranch} 將會丟失所有未 commit 的修改`"
          />
        </DialogDescription>
      </DialogHeader>

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          @click="handleCancel"
        >
          取消
        </Button>
        <Button
          variant="destructive"
          @click="handleForceCheckout"
        >
          強制切換
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
