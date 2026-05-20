<script setup lang="ts">
import type { CollapsibleContentEmits, CollapsibleContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { CollapsibleContent, useForwardPropsEmits } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<
  CollapsibleContentProps & { class?: HTMLAttributes["class"] }
>();
const emits = defineEmits<CollapsibleContentEmits>();

const delegatedProps = reactiveOmit(props, "class");

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <CollapsibleContent
    v-bind="forwarded"
    :class="
      cn(
        'overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:h-0 data-[state=open]:h-auto',
        props.class,
      )
    "
  >
    <slot />
  </CollapsibleContent>
</template>
