<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'

defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="flex items-start gap-2 text-destructive">
    <AlertTriangle class="h-5 w-5 mt-0.5 flex-shrink-0" />
    <div>
      <p class="font-medium">
        {{ title }}
      </p>
      <p class="mt-1">
        {{ description }}
      </p>
    </div>
  </div>
</template>
