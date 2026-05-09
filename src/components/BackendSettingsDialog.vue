<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { TransferSettings, BackendPreferences, BackendCapabilities } from '@/adapter/interface'
import { resolveInitialBackendSettingsTab, type BackendSettingsTabId } from '@/utils/backendSettingsTabs'
import Icon from '@/components/Icon.vue'
import SeedingTab from './settings/tabs/SeedingTab.vue'
import PathsTab from './settings/tabs/PathsTab.vue'

interface Props {
  open: boolean
  initialTab?: BackendSettingsTabId
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()
const adapter = computed(() => backendStore.adapter)

// 当前激活的 Tab
const activeTab = ref<BackendSettingsTabId>('transfer')

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const transferPartial = ref(false)

const contentScrollRef = ref<HTMLElement | null>(null)
const tabScrollTops = ref<Partial<Record<BackendSettingsTabId, number>>>({})

// 传输设置表单（使用 TransferSettings）
const transferForm = ref({
  downloadKbps: 0,
  uploadKbps: 0,
  altEnabled: false,
  altDownloadKbps: 0,
  altUploadKbps: 0,
})

const initialTransferForm = ref<typeof transferForm.value | null>(null)
const initialPrefsForm = ref<BackendPreferences | null>(null)

function deepClone<T>(input: T): T {
  const raw = toRaw(input as any) as any
  if (raw === null || typeof raw !== 'object') return raw as T
  if (Array.isArray(raw)) return raw.map(v => deepClone(v)) as any

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = deepClone(value)
  }
  return out as any
}

const encryptionLabels: Record<NonNullable<BackendPreferences['encryption']>, string> = {
  tolerate: '宽容（允许未加密）',
  prefer: '优先加密（允许回退）',
  require: '强制加密',
  disable: '禁用加密（强制不加密）',
}

// 偏好设置表单（使用 BackendPreferences）
const prefsForm = ref<BackendPreferences>({})

// 后端能力标记
const capabilities = computed<BackendCapabilities>(() => backendStore.capabilities)

const backendLabel = computed(() => {
  const caps = capabilities.value
  if (caps.hasProxy || caps.hasScheduler || caps.hasIPFilter || caps.hasCreateSubfolder) return 'qBittorrent'
  if (caps.hasTrashTorrentFiles || caps.hasBlocklist || caps.hasScripts) return 'Transmission'
  return backendStore.backendName
})

const localDiscoveryLabel = computed(() => (backendLabel.value === 'Transmission' ? 'LPD（本地发现）' : 'LSD（本地发现）'))

const speedBytes = ref(1024)
const speedUnitLabel = computed(() => (speedBytes.value === 1000 ? 'kB/s' : 'KiB/s'))

function toStableObject(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map(toStableObject)

  const obj = input as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const val = obj[key]
    if (val === undefined) continue
    out[key] = toStableObject(val)
  }
  return out
}

function stableStringify(input: unknown) {
  return JSON.stringify(toStableObject(input))
}

const isDirty = computed(() => {
  if (!initialTransferForm.value || !initialPrefsForm.value) return false
  return (
    stableStringify(transferForm.value) !== stableStringify(initialTransferForm.value) ||
    stableStringify(prefsForm.value) !== stableStringify(initialPrefsForm.value)
  )
})

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && isFinite(val)
}

function validatePreferences(): string | null {
  const caps = capabilities.value
  const prefs = prefsForm.value

  if (prefs.shareRatioLimited) {
    if (!isFiniteNumber(prefs.shareRatioLimit) || prefs.shareRatioLimit <= 0) {
      return '分享率限制已启用，但数值无效（需要大于 0，例如 1.0）。'
    }
  }

  if (prefs.seedingTimeLimited) {
    if (!isFiniteNumber(prefs.seedingTimeLimit) || prefs.seedingTimeLimit <= 0) {
      return '做种时间限制已启用，但数值无效（需要大于 0 的分钟数，例如 60）。'
    }
  }

  if (caps?.hasStalledQueue && prefs.queueStalledEnabled) {
    if (!isFiniteNumber(prefs.queueStalledMinutes) || prefs.queueStalledMinutes < 1) {
      return '队列停滞检测已启用，但停滞时间无效（需要大于等于 1 的分钟数，例如 30）。'
    }
  }

  return null
}

// qB 的队列开关是全局的（同时影响下载/做种队列）；保持表单字段同步，避免 UI 产生矛盾状态
watch(() => prefsForm.value.queueDownloadEnabled, (val) => {
  if (capabilities.value?.hasSeparateSeedQueue !== false) return
  if (val === undefined) return
  if (prefsForm.value.queueSeedEnabled !== val) {
    prefsForm.value.queueSeedEnabled = val
  }
})

function saveScrollTop(tab: BackendSettingsTabId) {
  const el = contentScrollRef.value
  if (!el) return
  tabScrollTops.value[tab] = el.scrollTop
}

function restoreScrollTop(tab: BackendSettingsTabId) {
  const el = contentScrollRef.value
  if (!el) return
  el.scrollTop = tabScrollTops.value[tab] ?? 0
}

watch(activeTab, (next, prev) => {
  if (!prev) return
  saveScrollTop(prev)
  // 等待 DOM 切换后再还原滚动位置
  queueMicrotask(() => restoreScrollTop(next))
})

// Tab 配置
const tabs = computed(() => {
  const caps = capabilities.value
  return [
    { id: 'transfer' as BackendSettingsTabId, label: '带宽', visible: true },
    { id: 'connection' as BackendSettingsTabId, label: '连接', visible: true },
    { id: 'queue' as BackendSettingsTabId, label: '队列', visible: true },
    { id: 'port' as BackendSettingsTabId, label: '端口', visible: true },
    { id: 'protocol' as BackendSettingsTabId, label: '协议', visible: true },
    {
      id: 'seeding' as BackendSettingsTabId,
      label: '做种',
      visible: !!caps && (caps.hasSeedingRatioLimit || caps.hasSeedingTimeLimit || caps.hasStalledQueue),
    },
    {
      id: 'paths' as BackendSettingsTabId,
      label: '路径',
      visible: !!caps && (caps.hasDefaultSavePath || caps.hasIncompleteDir || caps.hasCreateSubfolder || caps.hasIncompleteFilesSuffix),
    },
  ].filter(t => t.visible)
})

function syncInitialTab() {
  activeTab.value = resolveInitialBackendSettingsTab(tabs.value, props.initialTab)
}

function toKbps(bytesPerSecond: number) {
  return Math.max(0, Math.round(bytesPerSecond / speedBytes.value))
}

function toBps(kbps: number) {
  return Math.max(0, Math.round(kbps)) * speedBytes.value
}

function resetToLoaded() {
  if (!initialTransferForm.value || !initialPrefsForm.value) return
  transferForm.value = deepClone(initialTransferForm.value)
  prefsForm.value = deepClone(initialPrefsForm.value)
}

async function load() {
  if (!props.open) return
  if (!adapter.value) {
    error.value = '未连接到后端'
    return
  }
  loading.value = true
  error.value = ''
  transferPartial.value = false
  backendStore.settingsLoadedPartial = false
  try {
    saveScrollTop(activeTab.value)
    // 并行加载传输设置和偏好设置
    const [transferSettings, preferences] = await Promise.all([
      adapter.value.getTransferSettings(),
      adapter.value.getPreferences()
    ])

    transferPartial.value = Boolean(transferSettings.partial)
    backendStore.settingsLoadedPartial = transferPartial.value

    speedBytes.value = transferSettings.speedBytes ?? 1024

    transferForm.value = {
      downloadKbps: toKbps(transferSettings.downloadLimit),
      uploadKbps: toKbps(transferSettings.uploadLimit),
      altEnabled: transferSettings.altEnabled,
      altDownloadKbps: toKbps(transferSettings.altDownloadLimit),
      altUploadKbps: toKbps(transferSettings.altUploadLimit),
    }

    prefsForm.value = preferences
    initialTransferForm.value = deepClone(transferForm.value)
    initialPrefsForm.value = deepClone(preferences)
    restoreScrollTop(activeTab.value)
  } catch (e) {
    console.error('[BackendSettingsDialog] Load failed:', e)
    error.value = e instanceof Error ? e.message : '加载设置失败'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!adapter.value) return
  if (!isDirty.value) {
    emit('close')
    return
  }
  const validationError = validatePreferences()
  if (validationError) {
    error.value = validationError
    return
  }
  saving.value = true
  error.value = ''
  try {
    // 保存传输设置（diff）
    if (initialTransferForm.value) {
      const transferPatch: Partial<TransferSettings> = {}
      if (transferForm.value.downloadKbps !== initialTransferForm.value.downloadKbps) {
        transferPatch.downloadLimit = toBps(transferForm.value.downloadKbps)
      }
      if (transferForm.value.uploadKbps !== initialTransferForm.value.uploadKbps) {
        transferPatch.uploadLimit = toBps(transferForm.value.uploadKbps)
      }
      if (transferForm.value.altEnabled !== initialTransferForm.value.altEnabled) {
        transferPatch.altEnabled = transferForm.value.altEnabled
      }
      if (transferForm.value.altDownloadKbps !== initialTransferForm.value.altDownloadKbps) {
        transferPatch.altDownloadLimit = toBps(transferForm.value.altDownloadKbps)
      }
      if (transferForm.value.altUploadKbps !== initialTransferForm.value.altUploadKbps) {
        transferPatch.altUploadLimit = toBps(transferForm.value.altUploadKbps)
      }
      await adapter.value.setTransferSettings(transferPatch)
    }

    // 保存偏好设置（diff）
    if (initialPrefsForm.value) {
      const prefPatch: Partial<BackendPreferences> = {}
      const prev = initialPrefsForm.value as Record<string, unknown>
      const next = prefsForm.value as Record<string, unknown>
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
      for (const key of keys) {
        if (stableStringify(prev[key]) === stableStringify(next[key])) continue
        prefPatch[key as keyof BackendPreferences] = next[key] as any
      }
      await adapter.value.setPreferences(prefPatch)
    }

    initialTransferForm.value = deepClone(transferForm.value)
    initialPrefsForm.value = deepClone(prefsForm.value)
    emit('close')
  } catch (e) {
    console.error('[BackendSettingsDialog] Save failed:', e)
    error.value = e instanceof Error ? e.message : '保存设置失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.open, (open) => {
  if (!open) return
  syncInitialTab()
  load()
})

onMounted(() => {
  if (!props.open) return
  syncInitialTab()
  load()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      @click.self="emit('close')"
    >
      <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
        <!-- 头部 -->
        <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">后端设置</h2>
              <p class="text-xs text-gray-500">{{ backendStore.backendName }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="isDirty" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                已修改
              </span>
              <button class="btn" :disabled="loading || saving" @click="load">重新加载</button>
              <button class="btn" :disabled="!isDirty || loading || saving" @click="resetToLoaded">还原</button>
            </div>
          </div>
        </div>

        <!-- Tab 导航 -->
        <div class="border-b border-gray-200 px-4 sm:px-6">
          <nav class="flex flex-nowrap gap-4 sm:gap-6 -mb-px overflow-x-auto max-w-full">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="activeTab = tab.id"
              :class="`px-1 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`"
            >
              {{ tab.label }}
            </button>
          </nav>
        </div>

        <!-- 内容区 -->
        <div ref="contentScrollRef" class="flex-1 overflow-auto p-4 sm:p-6">
          <div v-if="loading" class="text-sm text-gray-500">加载中...</div>

          <div v-else class="space-y-4">
            <div v-if="error" class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {{ error }}
            </div>

            <!-- 带宽 Tab -->
            <div v-if="activeTab === 'transfer'" class="space-y-4">
              <div v-if="transferPartial" class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex gap-2">
                <Icon name="alert-triangle" :size="16" class="shrink-0 mt-0.5" />
                <div>部分传输设置读取失败，当前显示值可能不准确（0 可能是占位）；保存只会写入你修改过的字段。</div>
              </div>

              <div class="card p-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="text-sm font-medium text-gray-900">全局限速</div>
                  <div class="text-xs text-gray-500">单位：{{ speedUnitLabel }}（0 表示不限制）</div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">下载</span>
                    <input v-model.number="transferForm.downloadKbps" type="number" min="0" class="input" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">上传</span>
                    <input v-model.number="transferForm.uploadKbps" type="number" min="0" class="input" />
                  </label>
                </div>
              </div>

              <div class="card p-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="text-sm font-medium text-gray-900">备用限速（ALT）</div>
                  <label class="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input v-model="transferForm.altEnabled" type="checkbox" class="rounded border-gray-300 text-blue-500 focus:ring-blue-500/20" />
                    启用
                  </label>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">下载</span>
                    <input v-model.number="transferForm.altDownloadKbps" type="number" min="0" class="input" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">上传</span>
                    <input v-model.number="transferForm.altUploadKbps" type="number" min="0" class="input" />
                  </label>
                </div>
              </div>
            </div>

            <!-- 连接 Tab -->
            <div v-if="activeTab === 'connection'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">连接限制</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">全局最大连接数</span>
                    <input v-model.number="prefsForm.maxConnections" type="number" min="0" class="input" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-xs text-gray-500">单种子最大连接数</span>
                    <input v-model.number="prefsForm.maxConnectionsPerTorrent" type="number" min="0" class="input" />
                  </label>
                </div>
              </div>
            </div>

            <!-- 队列 Tab -->
            <div v-if="activeTab === 'queue'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">下载队列</h3>
                <div class="space-y-3">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.queueDownloadEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">
                      {{ capabilities?.hasSeparateSeedQueue === false ? '启用队列（下载/做种）' : '启用下载队列' }}
                    </span>
                  </label>
                  <label v-if="prefsForm.queueDownloadEnabled" class="space-y-1">
                    <span class="text-xs text-gray-500">同时下载数</span>
                    <input v-model.number="prefsForm.queueDownloadMax" type="number" min="1" class="input" />
                  </label>
                </div>
              </div>

              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">做种队列</h3>
                <div class="space-y-3">
                  <label class="flex items-center gap-2">
                    <input
                      v-if="capabilities?.hasSeparateSeedQueue === false"
                      :checked="prefsForm.queueDownloadEnabled"
                      type="checkbox"
                      class="rounded"
                      disabled
                    />
                    <input
                      v-else
                      v-model="prefsForm.queueSeedEnabled"
                      type="checkbox"
                      class="rounded"
                    />
                    <span class="text-sm">启用做种队列</span>
                    <span v-if="capabilities?.hasSeparateSeedQueue === false" class="text-xs text-gray-500">（由全局队列开关控制）</span>
                  </label>
                  <label v-if="prefsForm.queueSeedEnabled" class="space-y-1">
                    <span class="text-xs text-gray-500">同时做种数</span>
                    <input v-model.number="prefsForm.queueSeedMax" type="number" min="1" class="input" />
                  </label>
                </div>
              </div>
            </div>

            <!-- 端口 Tab -->
            <div v-if="activeTab === 'port'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">监听端口</h3>
                <div class="space-y-3">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.randomPort" type="checkbox" class="rounded" />
                    <span class="text-sm">随机端口</span>
                  </label>
                  <label v-if="!prefsForm.randomPort" class="space-y-1">
                    <span class="text-xs text-gray-500">端口号（1-65535）</span>
                    <input v-model.number="prefsForm.listenPort" type="number" min="1" max="65535" class="input" />
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.upnpEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">UPnP 端口映射</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- 协议 Tab -->
            <div v-if="activeTab === 'protocol'" class="space-y-4">
              <div class="card p-4">
                <h3 class="text-sm font-medium mb-3">协议支持</h3>
                <div class="space-y-2">
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.dhtEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">启用 DHT</span>
                  </label>
                  <label class="flex items-center gap-2">
                    <input v-model="prefsForm.pexEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">启用 PeX</span>
                  </label>
                  <label v-if="capabilities?.hasLSD" class="flex items-center gap-2">
                    <input v-model="prefsForm.lsdEnabled" type="checkbox" class="rounded" />
                    <span class="text-sm">启用 {{ localDiscoveryLabel }}</span>
                  </label>
                </div>
              </div>

              <div v-if="capabilities?.hasEncryption" class="card p-4">
                <h3 class="text-sm font-medium mb-3">加密模式</h3>
                <div class="space-y-2">
                  <label
                    v-for="mode in capabilities.encryptionModes"
                    :key="mode"
                    class="flex items-center gap-2"
                  >
                    <input v-model="prefsForm.encryption" type="radio" :value="mode" class="rounded" />
                    <span class="text-sm">{{ encryptionLabels[mode] }}</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- 做种 Tab -->
            <SeedingTab
              v-if="activeTab === 'seeding' && capabilities"
              v-model="prefsForm"
              :capabilities="capabilities"
            />

            <!-- 路径 Tab -->
            <PathsTab
              v-if="activeTab === 'paths' && capabilities"
              v-model="prefsForm"
              :capabilities="capabilities"
            />
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="border-t border-gray-200 p-4 bg-gray-50 flex justify-end gap-2">
          <button class="btn" :disabled="saving" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="saving || loading || !isDirty" @click="save">
            <span v-if="saving">保存中...</span>
            <span v-else>{{ isDirty ? '保存' : '无更改' }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
