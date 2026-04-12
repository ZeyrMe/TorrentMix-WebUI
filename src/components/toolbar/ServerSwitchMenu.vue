<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import Icon from '@/components/Icon.vue'
import StandaloneConfigDialog from './StandaloneConfigDialog.vue'

type BackendType = 'qbit' | 'trans'

type StandaloneServer = {
  id: string
  name: string
  type: BackendType
  baseUrl: string
  latencyMs?: number
  reachable: boolean
}

type StandaloneStatus = {
  schema: number
  selectedId: string
  servers: StandaloneServer[]
}

const rootRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const available = ref(false)
const loading = ref(false)
const switching = ref(false)
const errorText = ref('')
const status = ref<StandaloneStatus | null>(null)
const configOpen = ref(false)

const selectedServer = computed(() => {
  const s = status.value
  if (!s) return null
  return s.servers.find(v => v.id === s.selectedId) ?? null
})

const buttonTitle = computed(() => {
  const name = selectedServer.value?.name
  return name ? `切换服务器（当前：${name}）` : '切换服务器'
})

function typeLabel(type: BackendType): string {
  return type === 'qbit' ? 'qB' : 'TR'
}

function latencyLabel(s: StandaloneServer): string {
  if (!s.reachable) return '不可达'
  if (typeof s.latencyMs === 'number' && Number.isFinite(s.latencyMs)) return `${s.latencyMs} ms`
  return '—'
}

async function fetchStatus(silentMissing = false) {
  loading.value = true
  errorText.value = ''
  try {
    const res = await fetch('/__standalone__/status', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as Partial<StandaloneStatus>
    if (!data || !Array.isArray(data.servers)) throw new Error('invalid response')
    status.value = data as StandaloneStatus
    available.value = true
  } catch (err) {
    status.value = null
    available.value = false
    if (!silentMissing) {
      errorText.value = (err as any)?.message || String(err)
    }
  } finally {
    loading.value = false
  }
}

function toggle() {
  if (!available.value) return
  isOpen.value = !isOpen.value
  if (isOpen.value) void fetchStatus()
}

function openConfig() {
  if (!available.value) return
  configOpen.value = true
  isOpen.value = false
}

function handleConfigSaved() {
  configOpen.value = false
  location.reload()
}

async function handleSwitch(id: string) {
  if (switching.value) return
  if (id === status.value?.selectedId) {
    isOpen.value = false
    return
  }

  switching.value = true
  errorText.value = ''
  try {
    const res = await fetch('/__standalone__/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `HTTP ${res.status}`)
    }

    location.reload()
  } catch (err) {
    errorText.value = (err as any)?.message || String(err)
  } finally {
    switching.value = false
  }
}

onClickOutside(rootRef, () => {
  isOpen.value = false
})

onMounted(() => {
  void fetchStatus(true)
})
</script>

<template>
  <div v-if="available" ref="rootRef" class="relative">
    <button type="button" @click.stop="toggle" class="icon-btn" :title="buttonTitle" :aria-label="buttonTitle">
      <Icon name="server" :size="16" />
    </button>

    <div
      v-if="isOpen"
      class="absolute right-0 top-full mt-1 bg-white border border-gray-200 shadow-lg rounded-lg py-1 z-50 min-w-[260px] max-w-[min(92vw,22rem)]"
    >
      <div class="px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-100 flex items-center justify-between gap-2">
        <span class="truncate">切换服务器</span>
        <button type="button" class="icon-btn" title="刷新延迟" aria-label="刷新服务器延迟" :disabled="loading" @click.stop="fetchStatus()">
          <Icon name="refresh-cw" :size="14" :class="{ 'animate-spin': loading }" />
        </button>
      </div>

      <div v-if="loading" class="px-3 py-2 text-xs text-gray-500">
        加载中…
      </div>

      <template v-else>
        <button
          type="button"
          v-for="s in status?.servers ?? []"
          :key="s.id"
          class="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="switching"
          @click="handleSwitch(s.id)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium truncate">{{ s.name }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">{{ typeLabel(s.type) }}</span>
            <span class="text-xs text-gray-500 shrink-0 ml-auto">{{ latencyLabel(s) }}</span>
            <Icon v-if="s.id === status?.selectedId" name="check-circle" :size="14" class="text-green-600 shrink-0" />
          </div>
          <div class="text-[11px] text-gray-400 mt-0.5 truncate">
            {{ s.baseUrl }}
          </div>
        </button>

        <div v-if="errorText" class="px-3 py-2 text-xs text-red-600 whitespace-pre-wrap border-t border-gray-100">
          {{ errorText }}
        </div>

        <div class="px-3 py-2 border-t border-gray-100">
          <button type="button" class="btn w-full" :disabled="switching" @click.stop="openConfig">
            <Icon name="settings" :size="16" class="mr-2" />
            管理服务器
          </button>
        </div>

        <div class="px-3 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          仅 Standalone Service 模式可用
        </div>
      </template>
    </div>
  </div>

  <StandaloneConfigDialog
    :open="configOpen"
    @close="configOpen = false"
    @saved="handleConfigSaved"
  />
</template>
