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

const savePath = computed({
  get: () => props.modelValue.savePath ?? '',
  set: (val: string) => update({ savePath: val.trim() ? val : undefined })
})

const incompleteDirEnabled = computed({
  get: () => Boolean(props.modelValue.incompleteDirEnabled),
  set: (val: boolean) => update({ incompleteDirEnabled: val })
})

const incompleteDir = computed({
  get: () => props.modelValue.incompleteDir ?? '',
  set: (val: string) => update({ incompleteDir: val.trim() ? val : undefined })
})

const createSubfolderEnabled = computed({
  get: () => Boolean(props.modelValue.createSubfolderEnabled),
  set: (val: boolean) => update({ createSubfolderEnabled: val })
})

const incompleteFilesSuffix = computed({
  get: () => Boolean(props.modelValue.incompleteFilesSuffix),
  set: (val: boolean) => update({ incompleteFilesSuffix: val })
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

const incompleteSuffix = computed(() => (backendLabel.value === 'Transmission' ? '.part' : '.!qB'))
</script>

<template>
  <div class="space-y-4">
    <!-- 默认保存路径 -->
    <div v-if="capabilities.hasDefaultSavePath" class="card p-4">
      <h3 class="text-sm font-medium mb-3">默认保存路径</h3>
      <label class="space-y-1">
        <span class="text-xs text-slate-500">所有新种子默认保存到此目录（建议使用绝对路径）</span>
        <input
          v-model="savePath"
          type="text"
          class="input"
          placeholder="/path/to/downloads"
          spellcheck="false"
          autocomplete="off"
        />
      </label>
    </div>

    <!-- 未完成下载目录 -->
    <div v-if="capabilities.hasIncompleteDir" class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium">未完成下载目录</h3>
        <label class="inline-flex items-center gap-2 text-sm">
          <input v-model="incompleteDirEnabled" type="checkbox" class="rounded" />
          启用
        </label>
      </div>
      <label v-if="incompleteDirEnabled" class="space-y-1">
        <span class="text-xs text-slate-500">未下载完的文件将保存到此目录</span>
        <input
          v-model="incompleteDir"
          type="text"
          class="input"
          placeholder="/path/to/incomplete"
          spellcheck="false"
          autocomplete="off"
        />
      </label>
      <p v-if="incompleteDirEnabled && !incompleteDir" class="text-xs text-amber-700 mt-2">
        已启用但路径为空：后端可能会忽略该设置。
      </p>
    </div>

    <!-- 添加种子时创建子文件夹（qB） -->
    <div v-if="capabilities.hasCreateSubfolder" class="card p-4">
      <h3 class="text-sm font-medium mb-3">添加行为</h3>
      <label class="flex items-center gap-2">
        <input v-model="createSubfolderEnabled" type="checkbox" class="rounded" />
        <span class="text-sm">添加种子时创建子文件夹</span>
      </label>
      <p class="text-xs text-slate-500 mt-2">适合多文件种子，避免文件直接散落在默认保存路径下。</p>
    </div>

    <!-- 未完成文件后缀 -->
    <div v-if="capabilities.hasIncompleteFilesSuffix" class="card p-4">
      <h3 class="text-sm font-medium mb-3">未完成文件标记</h3>
      <label class="flex items-center gap-2">
        <input v-model="incompleteFilesSuffix" type="checkbox" class="rounded" />
        <span class="text-sm">给未完成文件添加后缀</span>
      </label>
      <p class="text-xs text-slate-500 mt-2">
        {{ backendLabel }} 将在未完成文件末尾追加 <span class="font-mono">{{ incompleteSuffix }}</span>
      </p>
    </div>
  </div>
</template>
