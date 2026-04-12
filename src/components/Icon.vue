<script setup lang="ts">
import { computed } from 'vue'
import { getIconComponent } from '@/components/icons/registry'

// 图标颜色映射
const iconColors = {
  // 状态色
  blue: 'text-blue-500',
  cyan: 'text-cyan-500',
  green: 'text-green-500',
  gray: 'text-gray-400',
  purple: 'text-purple-500',
  red: 'text-red-500',
  yellow: 'text-yellow-500',
  orange: 'text-orange-500',
  // 特殊色
  white: 'text-white',
  // 默认
  default: 'text-current',
} as const

type IconColor = keyof typeof iconColors
type IconColorValue = IconColor | 'white'

interface Props {
  name: string
  size?: number
  color?: IconColorValue
  class?: string | Record<string, boolean>
}

const props = withDefaults(defineProps<Props>(), {
  size: 16,
  color: 'default',
})

const iconComponent = computed(() => getIconComponent(props.name))
const colorClass = computed(() => iconColors[props.color as IconColor] || props.color || '')
</script>

<template>
  <component
    :is="iconComponent"
    :size="size"
    :class="[colorClass, props.class]"
    aria-hidden="true"
    focusable="false"
  />
</template>
