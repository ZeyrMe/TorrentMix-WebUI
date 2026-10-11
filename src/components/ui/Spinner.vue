<script setup lang="ts">
import Icon from '@/components/Icon.vue'

withDefaults(defineProps<{
  label?: string
  size?: number
}>(), {
  label: '加载中…',
  size: 16,
})
</script>

<template>
  <div class="flex items-center justify-center gap-2 text-slate-500 py-8 text-sm">
    <Icon name="loader-2" :size="size" class="animate-spin" />
    <span v-if="label">{{ label }}</span>
  </div>
</template>
