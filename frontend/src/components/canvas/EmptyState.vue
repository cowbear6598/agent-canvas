<script setup lang="ts"></script>

<template>
  <div
    class="absolute pointer-events-none"
    style="left: 0; top: 0; transform: translate(-50%, -50%)"
  >
    <div class="text-center">
      <div
        class="w-20 h-20 mx-auto mb-4 border-2 border-dashed border-muted-foreground rounded-full flex items-center justify-center"
      >
        <svg
          class="w-8 h-8 text-muted-foreground fill-none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <p class="font-sans text-2xl text-muted-foreground whitespace-nowrap">
        {{ $t("canvas.emptyState") }}
      </p>
    </div>
  </div>
</template>
