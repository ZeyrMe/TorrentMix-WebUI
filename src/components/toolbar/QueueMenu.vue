<script setup lang="ts">
import { ref, computed } from 'vue'
import { onClickOutside } from '@vueuse/core'
import Icon from '@/components/Icon.vue'

interface Props {
  disabled?: boolean
  selectedCount?: number
}

interface Emits {
  (e: 'action', action: 'queue-top' | 'queue-up' | 'queue-down' | 'queue-bottom'): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  selectedCount: 0,
})

const emit = defineEmits<Emits>()

const rootRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)

function toggle() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function handleAction(action: 'queue-top' | 'queue-up' | 'queue-down' | 'queue-bottom') {
  emit('action', action)
  isOpen.value = false
}

const menuItems = computed(() => [
  {
    action: 'queue-top' as const,
    label: '队列排到最前',
    icon: 'chevrons-up',
    description: '将选中种子移到队列最前面',
  },
  {
    action: 'queue-up' as const,
    label: '队列向上移动',
    icon: 'chevron-up',
    description: '将选中种子在队列中向上移动一位',
  },
  {
    action: 'queue-down' as const,
    label: '队列向下移动',
    icon: 'chevron-down',
    description: '将选中种子在队列中向下移动一位',
  },
  {
    action: 'queue-bottom' as const,
    label: '队列排到最后',
    icon: 'chevrons-down',
    description: '将选中种子移到队列最后面',
  },
])

onClickOutside(rootRef, () => {
  isOpen.value = false
})
</script>

<template>
  <div ref="rootRef" class="relative queue-menu">
    <!-- 队列按钮 -->
    <button
      type="button"
      @click.stop="toggle"
      class="icon-btn"
      :class="{ 'opacity-50 cursor-not-allowed': disabled }"
      :disabled="disabled"
      title="队列管理"
      aria-label="队列管理"
    >
      <Icon name="list-ordered" :size="16" />
      <span
        v-if="selectedCount > 0"
        class="absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] leading-none rounded-full min-w-4 h-4 px-1 flex items-center justify-center"
      >
        {{ selectedCount }}
      </span>
    </button>

    <!-- 下拉菜单 -->
    <div
      v-if="isOpen"
      class="absolute right-0 top-full mt-1 bg-white border border-gray-200 shadow-lg rounded-lg py-1 z-50 min-w-[200px]"
    >
      <div class="px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-100">
        队列管理
      </div>

      <button
        type="button"
        v-for="item in menuItems"
        :key="item.action"
        @click="handleAction(item.action)"
        class="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors duration-150"
        :disabled="disabled"
        :class="{ 'opacity-50 cursor-not-allowed': disabled }"
      >
        <Icon :name="item.icon" :size="16" class="shrink-0 text-gray-500" />
        <span class="flex-1 text-left">
          <span class="font-medium block">{{ item.label }}</span>
          <span class="text-xs text-gray-500 block">{{ item.description }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.queue-menu {
  position: relative;
}
</style>
