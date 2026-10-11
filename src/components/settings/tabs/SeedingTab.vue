<script setup lang="ts">
import { computed } from 'vue'
import type { BackendPreferences, BackendCapabilities } from '@/adapter/interface'

interface Props {
  modelValue: BackendPreferences
  capabilities: BackendCapabilities
}

interface Emits {
  (e: 'update:modelValue', value: BackendPreferences): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

function update(patch: Partial<BackendPreferences>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

const shareRatioLimited = computed({
  get: () => Boolean(props.modelValue.shareRatioLimited),
  set: (val: boolean) => {
    const next: Partial<BackendPreferences> = { shareRatioLimited: val }
    if (val) {
      const current = props.modelValue.shareRatioLimit
      if (typeof current !== 'number' || !isFinite(current) || current <= 0) {
        next.shareRatioLimit = 1.0
      }
    }
    update(next)
  }
})

const shareRatioLimitInput = computed({
  get: () => (typeof props.modelValue.shareRatioLimit === 'number' ? String(props.modelValue.shareRatioLimit) : ''),
  set: (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      update({ shareRatioLimit: undefined })
      return
    }
    const num = Number(trimmed)
    update({ shareRatioLimit: isFinite(num) ? num : undefined })
  }
})

const seedingTimeLimited = computed({
  get: () => Boolean(props.modelValue.seedingTimeLimited),
  set: (val: boolean) => {
    const next: Partial<BackendPreferences> = { seedingTimeLimited: val }
    if (val) {
      const current = props.modelValue.seedingTimeLimit
      if (typeof current !== 'number' || !isFinite(current) || current <= 0) {
        next.seedingTimeLimit = 60
      }
    }
    update(next)
  }
})

const seedingTimeLimitInput = computed({
  get: () => (typeof props.modelValue.seedingTimeLimit === 'number' ? String(props.modelValue.seedingTimeLimit) : ''),
  set: (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      update({ seedingTimeLimit: undefined })
      return
    }
    const num = Math.floor(Number(trimmed))
    update({ seedingTimeLimit: isFinite(num) ? num : undefined })
  }
})

const queueStalledEnabled = computed({
  get: () => Boolean(props.modelValue.queueStalledEnabled),
  set: (val: boolean) => {
    const next: Partial<BackendPreferences> = { queueStalledEnabled: val }
    if (val) {
      const current = props.modelValue.queueStalledMinutes
      if (typeof current !== 'number' || !isFinite(current) || current < 1) {
        next.queueStalledMinutes = 30
      }
    }
    update(next)
  }
})

const queueStalledMinutesInput = computed({
  get: () => (typeof props.modelValue.queueStalledMinutes === 'number' ? String(props.modelValue.queueStalledMinutes) : ''),
  set: (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      update({ queueStalledMinutes: undefined })
      return
    }
    const num = Math.floor(Number(trimmed))
    update({ queueStalledMinutes: isFinite(num) ? num : undefined })
  }
})

const backendLabel = computed(() => {
  if (props.capabilities.hasProxy || props.capabilities.hasScheduler || props.capabilities.hasIPFilter || props.capabilities.hasCreateSubfolder) {
    return 'qBittorrent'
  }
  if (props.capabilities.hasTrashTorrentFiles || props.capabilities.hasBlocklist || props.capabilities.hasScripts) {
    return 'Transmission'
  }
  return '后端'
})
</script>

<template>
  <div class="space-y-4">
    <!-- 分享率限制 -->
    <div v-if="capabilities.hasSeedingRatioLimit" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium">分享率限制</h3>
        <label class="inline-flex items-center gap-2 text-sm">
          <input v-model="shareRatioLimited" type="checkbox" class="rounded" />
          启用
        </label>
      </div>
      <label v-if="shareRatioLimited" class="space-y-1">
        <span class="text-xs text-slate-500">达到分享率后停止做种（关闭开关表示不限制）</span>
        <input v-model="shareRatioLimitInput" type="number" min="0" step="0.1" class="input" placeholder="例如：1.0" />
      </label>
      <p v-if="shareRatioLimited && (!modelValue.shareRatioLimit || modelValue.shareRatioLimit <= 0)" class="text-xs text-amber-700 mt-2">
        已启用但值无效：建议设置为大于 0 的数值（例如 1.0）。
      </p>
    </div>

    <!-- 做种时间限制 -->
    <div v-if="capabilities.hasSeedingTimeLimit" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium">
          {{ capabilities.seedingTimeLimitMode === 'idle' ? '空闲做种限制' : '做种时间限制' }}
        </h3>
        <label class="inline-flex items-center gap-2 text-sm">
          <input v-model="seedingTimeLimited" type="checkbox" class="rounded" />
          启用
        </label>
      </div>
      <p class="text-xs text-slate-500 mb-3">
        {{ capabilities.seedingTimeLimitMode === 'idle' ? `${backendLabel}：按空闲时长停止做种。` : `${backendLabel}：按做种总时长停止做种。` }}
      </p>
      <label v-if="seedingTimeLimited" class="space-y-1">
        <span class="text-xs text-slate-500">
          {{ capabilities.seedingTimeLimitMode === 'idle' ? '空闲时长（分钟）' : '做种时长（分钟）' }}
        </span>
        <input v-model="seedingTimeLimitInput" type="number" min="0" class="input" placeholder="例如：60" />
      </label>
      <p v-if="seedingTimeLimited && (!modelValue.seedingTimeLimit || modelValue.seedingTimeLimit <= 0)" class="text-xs text-amber-700 mt-2">
        已启用但值无效：建议设置为大于 0 的分钟数（例如 60）。
      </p>
    </div>

    <!-- 队列停滞检测（TR） -->
    <div v-if="capabilities.hasStalledQueue" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium">队列停滞检测</h3>
        <label class="inline-flex items-center gap-2 text-sm">
          <input v-model="queueStalledEnabled" type="checkbox" class="rounded" />
          启用
        </label>
      </div>
      <label v-if="queueStalledEnabled" class="space-y-1">
        <span class="text-xs text-slate-500">停滞时间（分钟）</span>
        <input v-model="queueStalledMinutesInput" type="number" min="1" class="input" placeholder="例如：30" />
      </label>
      <p v-if="queueStalledEnabled && (!modelValue.queueStalledMinutes || modelValue.queueStalledMinutes < 1)" class="text-xs text-amber-700 mt-2">
        已启用但值无效：建议设置为大于等于 1 的分钟数（例如 30）。
      </p>
    </div>
  </div>
</template>
