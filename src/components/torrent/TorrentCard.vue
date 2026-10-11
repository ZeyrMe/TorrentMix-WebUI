<script setup lang="ts">
import { computed } from 'vue'
import type { UnifiedTorrent } from '@/adapter/types'
import { formatBytes, formatSpeed, formatEta } from '@/utils/format'
import { getSwarmTexts, getSwarmTitle } from '@/utils/swarm'
import { getStateMeta } from '@/utils/torrentState'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'

const props = defineProps<{ torrent: UnifiedTorrent; selected: boolean }>()

defineEmits<{
  click: []
}>()

function isNestedInteractiveTarget(event: KeyboardEvent) {
  const target = event.target
  const currentTarget = event.currentTarget
  if (!(target instanceof HTMLElement) || !(currentTarget instanceof HTMLElement)) return false

  const interactive = target.closest('button, input, select, textarea, a, [role="button"]')
  return interactive !== null && interactive !== currentTarget
}

function handleCardKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  if (isNestedInteractiveTarget(e)) return
  e.preventDefault()
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).click()
}

// 处理复选框点击
function handleCheckboxClick(e: Event) {
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).dispatchEvent(new CustomEvent('toggle-select', {
    bubbles: true,
    detail: props.torrent.id
  }))
}

const swarmTexts = computed(() => getSwarmTexts(props.torrent))
const stateMeta = computed(() => getStateMeta(props.torrent.state))
</script>

<template>
  <div
    class="card p-4 cursor-pointer transition-shadow duration-150 hover:shadow-md active:scale-[0.98]"
    :class="{ 'ring-2 ring-blue-200 border-blue-300': selected }"
    role="button"
    tabindex="0"
    :aria-label="`查看种子 ${torrent.name}`"
    @click.stop="$emit('click')"
    @keydown="handleCardKeydown"
  >
    <!-- 头部：名称和状态 -->
    <div class="flex items-start justify-between gap-3 mb-3">
      <!-- 选择器 -->
      <div class="mt-1" @click.stop="handleCheckboxClick">
        <input
          type="checkbox"
          :checked="selected"
          :aria-label="`选择种子 ${torrent.name}`"
          class="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500/20 focus:ring-offset-0 focus:ring-2 cursor-pointer"
        />
      </div>

      <!-- 种子信息 -->
      <div class="flex-1 min-w-0">
        <SafeText
          as="h3"
          class="font-medium text-slate-900 text-sm leading-5 mb-2 line-clamp-2"
          :text="torrent.name"
        />

        <!-- 状态标签 -->
        <div class="flex items-center gap-2">
          <span
            class="status-badge px-2 py-1"
            :class="[stateMeta.bgClass]"
          >
            <Icon :name="stateMeta.icon" :color="stateMeta.color" :size="12" />
            <span class="ml-1" :class="stateMeta.textClass">{{ stateMeta.label }}</span>
          </span>
          <span class="text-xs text-slate-500 font-mono font-tabular">
            {{ formatBytes(torrent.size) }}
          </span>
          <span class="text-xs text-slate-500 font-mono font-tabular" :title="getSwarmTitle(torrent)">
            做种 {{ swarmTexts.seeds }} • 下载 {{ swarmTexts.peers }}
          </span>
        </div>
      </div>
    </div>

    <!-- 进度条 -->
    <div class="mb-3">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="font-mono font-tabular text-slate-600">{{ (torrent.progress * 100).toFixed(1) }}%</span>
        <span class="text-slate-500">{{ formatBytes(torrent.size * torrent.progress) }}</span>
      </div>
      <div class="progress-bar">
        <div
          class="progress-fill"
          :class="{
            'bg-cyan-500': torrent.progress >= 1,
            'bg-blue-500': torrent.progress > 0 && torrent.progress < 1,
            'bg-slate-300': torrent.progress === 0
          }"
          :style="{ width: `${Math.max(torrent.progress * 100, 2)}%` }"
        />
      </div>
    </div>

    <!-- 底部信息：速度和时间 -->
    <div class="flex items-center justify-between text-xs">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <Icon name="download" color="blue" :size="12" />
          <span class="font-mono font-tabular text-slate-700">{{ formatSpeed(torrent.dlspeed) }}</span>
        </div>
        <div class="flex items-center gap-1">
          <Icon name="upload-cloud" color="cyan" :size="12" />
          <span class="font-mono font-tabular text-slate-700">{{ formatSpeed(torrent.upspeed) }}</span>
        </div>
      </div>

      <div class="text-slate-500 font-mono font-tabular">
        比率 {{ torrent.ratio.toFixed(2) }}
      </div>
    </div>

    <!-- ETA (仅在下载时显示) -->
    <div v-if="torrent.state === 'downloading' && torrent.eta > 0" class="mt-2 pt-2 border-t border-slate-200">
      <div class="text-xs text-slate-500 flex items-center gap-1">
        <Icon name="clock" color="gray" :size="12" />
        <span>剩余 {{ formatEta(torrent.eta, torrent.progress, torrent.state) }}</span>
      </div>
    </div>
  </div>
</template>
