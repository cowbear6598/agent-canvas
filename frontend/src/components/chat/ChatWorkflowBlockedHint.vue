<template>
  <div class="p-4 border-t-2 border-doodle-ink">
    <div
      class="border-2 border-dashed border-doodle-ink rounded-lg"
      data-testid="workflow-blocked-hint"
    >
      <p class="text-sm font-mono text-muted-foreground text-center py-4">
        {{ $t("chat.workflowBlockedHint") }}
      </p>
    </div>
  </div>
</template>
