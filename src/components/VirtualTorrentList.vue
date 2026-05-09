<script setup lang="ts">
import { ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { UnifiedTorrent } from '@/adapter/types'
import type { ColumnState } from '@/composables/useTableColumns/types'
import TorrentRow from './torrent/TorrentRow.vue'

interface Props {
  torrents: UnifiedTorrent[]
  selectedHashes: Set<string>
  columns: ColumnState[]
  scrollElement?: HTMLElement | null
  isResizing?: boolean
  showCategoryMeta?: boolean
  emptyCategoryLabel?: string
}

interface Emits {
  (e: 'click', hash: string, event: Event): void
  (e: 'toggle-select', hash: string): void
  (e: 'action', action: string, hash: string): void
  (e: 'contextmenu', event: MouseEvent, hash: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 处理行点击：传递事件对象
function handleRowClick(hash: string, event: Event) {
  emit('click', hash, event)
}

// 处理复选框点击：切换选择
function handleToggleSelect(event: Event) {
  const customEvent = event as CustomEvent<string>
  emit('toggle-select', customEvent.detail)
}

function handleContextMenu(event: MouseEvent, hash: string) {
  emit('contextmenu', event, hash)
}

const internalScrollRef = ref<HTMLElement | null>(null)

// 虚拟滚动配置：使用自身作为滚动容器
const virtualizer = useVirtualizer({
  get count() {
    return props.torrents.length
  },
  getScrollElement: () => (props.scrollElement !== undefined ? props.scrollElement : internalScrollRef.value),
  estimateSize: () => 60,
  overscan: 5
})
</script>

<template>
  <!-- 如果不传入 scrollElement，则组件自身作为滚动容器 -->
  <div v-if="scrollElement === undefined" ref="internalScrollRef" class="flex-1 overflow-auto overflow-x-hidden min-h-0">
    <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
      <TorrentRow
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="String(virtualRow.key)"
        :torrent="torrents[virtualRow.index]!"
        :selected="selectedHashes.has(torrents[virtualRow.index]!.id)"
        :columns="columns"
        :is-resizing="isResizing"
        :show-category-meta="showCategoryMeta"
        :empty-category-label="emptyCategoryLabel"
        @click="handleRowClick(torrents[virtualRow.index]!.id, $event)"
        @toggle-select="handleToggleSelect"
        @action="(action, hash) => emit('action', action, hash)"
        @contextmenu="handleContextMenu"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`
        }"
      />
    </div>
  </div>

  <!-- 外部提供滚动容器：仅渲染内容，不再嵌套第二层滚动条 -->
  <div v-else :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
    <TorrentRow
      v-for="virtualRow in virtualizer.getVirtualItems()"
      :key="String(virtualRow.key)"
      :torrent="torrents[virtualRow.index]!"
      :selected="selectedHashes.has(torrents[virtualRow.index]!.id)"
      :columns="columns"
      :is-resizing="isResizing"
      :show-category-meta="showCategoryMeta"
      :empty-category-label="emptyCategoryLabel"
      @click="handleRowClick(torrents[virtualRow.index]!.id, $event)"
      @toggle-select="handleToggleSelect"
      @action="(action, hash) => emit('action', action, hash)"
      @contextmenu="handleContextMenu"
      :style="{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: `${virtualRow.size}px`,
        transform: `translateY(${virtualRow.start}px)`
      }"
    />
  </div>
</template>
