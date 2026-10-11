<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ColumnState, ColumnResizeState } from '@/composables/useTableColumns/types'

interface Props {
  columns: ColumnState[]
  resizeState: ColumnResizeState
}

interface Emits {
  (e: 'startResize', leftColumnId: string, rightColumnId: string, startX: number, snapshots: Array<{ id: string; width: number }>): void
  (e: 'toggleSort', columnId: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0)

function isRendered(column: ColumnState) {
  if (!column.visible) return false
  if (column.responsiveHidden === 'md') return viewportWidth.value >= 768
  if (column.responsiveHidden === 'lg') return viewportWidth.value >= 1024
  return true
}

const renderedColumns = computed(() => props.columns.filter(isRendered))

function handleViewportResize() {
  viewportWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', handleViewportResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleViewportResize)
})

/**
 * 处理调整手柄点击
 */
function handleResizeStart(index: number, e: MouseEvent) {
  const left = renderedColumns.value[index]
  const right = renderedColumns.value[index + 1]
  if (!left || !right) return
  if (left.resizable === false || right.resizable === false) return

  const leftCell = (e.currentTarget as HTMLElement).parentElement as HTMLElement | null
  const container = leftCell?.parentElement as HTMLElement | null
  const nodes = Array.from(container?.querySelectorAll<HTMLElement>('[data-column-id]') ?? [])

  const snapshots = nodes.map((node) => ({
    id: node.dataset.columnId!,
    width: node.getBoundingClientRect().width
  }))

  emit('startResize', left.id, right.id, e.clientX, snapshots)
}
</script>

<template>
  <div
    class="flex items-center bg-slate-100 border-b border-slate-200 text-xs text-slate-600 uppercase tracking-wide w-full min-w-0 overflow-hidden"
    :class="{ 'is-resizing': resizeState.isResizing }"
  >
    <div
      v-for="(column, index) in renderedColumns"
      :key="column.id"
      class="relative group min-w-0"
      :class="{
        'flex-none shrink-0': column.resizable === false
      }"
      :style="{
        flex: resizeState.isResizing || column.resizable === false
          ? `0 0 ${column.currentWidth}px`
          : `${Math.max(1, column.currentWidth)} 1 ${column.currentWidth}px`,
        minWidth: `${column.minWidth}px`
      }"
      :data-column-id="column.id"
    >
      <!-- 列标题 (可点击排序) -->
      <button
        v-if="column.sortable"
        @click="$emit('toggleSort', column.id)"
        class="w-full px-3 py-3 text-left hover:bg-slate-200 transition-colors duration-150 cursor-pointer"
        :class="{
          'text-center': column.align === 'center',
          'text-right': column.align === 'right'
        }"
      >
        <slot :name="`header-${column.id}`" :column="column">
          {{ column.label }}
        </slot>
      </button>

      <!-- 列标题 (不可排序) -->
      <div
        v-else
        class="px-3 py-3"
        :class="{
          'text-center': column.align === 'center',
          'text-right': column.align === 'right'
        }"
      >
        <slot :name="`header-${column.id}`" :column="column">
          {{ column.label }}
        </slot>
      </div>

      <!-- 调整手柄 -->
      <div
        v-if="column.resizable !== false && renderedColumns[index + 1]?.resizable !== false"
        class="absolute inset-y-0 -right-1 w-2 cursor-col-resize flex items-center justify-center group/resize z-10"
        :class="{
          'hover:bg-slate-300/60': !(resizeState.isResizing && resizeState.columnId === column.id),
          'bg-slate-400/70': resizeState.isResizing && resizeState.columnId === column.id
        }"
        @mousedown.stop="handleResizeStart(index, $event)"
      >
        <!-- 可见的拖拽指示条 (只在悬停时显示) -->
        <div
          class="w-0.5 h-4 bg-slate-400 rounded-full opacity-0 group-hover/resize:opacity-100 group-hover/resize:h-6 transition-all duration-150"
          :class="{ 'opacity-100 !h-6 !bg-slate-600': resizeState.isResizing && resizeState.columnId === column.id }"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 拖拽时光标样式 */
.is-resizing * {
  cursor: col-resize !important;
  user-select: none;
}
</style>
