<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { UnifiedTorrentDetail } from '@/adapter/types'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
import { formatBytes, formatSpeed, formatDuration } from '@/utils/format'
import { isVirtualExternalPath, stripVirtualExternalPrefix } from '@/utils/folderTree'
import { useUiOverlay } from '@/composables/useUiOverlay'

interface Props {
  open: boolean
  hash: string | null
}

interface Emits {
  (e: 'close'): void
  (e: 'refresh'): void  // 新增：操作完成后请求刷新
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()
const overlay = useUiOverlay()

// 详情数据
const detail = ref<UnifiedTorrentDetail | null>(null)
const loading = ref(false)
const error = ref('')
const actionLoading = ref(false)  // 操作加载状态

// 当前 Tab
const activeTab = ref<'info' | 'files' | 'trackers' | 'peers'>('info')

// 更多操作菜单显示状态
const showMoreMenu = ref(false)

// 限速编辑状态
const showLimitDialog = ref(false)
const dlLimitInput = ref('')
const upLimitInput = ref('')

const speedBytes = ref(1024)
const speedUnitLabel = computed(() => (speedBytes.value === 1000 ? 'kB/s' : 'KiB/s'))

async function ensureSpeedBytes() {
  if (!backendStore.adapter) return
  if (!backendStore.isTrans) {
    speedBytes.value = 1024
    return
  }

  try {
    const settings = await backendStore.adapter.getTransferSettings()
    const sb = settings.speedBytes
    if (typeof sb === 'number' && Number.isFinite(sb) && sb > 0) {
      speedBytes.value = sb
    }
  } catch (err) {
    console.warn('[TorrentDetailDrawer] Failed to load speedBytes, fallback 1024:', err)
    speedBytes.value = 1024
  }
}

// 获取详情
async function fetchDetail() {
  if (!props.hash || !backendStore.adapter) return

  loading.value = true
  error.value = ''
  try {
    detail.value = await backendStore.adapter.fetchDetail(props.hash)
    await ensureSpeedBytes()
  } catch (err) {
    console.error('[TorrentDetailDrawer] Failed to fetch detail:', err)
    error.value = err instanceof Error ? err.message : '获取详情失败'
  } finally {
    loading.value = false
  }
}

// 监听 hash 变化重新获取
defineExpose({
  fetchDetail
})

// 计算属性
const progressPercent = computed(() => {
  if (!detail.value) return 0
  if (detail.value.size <= 0) return 0
  const raw = detail.value.completed / detail.value.size
  const clamped = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0))
  return Math.round(clamped * 100)
})

const ratio = computed(() => {
  if (!detail.value) return 0
  return detail.value.size > 0 ? detail.value.uploaded / detail.value.size : 0
})

const remaining = computed(() => {
  if (!detail.value) return 0
  // 防御：后端可能返回 completed > size 的异常数据，避免出现负数展示
  return Math.max(0, detail.value.size - detail.value.completed)
})

const categoryDisplay = computed(() => {
  const raw = detail.value?.category ?? ''
  if (!raw) return ''
  if (!backendStore.isTrans) return raw
  if (isVirtualExternalPath(raw)) {
    const rest = stripVirtualExternalPrefix(raw)
    return rest ? `外部目录/${rest}` : '外部目录'
  }
  return raw
})

const categoryIcon = computed(() => {
  const raw = detail.value?.category ?? ''
  if (backendStore.isTrans && isVirtualExternalPath(raw)) {
    return 'globe'
  }
  return 'folder'
})

// Tracker 状态映射
const trackerStatusMap: Record<string, string> = {
  working: '工作中',
  updating: '更新中',
  not_working: '未工作',
  disabled: '已禁用'
}

// 文件优先级映射
const priorityMap: Record<string, string> = {
  high: '高',
  normal: '普通',
  low: '低',
  do_not_download: '不下载'
}

// ========== 操作方法 ==========

// 执行操作的通用封装
async function executeAction(fn: () => Promise<void>) {
  if (!props.hash || !backendStore.adapter) return
  actionLoading.value = true
  try {
    await fn()
    emit('refresh')  // 请求主界面刷新
    await fetchDetail()  // 刷新详情
  } catch (err) {
    console.error('[TorrentDetailDrawer] Action failed:', err)
    alert(err instanceof Error ? err.message : '操作失败')
  } finally {
    actionLoading.value = false
  }
}

// 暂停
async function handlePause() {
  await executeAction(() => backendStore.adapter!.pause([props.hash!]))
}

// 恢复
async function handleResume() {
  await executeAction(() => backendStore.adapter!.resume([props.hash!]))
}

// 删除
async function handleDelete() {
  if (!detail.value) return
  const choice = await overlay.confirm({
    title: '删除种子',
    message: `是否同时删除下载文件？\n\n种子：${detail.value.name}`,
    confirmLabel: '删除种子与文件',
    cancelLabel: '仅删除种子',
    tone: 'danger',
  })
  if (choice === null) return
  const deleteFiles = choice
  if (deleteFiles) {
    const confirmed = await overlay.confirm({
      title: '确认删除文件',
      message: `警告：确定删除并删除文件吗？\n\n此操作不可恢复！`,
      confirmLabel: '确认删除',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
  } else {
    const confirmed = await overlay.confirm({
      title: '确认删除种子',
      message: `确定删除种子吗？\n（仅删除种子，保留文件）`,
      confirmLabel: '确认删除',
      cancelLabel: '取消',
      tone: 'danger',
    })
    if (!confirmed) return
  }
  await executeAction(() => backendStore.adapter!.delete([props.hash!], deleteFiles))
  emit('close')  // 删除后关闭抽屉
}

// 重新校验
async function handleRecheck() {
  await executeAction(() => backendStore.adapter!.recheck(props.hash!))
}

// 重新汇报
async function handleReannounce() {
  await executeAction(() => backendStore.adapter!.reannounce(props.hash!))
}

// 强制开始
async function handleForceStart() {
  await executeAction(() => backendStore.adapter!.forceStart(props.hash!, true))
}

// 打开限速设置对话框
function openLimitDialog() {
  if (!detail.value) return
  // 预填充当前限速值（-1 表示无限制）
  const divisor = speedBytes.value > 0 ? speedBytes.value : 1024
  dlLimitInput.value = detail.value.dlLimit < 0 ? '' : (detail.value.dlLimit / divisor).toString()
  upLimitInput.value = detail.value.upLimit < 0 ? '' : (detail.value.upLimit / divisor).toString()
  showLimitDialog.value = true
  showMoreMenu.value = false
}

// 保存限速设置
function parseKbLimit(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed) return -1
  const num = Number(trimmed)
  if (!Number.isFinite(num) || num < 0) throw new Error(`限速请输入非负数字（${speedUnitLabel.value}）`)
  if (num <= 0) return -1
  const multiplier = speedBytes.value > 0 ? speedBytes.value : 1024
  return Math.round(num * multiplier)
}

async function saveLimits() {
  let dlLimit: number
  let upLimit: number

  try {
    dlLimit = parseKbLimit(dlLimitInput.value)
    upLimit = parseKbLimit(upLimitInput.value)
  } catch (err) {
    alert(err instanceof Error ? err.message : '限速值无效')
    return
  }

  await executeAction(async () => {
    await Promise.all([
      backendStore.adapter!.setDownloadLimit(props.hash!, dlLimit),
      backendStore.adapter!.setUploadLimit(props.hash!, upLimit)
    ])
  })
  showLimitDialog.value = false
}

// 移动位置
async function handleSetLocation() {
  const newLocation = prompt('请输入新的保存路径：')
  if (newLocation && newLocation.trim()) {
    await executeAction(() => backendStore.adapter!.setLocation(props.hash!, newLocation.trim()))
  }
}

// 点击外部关闭菜单
function handleClickOutside() {
  showMoreMenu.value = false
}
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩层 -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 bg-black/50 z-50"
        @click="$emit('close')"
      />
    </Transition>

    <!-- 抽屉 -->
    <Transition
      enter-active-class="transition-transform duration-300"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-300"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <div
        v-if="open"
        class="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl z-50 flex flex-col"
      >
          <!-- 头部 -->
          <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
            <div class="flex-1 min-w-0">
              <SafeText
                as="h2"
                class="text-lg font-semibold text-gray-900 truncate"
                :text="detail?.name || '种子详情'"
              />
              <p v-if="detail" class="text-sm text-gray-500">{{ hash?.slice(0, 16) }}...</p>
            </div>
            <button
              @click="$emit('close')"
              class="p-2 hover:bg-gray-100 rounded-lg transition-colors ml-4"
            >
              <Icon name="x" :size="20" class="text-gray-500" />
            </button>
          </div>

          <!-- 加载状态 -->
          <div v-if="loading" class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-2"></div>
              <p class="text-sm text-gray-500">加载中...</p>
            </div>
          </div>

          <!-- 错误状态 -->
          <div v-else-if="error" class="flex-1 flex items-center justify-center">
            <div class="text-center text-red-500">
              <Icon name="alert-circle" :size="48" class="mx-auto mb-2" />
              <p>{{ error }}</p>
            </div>
          </div>

          <!-- 内容区 -->
          <div v-else-if="detail" class="flex-1 flex flex-col overflow-hidden">
            <!-- Tab 导航 -->
            <div class="border-b border-gray-200 px-6 shrink-0">
              <nav class="flex gap-6 -mb-px">
                <button
                  @click="activeTab = 'info'"
                  :class="`px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'info'
                      ? 'border-black text-black'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`"
                >
                  信息
                </button>
                <button
                  @click="activeTab = 'files'"
                  :class="`px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'files'
                      ? 'border-black text-black'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`"
                >
                  文件 ({{ detail.files.length }})
                </button>
                <button
                  @click="activeTab = 'trackers'"
                  :class="`px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'trackers'
                      ? 'border-black text-black'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`"
                >
                  Trackers ({{ detail.trackers.length }})
                </button>
                <button
                  @click="activeTab = 'peers'"
                  :class="`px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'peers'
                      ? 'border-black text-black'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`"
                >
                  Peers ({{ detail.peers.length }})
                </button>
              </nav>
            </div>

            <!-- Tab 内容 -->
            <div class="flex-1 overflow-y-auto p-6">
             <!-- 信息 Tab -->
              <div v-if="activeTab === 'info'" class="space-y-4">
                <div v-if="detail.partial" class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex gap-2">
                  <Icon name="alert-triangle" :size="16" class="shrink-0 mt-0.5" />
                  <div>部分详情读取失败，当前显示值可能来自缓存或降级数据；建议刷新或检查反代/权限配置。</div>
                </div>

                <!-- 进度 -->
                <div>
                  <div class="flex justify-between text-sm mb-1">
                    <span class="text-gray-600">进度</span>
                    <span class="font-medium">{{ progressPercent }}%</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-2">
                    <div class="bg-black h-2 rounded-full transition-all" :style="{ width: `${progressPercent}%` }"></div>
                  </div>
                  <div class="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{{ formatBytes(detail.completed) }} / {{ formatBytes(detail.size) }}</span>
                    <span>剩余: {{ formatBytes(remaining) }}</span>
                  </div>
                </div>

                <!-- 统计网格 -->
                <div class="grid grid-cols-2 gap-4">
                  <div class="bg-gray-50 rounded-lg p-3">
                    <p class="text-xs text-gray-500 mb-1">上传量</p>
                    <p class="font-mono text-sm">{{ formatBytes(detail.uploaded) }}</p>
                  </div>
                  <div class="bg-gray-50 rounded-lg p-3">
                    <p class="text-xs text-gray-500 mb-1">分享率</p>
                    <p class="font-mono text-sm">{{ ratio.toFixed(2) }}</p>
                  </div>
                  <div class="bg-gray-50 rounded-lg p-3">
                    <p class="text-xs text-gray-500 mb-1">做种时长</p>
                    <p class="font-mono text-sm">{{ formatDuration(detail.seedingTime) }}</p>
                  </div>
                  <div class="bg-gray-50 rounded-lg p-3">
                    <p class="text-xs text-gray-500 mb-1">添加时间</p>
                    <p class="font-mono text-sm">{{ new Date(detail.addedTime * 1000).toLocaleString() }}</p>
                  </div>
                </div>

                <!-- 连接信息 -->
                <div class="bg-gray-50 rounded-lg p-4">
                  <h3 class="text-sm font-medium text-gray-900 mb-2">连接信息</h3>
                  <div class="grid grid-cols-2 gap-2 text-sm">
                    <span class="text-gray-600">连接数:</span>
                    <span class="font-mono">{{ detail.connections }}</span>
                    <span class="text-gray-600">种子数:</span>
                    <span class="font-mono">{{ detail.numSeeds }}</span>
                    <span class="text-gray-600">下载数:</span>
                    <span class="font-mono">{{ detail.numLeechers }}</span>
                    <template v-if="detail.totalSeeds !== undefined || detail.totalLeechers !== undefined">
                      <span class="text-gray-600">Swarm 做种:</span>
                      <span class="font-mono">{{ detail.totalSeeds ?? '-' }}</span>
                      <span class="text-gray-600">Swarm 下载:</span>
                      <span class="font-mono">{{ detail.totalLeechers ?? '-' }}</span>
                    </template>
                  </div>
                </div>

                <!-- 分类和标签 -->
                <div v-if="detail.category || detail.tags.length > 0" class="bg-gray-50 rounded-lg p-4">
                  <div v-if="detail.category" class="flex items-center gap-2 mb-2">
                    <Icon :name="categoryIcon" :size="16" class="text-gray-500" />
                    <span class="text-sm">{{ categoryDisplay }}</span>
                  </div>
                  <div v-if="detail.tags.length > 0" class="flex flex-wrap gap-2">
                    <span
                      v-for="tag in detail.tags"
                      :key="tag"
                      class="px-2 py-1 bg-gray-200 rounded text-xs"
                    >
                      {{ tag }}
                    </span>
                  </div>
                </div>

                <!-- 保存路径 -->
                <div class="bg-gray-50 rounded-lg p-4">
                  <h3 class="text-sm font-medium text-gray-900 mb-1">保存路径</h3>
                  <p class="text-sm text-gray-600 break-all font-mono">{{ detail.savePath }}</p>
                </div>
              </div>

              <!-- 文件 Tab -->
              <div v-else-if="activeTab === 'files'" class="space-y-2">
                <div
                  v-for="file in detail.files"
                  :key="file.id"
                  class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-sm"
                >
                  <Icon name="file" :size="16" class="text-gray-400 shrink-0" />
                  <div class="flex-1 min-w-0">
                    <p class="truncate">{{ file.name }}</p>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                      <span>{{ formatBytes(file.size) }}</span>
                      <span>•</span>
                      <span>{{ Math.round(file.progress * 100) }}%</span>
                    </div>
                  </div>
                  <div class="shrink-0">
                    <span class="px-2 py-1 rounded text-xs bg-gray-200">
                      {{ priorityMap[file.priority] }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Trackers Tab -->
              <div v-else-if="activeTab === 'trackers'" class="space-y-2">
                <div
                  v-for="(tracker, index) in detail.trackers"
                  :key="index"
                  class="p-3 bg-gray-50 rounded-lg"
                >
                  <div class="flex items-center justify-between mb-1">
                    <p class="text-sm font-mono truncate flex-1 mr-2">{{ tracker.url }}</p>
                    <span
                      :class="`px-2 py-0.5 rounded text-xs ${
                        tracker.status === 'working' ? 'bg-green-100 text-green-700' :
                        tracker.status === 'disabled' ? 'bg-gray-100 text-gray-600' :
                        'bg-red-100 text-red-700'
                      }`"
                    >
                      {{ trackerStatusMap[tracker.status] || tracker.status }}
                    </span>
                  </div>
                  <div class="flex items-center gap-4 text-xs text-gray-500">
                    <span>Peers: {{ tracker.peers }}</span>
                    <span>Tier: {{ tracker.tier }}</span>
                    <span v-if="tracker.msg" class="truncate">{{ tracker.msg }}</span>
                  </div>
                </div>
              </div>

              <!-- Peers Tab -->
              <div v-else-if="activeTab === 'peers'" class="space-y-2">
                <div
                  v-for="(peer, index) in detail.peers"
                  :key="index"
                  class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-sm"
                >
                  <div class="flex-1 min-w-0">
                    <p class="font-mono truncate">{{ peer.ip }}:{{ peer.port }}</p>
                    <p class="text-xs text-gray-500 truncate">{{ peer.client }}</p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="font-mono text-xs">{{ Math.round(peer.progress * 100) }}%</p>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                      <span class="text-blue-600">{{ formatSpeed(peer.dlSpeed) }}</span>
                      <span class="text-cyan-600">{{ formatSpeed(peer.upSpeed) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部操作栏 -->
          <div v-if="detail" class="border-t border-gray-200 p-4 shrink-0">
            <!-- 主操作按钮 -->
            <div class="flex gap-2 mb-2">
              <button
                @click="handlePause"
                :disabled="actionLoading"
                class="flex-1 px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="pause" :size="16" class="inline mr-1" />
                暂停
              </button>
              <button
                @click="handleResume"
                :disabled="actionLoading"
                class="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="play" :size="16" class="inline mr-1 text-blue-600" />
                恢复
              </button>
              <button
                @click="handleDelete"
                :disabled="actionLoading"
                class="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="trash-2" :size="16" class="inline mr-1" />
                删除
              </button>
            </div>

            <!-- 更多操作 -->
            <div class="relative">
              <button
                @click="showMoreMenu = !showMoreMenu"
                :disabled="actionLoading"
                class="w-full px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Icon name="more-horizontal" :size="16" />
                更多操作
                <Icon name="chevron-up" :size="14" :class="{ 'rotate-180': showMoreMenu }" />
              </button>

              <!-- 下拉菜单 -->
              <Transition
                enter-active-class="transition-opacity duration-150"
                enter-from-class="opacity-0"
                enter-to-class="opacity-100"
                leave-active-class="transition-opacity duration-150"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
              >
                <div
                  v-if="showMoreMenu"
                  v-click-outside="handleClickOutside"
                  class="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-10"
                >
                  <button
                    @click="handleRecheck"
                    class="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Icon name="refresh-cw" :size="16" class="text-gray-500" />
                    <span>重新校验</span>
                  </button>
                  <button
                    @click="handleReannounce"
                    class="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Icon name="radio" :size="16" class="text-gray-500" />
                    <span>重新汇报</span>
                  </button>
                  <button
                    @click="handleForceStart"
                    class="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Icon name="zap" :size="16" class="text-orange-500" />
                    <span>强制开始</span>
                  </button>
                  <button
                    @click="openLimitDialog"
                    class="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Icon name="gauge" :size="16" class="text-gray-500" />
                    <span>限速设置</span>
                    <span class="ml-auto text-xs text-gray-400">
                      {{ detail.dlLimit > 0 ? formatSpeed(detail.dlLimit) + '/' : '∞/' }}
                      {{ detail.upLimit > 0 ? formatSpeed(detail.upLimit) : '∞' }}
                    </span>
                  </button>
                  <button
                    @click="handleSetLocation"
                    class="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Icon name="folder-open" :size="16" class="text-gray-500" />
                    <span>移动位置</span>
                  </button>
                </div>
              </Transition>
            </div>
          </div>

          <!-- 限速设置对话框 -->
          <Teleport to="body">
            <Transition
              enter-active-class="transition-opacity duration-150"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-150"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div
                v-if="showLimitDialog"
                class="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
                @click.self="showLimitDialog = false"
              >
                <Transition
                  enter-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 scale-95"
                  enter-to-class="opacity-100 scale-100"
                  leave-active-class="transition-all duration-150"
                  leave-from-class="opacity-100 scale-100"
                  leave-to-class="opacity-0 scale-95"
                >
                  <div
                    v-if="showLimitDialog"
                    class="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
                    @click.stop
                  >
                    <div class="px-6 py-4 border-b border-gray-200">
                      <h3 class="text-lg font-semibold text-gray-900">限速设置</h3>
                    </div>
                    <div class="p-6 space-y-4">
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">下载限速 ({{ speedUnitLabel }})</label>
                        <input
                          v-model="dlLimitInput"
                          type="number"
                          min="0"
                          step="10"
                          class="input w-full"
                          placeholder="留空表示无限制"
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">上传限速 ({{ speedUnitLabel }})</label>
                        <input
                          v-model="upLimitInput"
                          type="number"
                          min="0"
                          step="10"
                          class="input w-full"
                          placeholder="留空表示无限制"
                        />
                      </div>
                      <p class="text-xs text-gray-500">
                        留空或 0 表示无限制
                      </p>
                    </div>
                    <div class="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                      <button
                        @click="showLimitDialog = false"
                        class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        取消
                      </button>
                      <button
                        @click="saveLimits"
                        :disabled="actionLoading"
                        class="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        确定
                      </button>
                    </div>
                  </div>
                </Transition>
              </div>
            </Transition>
          </Teleport>
        </div>
      </Transition>
  </Teleport>
</template>
