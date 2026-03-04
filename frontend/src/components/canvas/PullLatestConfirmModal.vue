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
}

defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
}>()
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Pull 至最新版本</DialogTitle>
        <DialogDescription class="space-y-3">
          <WarningBox
            title="此操作將丟棄所有本地修改"
            description="執行 git fetch + git reset --hard 將無法還原未 commit 的變更"
          />
        </DialogDescription>
      </DialogHeader>

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          @click="emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          variant="destructive"
          @click="emit('confirm')"
        >
          確認 Pull
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
