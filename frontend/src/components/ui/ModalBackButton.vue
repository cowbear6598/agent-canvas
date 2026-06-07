<script setup lang="ts">
import { ArrowLeft } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";

defineEmits<{
  back: [];
}>();

const { t } = useI18n();
</script>

<template>
  <Button
    variant="ghost"
    size="sm"
    class="h-9 w-9 p-0"
    :aria-label="t('common.back')"
    @click="$emit('back')"
  >
    <ArrowLeft class="h-4 w-4" />
  </Button>
</template>
