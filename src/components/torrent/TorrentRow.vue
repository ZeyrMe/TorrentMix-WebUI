<script setup lang="ts">
import { computed } from 'vue'
import type { UnifiedTorrent } from '@/adapter/types'
import type { ColumnState } from '@/composables/useTableColumns/types'
import { formatBytes, formatSpeed } from '@/utils/format'
import { getSwarmTexts, getSwarmTitle } from '@/utils/swarm'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'

const props = defineProps<{
  torrent: UnifiedTorrent
  selected: boolean
  columns: ColumnState[]
  isResizing?: boolean
}>()

const emit = defineEmits<{
  click: [event: Event]
  action: [action: string, hash: string]
  contextmenu: [event: MouseEvent, hash: string]
}>()

const columnById = computed<Record<string, ColumnState | undefined>>(() => {
  const map: Record<string, ColumnState | undefined> = {}
  for (const col of props.columns) {
    map[col.id] = col
  }
  return map
})

function getFlexStyle(columnId: string, fixed = false) {
  const column = columnById.value[columnId]
  const width = column?.currentWidth ?? 0
  const minWidth = column?.minWidth ?? 0

  if (fixed || props.isResizing) {
    return {
      flex: `0 0 ${width}px`,
      minWidth: `${minWidth}px`
    }
  }

  return {
    flex: `${Math.max(1, width)} 1 ${width}px`,
    minWidth: `${minWidth}px`
  }
}

// 处理复选框点击，切换选择状态
function handleCheckboxClick(e: MouseEvent) {
  // 阻止触发整行点击（否则会先选中行再 toggle，导致无法选中只能取消）
  e.stopPropagation()
  // 触发父组件的 toggleSelect 逻辑
  ;(e.currentTarget as HTMLElement).dispatchEvent(new CustomEvent('toggle-select', {
    bubbles: true,
    detail: props.torrent.id
  }))
}

// 处理右键菜单
function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  emit('contextmenu', e, props.torrent.id)
}

function isNestedInteractiveTarget(event: KeyboardEvent) {
  const target = event.target
  const currentTarget = event.currentTarget
  if (!(target instanceof HTMLElement) || !(currentTarget instanceof HTMLElement)) return false

  const interactive = target.closest('button, input, select, textarea, a, [role="button"]')
  return interactive !== null && interactive !== currentTarget
}

function handleRowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  if (isNestedInteractiveTarget(e)) return
  e.preventDefault()
  e.stopPropagation()
  emit('click', e)
}

type TorrentState = UnifiedTorrent['state']

// 状态图标映射
const getStateIcon = (state: TorrentState): { name: string; color: 'blue' | 'cyan' | 'gray' | 'orange' | 'purple' | 'red' } => {
  const icons: Record<TorrentState, { name: string; color: 'blue' | 'cyan' | 'gray' | 'orange' | 'purple' | 'red' }> = {
    downloading: { name: 'download', color: 'blue' },
    seeding: { name: 'upload-cloud', color: 'cyan' },
    paused: { name: 'pause-circle', color: 'gray' },
    queued: { name: 'clock', color: 'orange' },
    checking: { name: 'refresh-cw', color: 'purple' },
    error: { name: 'alert-circle', color: 'red' }
  }
  return icons[state]
}

// 计算健康度百分比（偏向“可下载性”：做种数越多越健康）
const getHealthPercentage = (torrent: UnifiedTorrent): number | null => {
  const hasSeeds = torrent.numSeeds !== undefined && torrent.numSeeds !== null
  const hasPeers = torrent.numPeers !== undefined && torrent.numPeers !== null
  const hasConnectedSeeds = torrent.connectedSeeds !== undefined && torrent.connectedSeeds !== null
  const hasConnectedPeers = torrent.connectedPeers !== undefined && torrent.connectedPeers !== null
  if (!hasSeeds && !hasPeers && !hasConnectedSeeds && !hasConnectedPeers) return null

  // 健康度以“可用性”为主：优先看 swarm 总做种/总下载者（numSeeds/numPeers 已做兼容）。
  const seeds = torrent.numSeeds ?? torrent.connectedSeeds ?? 0
  const peers = torrent.numPeers ?? torrent.connectedPeers ?? 0

  if (seeds >= 10) return 100
  if (seeds >= 5) return 80
  if (seeds >= 1) return 50
  if (peers > 0) return 10
  return 0
}

function formatHealth(torrent: UnifiedTorrent): string {
  const value = getHealthPercentage(torrent)
  return value === null ? '--' : `${value}%`
}

// 格式化ETA
const formatETA = (eta: number, progress: number, state: TorrentState): string => {
  // 已完成或错误状态显示无限
  if (progress >= 1.0 || state === 'error') return '∞'

  // 无限时间判断：-1、负数、非数值、或超过1年
  if (eta === -1 || eta <= 0 || !isFinite(eta) || eta >= 86400 * 365) return '∞'

  const seconds = Math.floor(eta)
  if (seconds < 60) return `${seconds}秒`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时`

  const days = Math.floor(hours / 24)
  return `${days}天`
}
</script>

<template>
  <!-- div-based table row, compatible with virtual scrolling -->
  <div
    class="torrent-row cursor-pointer group flex items-center w-full min-w-0"
    :class="{ 'bg-blue-50 border-blue-200': selected }"
    :data-torrent-id="torrent.id"
    role="button"
    tabindex="0"
    :aria-label="`查看种子 ${torrent.name}`"
    @click="$emit('click', $event)"
    @keydown="handleRowKeydown"
    @contextmenu="handleContextMenu"
  >
    <!-- 选择器 -->
    <div
      class="col-checkbox flex-none shrink-0 flex items-center justify-center px-3 py-2 min-w-0"
      :style="getFlexStyle('checkbox', true)"
      v-show="columnById['checkbox']?.visible ?? true"
    >
      <input
        type="checkbox"
        :checked="selected"
        @click="handleCheckboxClick"
        :aria-label="`选择种子 ${torrent.name}`"
        class="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-2 cursor-pointer transition-all duration-150"
      />
    </div>

    <!-- 种子名称与状态 -->
    <div
      class="col-torrent flex-initial px-3 py-2 min-w-0"
      :style="getFlexStyle('name')"
      v-show="columnById['name']?.visible ?? true"
    >
      <div class="flex items-center gap-3">
        <!-- 状态图标 -->
        <div class="flex-shrink-0">
          <Icon :name="getStateIcon(torrent.state).name" :color="getStateIcon(torrent.state).color" :size="16" />
        </div>

        <!-- 名称与基本信息 -->
        <div class="min-w-0 flex-1">
          <SafeText
            as="div"
            class="font-medium text-gray-900 truncate text-sm leading-5"
            :text="torrent.name"
          />
          <div class="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
            <span class="font-mono font-tabular">{{ formatBytes(torrent.size) }}</span>
            <span class="hidden sm:inline">•</span>
            <span class="hidden sm:inline">比率 {{ torrent.ratio.toFixed(2) }}</span>
            <span class="hidden md:inline">•</span>
            <span class="hidden md:inline" :title="getSwarmTitle(torrent)">
              做种 {{ getSwarmTexts(torrent).seeds }} • 下载 {{ getSwarmTexts(torrent).peers }}
            </span>
            <span class="hidden lg:inline">•</span>
            <span class="hidden lg:inline">健康度 {{ formatHealth(torrent) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 进度条 -->
    <div
      class="col-progress flex-initial px-3 py-2 min-w-0"
      :style="getFlexStyle('progress')"
      v-show="columnById['progress']?.visible ?? true"
    >
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-mono font-tabular text-gray-600">
            {{ (torrent.progress * 100).toFixed(1) }}%
          </span>
          <span class="text-xs text-gray-500">
            {{ formatBytes(torrent.size * torrent.progress) }}
          </span>
        </div>
        <div class="progress-bar">
          <div
            class="progress-fill"
            :class="{
              'bg-cyan-500': torrent.progress >= 1,
              'bg-blue-500': torrent.progress > 0 && torrent.progress < 1,
              'bg-gray-300': torrent.progress === 0
            }"
            :style="{ width: `${Math.max(torrent.progress * 100, 2)}%` }"
          />
        </div>
      </div>
    </div>

    <!-- 下载速度 -->
    <div
      class="col-dl-speed flex-initial px-3 py-2 text-right min-w-0"
      :style="getFlexStyle('dlSpeed')"
      v-show="columnById['dlSpeed']?.visible ?? true"
    >
      <div class="text-sm font-mono font-tabular text-gray-900 whitespace-nowrap">
        ↓ {{ formatSpeed(torrent.dlspeed) }}
      </div>
    </div>

    <!-- 上传速度 (PC端) -->
    <div
      class="col-ul-speed flex-initial px-3 py-2 text-right min-w-0"
      :class="{ 'hidden md:block': columnById['upSpeed']?.responsiveHidden === 'md' }"
      :style="getFlexStyle('upSpeed')"
      v-show="columnById['upSpeed']?.visible ?? true"
    >
      <div class="text-sm font-mono font-tabular text-gray-900 whitespace-nowrap">
        ↑ {{ formatSpeed(torrent.upspeed) }}
      </div>
    </div>

    <!-- ETA (大屏端) -->
    <div
      class="col-eta flex-initial px-3 py-2 text-right min-w-0"
      :class="{ 'hidden lg:flex': columnById['eta']?.responsiveHidden === 'lg' }"
      :style="getFlexStyle('eta')"
      v-show="columnById['eta']?.visible ?? true"
    >
      <div class="text-sm font-mono font-tabular text-gray-600">
        {{ formatETA(torrent.eta, torrent.progress, torrent.state) }}
      </div>
    </div>

    <!-- 操作按钮 -->
    <div
      class="flex-none shrink-0 px-3 py-2 min-w-0"
      :style="getFlexStyle('actions', true)"
      v-show="columnById['actions']?.visible ?? true"
    >
      <div class="flex items-center gap-1">
        <!-- 暂停/恢复切换 -->
        <button
          type="button"
          @click.stop="emit('action', torrent.state === 'paused' ? 'resume' : 'pause', torrent.id)"
          class="p-1 hover:bg-gray-100 rounded"
          :title="torrent.state === 'paused' ? '开始' : '暂停'"
          :aria-label="torrent.state === 'paused' ? '开始种子' : '暂停种子'"
        >
          <Icon :name="torrent.state === 'paused' ? 'play' : 'pause'" :size="14" />
        </button>

        <!-- 删除按钮 -->
        <button
          type="button"
          @click.stop="emit('action', 'delete', torrent.id)"
          class="p-1 hover:bg-red-50 text-red-600 rounded"
          title="删除"
          aria-label="删除种子"
        >
          <Icon name="trash-2" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Border between rows */
.torrent-row {
  border-bottom: 1px solid #e5e7eb;
}

.torrent-row:last-child {
  border-bottom: none;
}

.torrent-row:hover {
  background-color: rgba(0, 0, 0, 0.02);
}

/* Progress bar styles */
.progress-bar {
  position: relative;
  height: 4px;
  background-color: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease;
}
</style>
