<script setup lang="ts">
import type { CollapsibleTriggerProps } from "reka-ui";
import { CollapsibleTrigger, useForwardProps } from "reka-ui";

const props = defineProps<CollapsibleTriggerProps>();

const forwarded = useForwardProps(props);
</script>

<template>
  <CollapsibleTrigger v-bind="forwarded">
    <slot />
  </CollapsibleTrigger>
</template>
