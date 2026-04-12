<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import { formatBytes, formatSpeed } from '@/utils/format'

interface Props {
  versionDisplay: string
  hasVersionError: boolean
  downloadingCount: number
  seedingCount: number
  totalSize: number
  dlSpeed: number
  upSpeed: number
  dlRateLimit: number
  upRateLimit: number
  useAltSpeed: boolean
  showConnectionIndicator: boolean
  connectionStatusText: string
  connectionStatusType: 'success' | 'warning' | 'error'
}

defineProps<Props>()
</script>

<template>
  <div class="relative border-t border-gray-200 bg-gray-50 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-xs text-gray-500 shrink-0">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="order-2 flex items-center gap-3 sm:order-1">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <span v-if="versionDisplay" class="text-gray-400">{{ versionDisplay }}</span>
          <div v-else-if="hasVersionError" class="flex items-center gap-1 text-amber-600">
            <Icon name="alert-triangle" :size="12" />
            <span>版本检测失败</span>
          </div>
          <div class="h-3 w-px bg-gray-300"></div>
          <div class="flex items-center gap-2">
            <div class="h-2 w-2 rounded-full bg-blue-500"></div>
            <span class="font-medium text-gray-700">{{ downloadingCount }}</span>
            <span>下载中</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="h-2 w-2 rounded-full bg-cyan-500"></div>
            <span class="font-medium text-gray-700">{{ seedingCount }}</span>
            <span>做种中</span>
          </div>
          <div class="hidden items-center gap-2 lg:flex">
            <span>总大小</span>
            <span class="font-mono font-medium text-gray-700">{{ formatBytes(totalSize) }}</span>
          </div>
        </div>
      </div>

      <div class="order-1 flex w-full items-center justify-between gap-4 font-mono text-xs sm:order-2 sm:w-auto sm:justify-end">
        <div class="flex items-center gap-1">
          <span class="text-gray-500">↓</span>
          <span class="font-medium">{{ formatSpeed(dlSpeed) }}</span>
          <span
            v-if="dlRateLimit > 0"
            class="ml-0.5 text-[10px] text-gray-400"
            :title="`下载限速: ${formatSpeed(dlRateLimit)}`"
          >
            / {{ formatSpeed(dlRateLimit) }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-gray-500">↑</span>
          <span class="font-medium">{{ formatSpeed(upSpeed) }}</span>
          <span
            v-if="upRateLimit > 0"
            class="ml-0.5 text-[10px] text-gray-400"
            :title="`上传限速: ${formatSpeed(upRateLimit)}`"
          >
            / {{ formatSpeed(upRateLimit) }}
          </span>
        </div>
        <div
          v-if="useAltSpeed"
          class="ml-2 flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
          title="备用速度限制已启用"
        >
          <Icon name="gauge" :size="10" />
          <span>ALT</span>
        </div>
      </div>
    </div>

    <div v-if="showConnectionIndicator" class="absolute right-4 bottom-2" :title="connectionStatusText">
      <div
        :class="`h-2 w-2 rounded-full ${
          connectionStatusType === 'success' ? 'bg-green-500' :
          connectionStatusType === 'warning' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
        }`"
      ></div>
    </div>
  </div>
</template>
