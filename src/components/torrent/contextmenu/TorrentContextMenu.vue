<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'
import Icon from '@/components/Icon.vue'

interface Props {
  show: boolean
  x: number
  y: number
  hashes: string[]
  canSetCategory?: boolean
  canQueue?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  canSetCategory: true,
  canQueue: false,
})
const emit = defineEmits<{
  close: []
  action: [action: string, hashes: string[]]
}>()

// 菜单尺寸常量
const MENU_WIDTH = 200
const MENU_HEIGHT = 520
const PADDING = 8

let deferredBindTimer: ReturnType<typeof setTimeout> | null = null

type MenuItem =
  | { type: 'divider'; id: string }
  | {
      type: 'action'
      id: string
      label: string
      icon: string
      danger?: boolean
      disabled?: boolean
      action: () => void
    }

/**
 * 计算菜单位置（避免超出视口）
 */
const menuPosition = computed(() => {
  let left = props.x + PADDING
  let top = props.y + PADDING

  // 右边界检测
  if (left + MENU_WIDTH > window.innerWidth) {
    left = window.innerWidth - MENU_WIDTH - PADDING
  }

  // 下边界检测
  if (top + MENU_HEIGHT > window.innerHeight) {
    top = window.innerHeight - MENU_HEIGHT - PADDING
  }

  return { left, top }
})

/**
 * 动态生成菜单项（根据后端类型和选中数量）
 */
const menuItems = computed<MenuItem[]>(() => {
  const isMulti = props.hashes.length > 1
  const canSetCategory = props.canSetCategory
  const canQueue = props.canQueue

  const items: MenuItem[] = [
    {
      type: 'action' as const,
      id: 'pause',
      label: '暂停',
      icon: 'pause',
      action: () => emit('action', 'pause', props.hashes)
    },
    {
      type: 'action' as const,
      id: 'resume',
      label: '恢复',
      icon: 'play',
      action: () => emit('action', 'resume', props.hashes)
    },
    { type: 'divider' as const, id: 'divider-1' },
    {
      type: 'action' as const,
      id: 'recheck',
      label: '重新校验',
      icon: 'refresh-cw',
      action: () => emit('action', 'recheck', props.hashes)
    },
    {
      type: 'action' as const,
      id: 'reannounce',
      label: '重新汇报',
      icon: 'radio',
      action: () => emit('action', 'reannounce', props.hashes)
    },
    {
      type: 'action' as const,
      id: 'force-start',
      label: '强制开始',
      icon: 'zap',
      action: () => emit('action', 'force-start', props.hashes)
    },
  ]

  if (canQueue) {
    items.push(
      { type: 'divider' as const, id: 'divider-queue' },
      {
        type: 'action' as const,
        id: 'queue-top',
        label: `置顶${isMulti ? ` (${props.hashes.length})` : ''}`,
        icon: 'chevrons-up',
        action: () => emit('action', 'queue-top', props.hashes),
      },
      {
        type: 'action' as const,
        id: 'queue-up',
        label: `上移${isMulti ? ` (${props.hashes.length})` : ''}`,
        icon: 'chevron-up',
        action: () => emit('action', 'queue-up', props.hashes),
      },
      {
        type: 'action' as const,
        id: 'queue-down',
        label: `下移${isMulti ? ` (${props.hashes.length})` : ''}`,
        icon: 'chevron-down',
        action: () => emit('action', 'queue-down', props.hashes),
      },
      {
        type: 'action' as const,
        id: 'queue-bottom',
        label: `置底${isMulti ? ` (${props.hashes.length})` : ''}`,
        icon: 'chevrons-down',
        action: () => emit('action', 'queue-bottom', props.hashes),
      }
    )
  }

  items.push(
    { type: 'divider' as const, id: 'divider-2' },
    {
      type: 'action' as const,
      id: 'set-category',
      label: '设置分类',
      icon: 'folder',
      disabled: !canSetCategory,
      action: () => emit('action', 'set-category', props.hashes)
    },
    {
      type: 'action' as const,
      id: 'set-tags',
      label: '设置标签',
      icon: 'tag',
      action: () => emit('action', 'set-tags', props.hashes)
    },
    {
      type: 'action' as const,
      id: 'delete',
      label: `删除${isMulti ? ` (${props.hashes.length})` : ''}`,
      icon: 'trash-2',
      danger: true,
      action: () => emit('action', 'delete', props.hashes)
    },
  )

  return items
})

/**
 * 点击外部关闭
 */
function handleClickOutside() {
  emit('close')
}

/**
 * ESC 关闭
 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

/**
 * 监听显示状态，添加/移除事件监听器
 */
watch(() => props.show, (show) => {
  if (show) {
    if (deferredBindTimer) {
      clearTimeout(deferredBindTimer)
      deferredBindTimer = null
    }

    // 延迟添加监听器，避免立即触发 clickOutside
    deferredBindTimer = setTimeout(() => {
      if (!props.show) return
      document.addEventListener('click', handleClickOutside)
      document.addEventListener('keydown', handleKeydown)
    }, 0)
  } else {
    if (deferredBindTimer) {
      clearTimeout(deferredBindTimer)
      deferredBindTimer = null
    }
    document.removeEventListener('click', handleClickOutside)
    document.removeEventListener('keydown', handleKeydown)
  }
})

/**
 * 组件卸载时清理监听器
 */
onUnmounted(() => {
  if (deferredBindTimer) {
    clearTimeout(deferredBindTimer)
    deferredBindTimer = null
  }
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
    >
      <div
        v-if="show"
        class="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] max-h-[60vh] overflow-y-auto"
        :style="{
          left: `${menuPosition.left}px`,
          top: `${menuPosition.top}px`
        }"
        @click.stop
      >
        <template v-for="item in menuItems" :key="item.id">
          <div v-if="item.type === 'divider'" class="my-1 border-t border-slate-200" />
          <button
            v-else
            @click="item.action()"
            :class="`w-full px-4 py-2 text-left text-sm flex items-center gap-3 ${
              item.danger
                ? 'text-red-600 hover:bg-red-50'
                : 'text-slate-700 hover:bg-slate-50'
            } ${item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`"
            :disabled="item.disabled"
          >
            <Icon :name="item.icon" :size="16" />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
