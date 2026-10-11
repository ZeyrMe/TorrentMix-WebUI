<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { ColumnState } from '@/composables/useTableColumns/types'
import Icon from '@/components/Icon.vue'
import { useUiOverlay } from '@/composables/useUiOverlay'

interface Props {
  columns: ColumnState[]
}

interface Emits {
  (e: 'toggleVisibility', columnId: string): void
  (e: 'reset'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isOpen = ref(false)
const overlay = useUiOverlay()

/**
 * 切换菜单显示
 */
function toggle() {
  isOpen.value = !isOpen.value
}

/**
 * 切换列可见性
 */
function handleToggle(columnId: string) {
  emit('toggleVisibility', columnId)
}

/**
 * 重置为默认
 */
async function handleReset() {
  const confirmed = await overlay.confirm({
    title: '重置列设置',
    message: '确定要重置所有列宽和可见性为默认设置吗?',
    confirmLabel: '重置',
    cancelLabel: '取消',
    tone: 'warning',
  })
  if (confirmed) {
    emit('reset')
    isOpen.value = false
  }
}

/**
 * 点击外部关闭菜单
 */
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  const menu = document.querySelector('.column-visibility-menu')
  if (menu && !menu.contains(target)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="relative column-visibility-menu">
    <!-- 设置按钮 -->
    <button
      @click.stop="toggle"
      class="icon-btn"
      title="列设置"
    >
      <Icon name="settings" :size="16" />
    </button>

    <!-- 下拉菜单 -->
    <div
      v-if="isOpen"
      class="absolute right-0 top-full mt-1 bg-white border border-slate-200 shadow-lg rounded-lg p-2 z-50 min-w-[200px]"
    >
      <div class="text-xs font-medium text-slate-500 mb-2 px-2">显示列</div>

      <!-- 列可见性切换 -->
      <label
        v-for="column in columns"
        :key="column.id"
        class="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer rounded text-sm transition-colors duration-150"
        :class="{ 'opacity-50 cursor-not-allowed': column.visible && columns.filter(c => c.visible).length <= 1 }"
      >
        <input
          type="checkbox"
          :checked="column.visible"
          :disabled="column.visible && columns.filter(c => c.visible).length <= 1"
          @change="handleToggle(column.id)"
          class="rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
        />
        <span class="flex-1">{{ column.label || '(空列)' }}</span>
      </label>

      <hr class="my-2 border-slate-200" />

      <!-- 重置按钮 -->
      <button
        @click="handleReset"
        class="w-full text-left px-2 py-1.5 text-sm text-blue-600 hover:bg-slate-50 rounded transition-colors duration-150"
      >
        重置为默认
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 防止菜单被截断 */
.column-visibility-menu {
  position: relative;
}
</style>
