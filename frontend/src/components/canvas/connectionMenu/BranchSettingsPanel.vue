<script setup lang="ts">
const emit = defineEmits<{
  "edit-branch-settings": [];
}>();
</script>

<template>
  <button
    class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-secondary"
    @click="emit('edit-branch-settings')"
  >
    <span class="font-mono text-foreground">
      {{ $t("canvas.connectionContextMenu.branchSettings") }}
    </span>
  </button>
</template>
