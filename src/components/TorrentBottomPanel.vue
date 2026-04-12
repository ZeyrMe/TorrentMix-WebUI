<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useBackendStore } from '@/store/backend'
import type { UnifiedTorrentDetail, UnifiedTorrent, TorrentFile } from '@/adapter/types'
import type { BackendCapabilities, TorrentBandwidthPriority } from '@/adapter/interface'
import { useUiOverlay } from '@/composables/useUiOverlay'
import type { DashboardDetailTab } from '@/utils/dashboardRouteState'
import Icon from '@/components/Icon.vue'
import SafeText from '@/components/SafeText.vue'
import { formatBytes, formatSpeed } from '@/utils/format'
import { useDragResize } from '@/composables/useDragResize'
import { useTableColumns } from '@/composables/useTableColumns'
import { FILE_TABLE_COLUMNS, TRACKER_TABLE_COLUMNS, PEER_TABLE_COLUMNS } from '@/composables/useTableColumns/configs'
import ResizableTableHeader from '@/components/table/ResizableTableHeader.vue'

interface Props {
  torrent: UnifiedTorrent | null
  visible: boolean
  height: number
  activeTab?: DashboardDetailTab
}

interface Emits {
  (e: 'close'): void
  (e: 'resize', height: number): void
  (e: 'action', action: string, hash: string): void
  (e: 'refresh'): void
  (e: 'tab-change', tab: DashboardDetailTab): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const backendStore = useBackendStore()
const capabilities = computed<BackendCapabilities>(() => backendStore.capabilities)
const uiOverlay = useUiOverlay()

// 详情数据
const detail = ref<UnifiedTorrentDetail | null>(null)
const loading = ref(false)
const error = ref('')
const mutating = ref(false)

// 当前 Tab
const activeTab = ref<DashboardDetailTab>(props.activeTab ?? 'overview')

function readOverlayValue(values: Record<string, string>, key: string) {
  return values[key] ?? ''
}

function showMutationError(title: string, err: unknown) {
  uiOverlay.notify({
    title,
    message: err instanceof Error ? err.message : title,
    tone: 'danger',
  })
}

function isNestedInteractiveKeyboardTarget(event: KeyboardEvent) {
  const target = event.target
  const currentTarget = event.currentTarget
  if (!(target instanceof HTMLElement) || !(currentTarget instanceof HTMLElement)) return false

  const interactive = target.closest('button, input, select, textarea, a, [role="button"]')
  return interactive !== null && interactive !== currentTarget
}

function handleFolderRowKeydown(event: KeyboardEvent, path: string) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  if (isNestedInteractiveKeyboardTarget(event)) return

  event.preventDefault()
  event.stopPropagation()
  toggleFolder(path)
}

const canTorrentAdvancedSwitches = computed(() => capabilities.value.hasTorrentAdvancedSwitches)
const canAutoManagement = computed(() =>
  capabilities.value.hasAutoManagement && typeof (backendStore.adapter as any)?.setAutoManagement === 'function'
)
const canSequentialDownload = computed(() =>
  capabilities.value.hasSequentialDownload && typeof (backendStore.adapter as any)?.setSequentialDownload === 'function'
)
const canFirstLastPiecePriority = computed(() =>
  capabilities.value.hasFirstLastPiecePriority && typeof (backendStore.adapter as any)?.setFirstLastPiecePriority === 'function'
)
const canSuperSeeding = computed(() =>
  capabilities.value.hasSuperSeeding && typeof (backendStore.adapter as any)?.setSuperSeeding === 'function'
)

const canBandwidthPriority = computed(() =>
  capabilities.value.hasBandwidthPriority && typeof (backendStore.adapter as any)?.setBandwidthPriority === 'function'
)

const canTrackerManagement = computed(() => capabilities.value.hasTrackerManagement)
const canPeerManagement = computed(() => capabilities.value.hasPeerManagement)

const canRenameFile = computed(() => {
  const fn = (backendStore.adapter as any)?.renameFile
  if (typeof fn !== 'function') return false
  if (backendStore.isQbit) {
    const features = backendStore.version?.features
    if (features && !features.hasFileRename) return false
  }
  return true
})

const canRenameFolder = computed(() => {
  const fn = (backendStore.adapter as any)?.renameFolder
  if (typeof fn !== 'function') return false
  if (backendStore.isQbit) {
    const features = backendStore.version?.features
    if (features && !features.hasFileRename) return false
  }
  return true
})

const canMoveFile = computed(() => backendStore.isQbit && canRenameFile.value)
const canMoveFolder = computed(() => backendStore.isQbit && canRenameFolder.value)

// 使用拖拽 composable（核心性能优化）
const {
  isResizing,
  panelStyle,
  startResize,
  commitHeight,
  setHeight
} = useDragResize({
  initialHeight: props.height,
  minHeight: 200,
  maxHeight: 800
})

// ========== Tab tables: splitter-based resizable columns ==========
const {
  columns: filesColumns,
  resizeState: filesResizeState,
  startResize: startFilesResize
} = useTableColumns('torrent-files', FILE_TABLE_COLUMNS)

const {
  columns: trackersColumns,
  resizeState: trackersResizeState,
  startResize: startTrackersResize
} = useTableColumns('torrent-trackers', TRACKER_TABLE_COLUMNS)

const {
  columns: peersColumns,
  resizeState: peersResizeState,
  startResize: startPeersResize
} = useTableColumns('torrent-peers', PEER_TABLE_COLUMNS)

const filesColumnById = computed(() => Object.fromEntries(filesColumns.value.map(c => [c.id, c])))
const trackersColumnById = computed(() => Object.fromEntries(trackersColumns.value.map(c => [c.id, c])))
const peersColumnById = computed(() => Object.fromEntries(peersColumns.value.map(c => [c.id, c])))

function getFlexStyle(
  columnById: Record<string, { currentWidth: number; minWidth: number } | undefined>,
  columnId: string,
  fixed = false,
  isColumnResizing = false
) {
  const column = columnById[columnId]
  const width = column?.currentWidth ?? 0
  const minWidth = column?.minWidth ?? 0

  if (fixed || isColumnResizing) {
    return { flex: `0 0 ${width}px`, minWidth: `${minWidth}px` }
  }

  return { flex: `${Math.max(1, width)} 1 ${width}px`, minWidth: `${minWidth}px` }
}

// 监听外部高度变化（非拖拽时）
watch(() => props.height, (newHeight) => {
  if (!isResizing.value) {
    setHeight(newHeight)
  }
})

watch(
  () => props.activeTab,
  (nextTab) => {
    if (!nextTab || nextTab === activeTab.value) return
    activeTab.value = nextTab
  }
)

watch(activeTab, (tab) => {
  emit('tab-change', tab)
})

// 监听拖拽状态变化，拖拽结束时提交高度
watch(isResizing, (resizing, wasResizing) => {
  if (wasResizing && !resizing) {
    emit('resize', commitHeight())
  }
})

// 获取详情
async function fetchDetail() {
  if (!props.torrent?.id || !backendStore.adapter) {
    detail.value = null
    return
  }

  loading.value = true
  error.value = ''
  try {
    detail.value = await backendStore.adapter.fetchDetail(props.torrent.id)
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to fetch detail:', err)
    error.value = err instanceof Error ? err.message : '获取详情失败'
    detail.value = null
  } finally {
    loading.value = false
  }
}

// 监听种子变化重新获取详情
watch(() => props.torrent?.id, () => {
  clearTrackerSelection()
  clearPeerSelection()
  showLimitDialog.value = false
  fileContextMenuState.value.show = false
  fileContextMenuState.value.node = null
  if (props.visible && props.torrent) {
    fetchDetail()
  }
})

// 监听面板显示状态变化
watch(() => props.visible, (visible) => {
  if (visible && props.torrent) {
    fetchDetail()
    if (!props.activeTab) activeTab.value = 'overview'
  }
})

// 处理操作
function handleAction(action: string) {
  if (props.torrent) {
    emit('action', action, props.torrent.id)
  }
}

const canRenameTorrent = computed(() => {
  if (!backendStore.isQbit) return false
  const features = backendStore.version?.features
  if (features && !features.hasTorrentRename) return false
  const fn = (backendStore.adapter as any)?.renameTorrent
  return typeof fn === 'function'
})

async function handleRenameTorrent() {
  if (!props.torrent?.id || !backendStore.adapter) return
  const fn = (backendStore.adapter as any)?.renameTorrent
  if (typeof fn !== 'function') return

  const current = props.torrent.name
  const values = await uiOverlay.openForm({
    title: '重命名种子',
    submitLabel: '保存名称',
    fields: [
      {
        key: 'name',
        label: '种子名称',
        name: 'torrentName',
        defaultValue: current,
        autocomplete: 'off',
        placeholder: '请输入新的种子名称',
      },
    ],
  })
  if (!values) return

  const trimmed = readOverlayValue(values, 'name').trim()
  if (!trimmed || trimmed === current) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, props.torrent.id, trimmed)
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Rename torrent failed:', err)
    showMutationError('重命名失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleSetLocation() {
  if (!props.torrent?.id || !backendStore.adapter) return

  const current = detail.value?.savePath || props.torrent.savePath || ''
  const values = await uiOverlay.openForm({
    title: '移动保存路径',
    submitLabel: '保存路径',
    fields: [
      {
        key: 'savePath',
        label: '保存路径',
        name: 'savePath',
        defaultValue: current,
        autocomplete: 'off',
        placeholder: '/downloads/ubuntu',
      },
    ],
  })
  if (!values) return

  const trimmed = readOverlayValue(values, 'savePath').trim()
  if (!trimmed || trimmed === current) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await backendStore.adapter.setLocation(props.torrent.id, trimmed)
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Set location failed:', err)
    showMutationError('移动位置失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

// 计算健康度
function getHealthStatus(torrent: UnifiedTorrent) {
  const hasSeeds = torrent.numSeeds !== undefined && torrent.numSeeds !== null
  const hasPeers = torrent.numPeers !== undefined && torrent.numPeers !== null
  const hasConnectedSeeds = torrent.connectedSeeds !== undefined && torrent.connectedSeeds !== null
  const hasConnectedPeers = torrent.connectedPeers !== undefined && torrent.connectedPeers !== null
  const hasTotalSeeds = torrent.totalSeeds !== undefined && torrent.totalSeeds !== null
  const hasTotalPeers = torrent.totalPeers !== undefined && torrent.totalPeers !== null
  if (!hasSeeds && !hasPeers && !hasConnectedSeeds && !hasConnectedPeers && !hasTotalSeeds && !hasTotalPeers) {
    return {
      text: '未知',
      classes: 'text-gray-600 bg-gray-100',
      title: '后端未提供做种/下载者统计',
    }
  }

  // 健康度以 swarm 总数为主，缺失时回退到 connected。
  const seeds = torrent.numSeeds ?? torrent.totalSeeds ?? torrent.connectedSeeds ?? 0
  const peers = torrent.numPeers ?? torrent.totalPeers ?? torrent.connectedPeers ?? 0

  if (seeds >= 10) return { text: '优秀', classes: 'text-green-700 bg-green-100', title: '做种 >= 10' }
  if (seeds >= 5) return { text: '良好', classes: 'text-blue-700 bg-blue-100', title: '做种 >= 5' }
  if (seeds >= 1) return { text: '一般', classes: 'text-yellow-700 bg-yellow-100', title: '做种 >= 1' }
  if (peers > 0) return { text: '无种子', classes: 'text-red-700 bg-red-100', title: '下载者 > 0 但做种为 0' }
  return { text: '无同伴', classes: 'text-gray-700 bg-gray-100', title: '做种/下载者均为 0（可能尚未 announce 或暂时无同伴）' }
}

function formatCountPair(connected?: number | null, total?: number | null, best?: number | null): string {
  const hasConnected = connected !== undefined && connected !== null
  const hasTotal = total !== undefined && total !== null
  if (hasConnected && hasTotal) return `${connected}(${total})`
  if (hasTotal) return String(total)
  if (best !== undefined && best !== null) return String(best)
  if (hasConnected) return String(connected)
  return '--'
}

function formatTotalPeers(torrent: UnifiedTorrent): string {
  const hasConnectedSeeds = torrent.connectedSeeds !== undefined && torrent.connectedSeeds !== null
  const hasConnectedPeers = torrent.connectedPeers !== undefined && torrent.connectedPeers !== null
  const hasTotalSeeds = torrent.totalSeeds !== undefined && torrent.totalSeeds !== null
  const hasTotalPeers = torrent.totalPeers !== undefined && torrent.totalPeers !== null

  if ((hasConnectedSeeds || hasConnectedPeers) && (hasTotalSeeds || hasTotalPeers)) {
    const c = (torrent.connectedSeeds ?? 0) + (torrent.connectedPeers ?? 0)
    const t = (torrent.totalSeeds ?? torrent.numSeeds ?? 0) + (torrent.totalPeers ?? torrent.numPeers ?? 0)
    return `${c}(${t})`
  }

  const hasSeeds = torrent.numSeeds !== undefined && torrent.numSeeds !== null
  const hasPeers = torrent.numPeers !== undefined && torrent.numPeers !== null
  if (!hasSeeds && !hasPeers) return '--'
  return String((torrent.numSeeds ?? 0) + (torrent.numPeers ?? 0))
}

// ETA格式化
function formatETA(eta: number): string {
  // 无限时间判断：-1、负数、非数值、或超过1年
  if (eta === -1 || eta <= 0 || !isFinite(eta) || eta >= 86400 * 365) return '∞'

  const seconds = Math.floor(eta)
  if (seconds < 60) return `${seconds}秒`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时`

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  if (remainingHours > 0) {
    return `${days}天${remainingHours}小时`
  }
  return `${days}天`
}

// Tracker 状态映射
const trackerStatusMap: Record<string, { text: string; class: string; icon: string }> = {
  working: { text: '工作中', class: 'bg-green-100 text-green-700', icon: '●' },
  updating: { text: '更新中', class: 'bg-yellow-100 text-yellow-700', icon: '○' },
  not_working: { text: '未工作', class: 'bg-red-100 text-red-700', icon: '●' },
  disabled: { text: '已禁用', class: 'bg-gray-100 text-gray-600', icon: '○' }
}

// 文件优先级映射
const priorityMap: Record<string, { text: string; class: string }> = {
  high: { text: '高', class: 'text-red-600' },
  normal: { text: '普通', class: 'text-gray-600' },
  low: { text: '低', class: 'text-blue-600' },
  do_not_download: { text: '跳过', class: 'text-gray-400 line-through' }
}

const selectedTrackerUrls = ref<Set<string>>(new Set())
function toggleTrackerSelection(url: string) {
  const next = new Set(selectedTrackerUrls.value)
  if (next.has(url)) next.delete(url)
  else next.add(url)
  selectedTrackerUrls.value = next
}

function clearTrackerSelection() {
  selectedTrackerUrls.value = new Set()
}

function peerKey(peer: { ip: string; port: number }) {
  return `${peer.ip}:${peer.port}`
}

const selectedPeers = ref<Set<string>>(new Set())
function togglePeerSelection(peer: { ip: string; port: number }) {
  const key = peerKey(peer)
  const next = new Set(selectedPeers.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedPeers.value = next
}

function clearPeerSelection() {
  selectedPeers.value = new Set()
}

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
    } else {
      speedBytes.value = 1024
    }
  } catch (err) {
    console.warn('[TorrentBottomPanel] Failed to load speedBytes, fallback 1024:', err)
    speedBytes.value = 1024
  }
}

async function openLimitDialog() {
  if (!detail.value) return
  await ensureSpeedBytes()

  const multiplier = speedBytes.value > 0 ? speedBytes.value : 1024
  dlLimitInput.value = detail.value.dlLimit > 0 ? String(Math.round(detail.value.dlLimit / multiplier)) : ''
  upLimitInput.value = detail.value.upLimit > 0 ? String(Math.round(detail.value.upLimit / multiplier)) : ''
  showLimitDialog.value = true
}

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
  if (!props.torrent?.id || !backendStore.adapter) return

  let dlLimit: number
  let upLimit: number

  try {
    dlLimit = parseKbLimit(dlLimitInput.value)
    upLimit = parseKbLimit(upLimitInput.value)
  } catch (err) {
    showMutationError('限速值无效', err)
    return
  }

  mutating.value = true
  backendStore.beginMutation()
  try {
    await Promise.all([
      backendStore.adapter.setDownloadLimit(props.torrent.id, dlLimit),
      backendStore.adapter.setUploadLimit(props.torrent.id, upLimit),
    ])
    showLimitDialog.value = false
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to save limits:', err)
    showMutationError('保存限速失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

function parseBandwidthPriority(raw: string): TorrentBandwidthPriority | null {
  if (raw === 'low' || raw === 'normal' || raw === 'high') return raw
  return null
}

async function handleBandwidthPriorityChange(raw: string) {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!canBandwidthPriority.value) return

  const next = parseBandwidthPriority(raw)
  if (!next) return
  if (detail.value?.bandwidthPriority === next) return

  const fn = (backendStore.adapter as any)?.setBandwidthPriority
  if (typeof fn !== 'function') return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, [props.torrent.id], next)
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to set bandwidth priority:', err)
    showMutationError('设置带宽优先级失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

type TorrentAdvancedSwitch = 'autoManagement' | 'sequentialDownload' | 'firstLastPiecePriority' | 'superSeeding'
async function handleAdvancedSwitch(kind: TorrentAdvancedSwitch, enable: boolean) {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!canTorrentAdvancedSwitches.value) return

  const fnMap: Record<TorrentAdvancedSwitch, unknown> = {
    autoManagement: (backendStore.adapter as any)?.setAutoManagement,
    sequentialDownload: (backendStore.adapter as any)?.setSequentialDownload,
    firstLastPiecePriority: (backendStore.adapter as any)?.setFirstLastPiecePriority,
    superSeeding: (backendStore.adapter as any)?.setSuperSeeding,
  }
  const fn = fnMap[kind]
  if (typeof fn !== 'function') return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, [props.torrent.id], enable)
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to set advanced switch:', err)
    showMutationError('设置高级开关失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleAddTrackers() {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!canTrackerManagement.value) return

  const values = await uiOverlay.openForm({
    title: '添加 Tracker',
    message: '支持多条 URL，使用换行或逗号分隔。',
    submitLabel: '添加 Tracker',
    fields: [
      {
        key: 'urls',
        label: 'Tracker URL',
        name: 'trackerUrls',
        multiline: true,
        placeholder: 'udp://tracker.example:80/announce',
        autocomplete: 'off',
      },
    ],
  })
  if (!values) return

  const urls = readOverlayValue(values, 'urls')
    .split(/[\n,，]+/g)
    .map(s => s.trim())
    .filter(Boolean)
  if (urls.length === 0) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await backendStore.adapter.addTrackers(props.torrent.id, urls)
    clearTrackerSelection()
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to add trackers:', err)
    showMutationError('添加 Tracker 失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleEditSelectedTracker() {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!canTrackerManagement.value) return

  const urls = Array.from(selectedTrackerUrls.value)
  if (urls.length !== 1) {
    uiOverlay.notify({
      title: '无法编辑 Tracker',
      message: '请先选择 1 个 Tracker 再编辑。',
      tone: 'warning',
    })
    return
  }

  const origUrl = urls[0]!
  const values = await uiOverlay.openForm({
    title: '编辑 Tracker',
    submitLabel: '保存 Tracker',
    fields: [
      {
        key: 'url',
        label: 'Tracker URL',
        name: 'trackerUrl',
        defaultValue: origUrl,
        autocomplete: 'off',
        placeholder: 'udp://tracker.example:80/announce',
      },
    ],
  })
  if (!values) return

  const trimmed = readOverlayValue(values, 'url').trim()
  if (!trimmed || trimmed === origUrl) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await backendStore.adapter.editTracker(props.torrent.id, origUrl, trimmed)
    clearTrackerSelection()
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to edit tracker:', err)
    showMutationError('编辑 Tracker 失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleRemoveSelectedTrackers() {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!canTrackerManagement.value) return

  const urls = Array.from(selectedTrackerUrls.value)
  if (urls.length === 0) return

  const confirmed = await uiOverlay.confirm({
    title: '移除 Tracker',
    message: `确定移除已选的 ${urls.length} 个 Tracker 吗？`,
    confirmLabel: '确认移除',
    cancelLabel: '取消',
    tone: 'danger',
  })
  if (!confirmed) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await backendStore.adapter.removeTrackers(props.torrent.id, urls)
    clearTrackerSelection()
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to remove trackers:', err)
    showMutationError('移除 Tracker 失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleAddPeers() {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!canPeerManagement.value) return

  const fn = (backendStore.adapter as any)?.addPeers
  if (typeof fn !== 'function') return

  const values = await uiOverlay.openForm({
    title: '添加 Peers',
    message: '支持多条地址，使用换行或逗号分隔。',
    submitLabel: '添加 Peers',
    fields: [
      {
        key: 'peers',
        label: 'Peer 地址',
        name: 'peerAddresses',
        multiline: true,
        placeholder: '127.0.0.1:51413',
        autocomplete: 'off',
      },
    ],
  })
  if (!values) return

  const peers = readOverlayValue(values, 'peers')
    .split(/[\n,，]+/g)
    .map(s => s.trim())
    .filter(Boolean)
  if (peers.length === 0) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, [props.torrent.id], peers)
    clearPeerSelection()
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to add peers:', err)
    showMutationError('添加 Peers 失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleBanSelectedPeers() {
  if (!backendStore.adapter) return
  if (!canPeerManagement.value) return

  const fn = (backendStore.adapter as any)?.banPeers
  if (typeof fn !== 'function') return

  const peers = Array.from(selectedPeers.value)
  if (peers.length === 0) return
  const confirmed = await uiOverlay.confirm({
    title: '封禁 Peers',
    message: `确定封禁已选的 ${peers.length} 个 Peer 吗？\n\n注意：封禁是全局生效的。`,
    confirmLabel: '确认封禁',
    cancelLabel: '取消',
    tone: 'danger',
  })
  if (!confirmed) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, peers)
    clearPeerSelection()
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to ban peers:', err)
    showMutationError('封禁 Peers 失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

// 文件树节点类型
interface FileTreeNode {
  id?: number
  name: string
  path: string
  type: 'file' | 'folder'
  size?: number
  progress?: number
  priority?: TorrentFile['priority']
  children?: FileTreeNode[]
  expanded?: boolean
  level: number
}

type FileContextMenuState = {
  show: boolean
  x: number
  y: number
  node: FileTreeNode | null
}

const fileContextMenuState = ref<FileContextMenuState>({
  show: false,
  x: 0,
  y: 0,
  node: null,
})

const FILE_MENU_WIDTH = 200
const FILE_MENU_PADDING = 8

type FileMenuItem = {
  id: string
  label: string
  icon: string
  disabled?: boolean
  action: () => void
}

const fileMenuItems = computed<FileMenuItem[]>(() => {
  const node = fileContextMenuState.value.node
  if (!node) return []

  const isFile = node.type === 'file'
  const canRename = isFile ? canRenameFile.value : canRenameFolder.value
  const canMove = isFile ? canMoveFile.value : canMoveFolder.value

  const kindText = isFile ? '文件' : '文件夹'
  const items: FileMenuItem[] = []

  if (canRename) {
    items.push({
      id: 'rename',
      label: `重命名${kindText}`,
      icon: 'edit-2',
      disabled: mutating.value,
      action: () => {
        closeFileContextMenu()
        void handleRenamePath(node)
      },
    })
  }

  if (canMove) {
    items.push({
      id: 'move',
      label: `移动${kindText}`,
      icon: 'folder-input',
      disabled: mutating.value,
      action: () => {
        closeFileContextMenu()
        void handleMovePath(node)
      },
    })
  }

  return items
})

const fileMenuPosition = computed(() => {
  let left = fileContextMenuState.value.x + FILE_MENU_PADDING
  let top = fileContextMenuState.value.y + FILE_MENU_PADDING

  const estimatedHeight = Math.max(1, fileMenuItems.value.length) * 40 + 12

  // 右边界检测
  if (left + FILE_MENU_WIDTH > window.innerWidth) {
    left = window.innerWidth - FILE_MENU_WIDTH - FILE_MENU_PADDING
  }

  // 下边界检测
  if (top + estimatedHeight > window.innerHeight) {
    top = window.innerHeight - estimatedHeight - FILE_MENU_PADDING
  }

  return { left, top }
})

function closeFileContextMenu() {
  fileContextMenuState.value.show = false
  fileContextMenuState.value.node = null
}

function openFileContextMenu(e: MouseEvent, node: FileTreeNode) {
  e.preventDefault()
  e.stopPropagation()

  const canRename = node.type === 'file' ? canRenameFile.value : canRenameFolder.value
  const canMove = node.type === 'file' ? canMoveFile.value : canMoveFolder.value
  if (!canRename && !canMove) return

  fileContextMenuState.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    node
  }
}

let deferredFileMenuBindTimer: ReturnType<typeof setTimeout> | null = null

function handleFileMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeFileContextMenu()
  }
}

watch(() => fileContextMenuState.value.show, (show) => {
  if (show) {
    if (deferredFileMenuBindTimer) {
      clearTimeout(deferredFileMenuBindTimer)
      deferredFileMenuBindTimer = null
    }

    // 延迟添加监听器，避免立即触发 clickOutside
    deferredFileMenuBindTimer = setTimeout(() => {
      if (!fileContextMenuState.value.show) return
      document.addEventListener('click', closeFileContextMenu)
      document.addEventListener('keydown', handleFileMenuKeydown)
    }, 0)
  } else {
    if (deferredFileMenuBindTimer) {
      clearTimeout(deferredFileMenuBindTimer)
      deferredFileMenuBindTimer = null
    }
    document.removeEventListener('click', closeFileContextMenu)
    document.removeEventListener('keydown', handleFileMenuKeydown)
  }
})

onUnmounted(() => {
  if (deferredFileMenuBindTimer) {
    clearTimeout(deferredFileMenuBindTimer)
    deferredFileMenuBindTimer = null
  }
  document.removeEventListener('click', closeFileContextMenu)
  document.removeEventListener('keydown', handleFileMenuKeydown)
})

// 文件夹展开状态管理
const expandedFolders = ref<Set<string>>(new Set())

// 切换文件夹展开状态
function toggleFolder(path: string) {
  if (expandedFolders.value.has(path)) {
    expandedFolders.value.delete(path)
  } else {
    expandedFolders.value.add(path)
  }
  // 触发响应式更新
  expandedFolders.value = new Set(expandedFolders.value)
}

// 构建文件树结构
function buildFileTree(files: TorrentFile[]): FileTreeNode[] {
  if (!files || files.length === 0) return []

  const root: FileTreeNode[] = []
  const folderMap = new Map<string, FileTreeNode>()

  for (const file of files) {
    const parts = file.name.split('/')
    let currentPath = ''
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isFile = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (isFile) {
        // 文件节点
        currentLevel.push({
          id: file.id,
          name: part,
          path: currentPath,
          type: 'file',
          size: file.size,
          progress: file.progress,
          priority: file.priority,
          level: i
        })
      } else {
        // 文件夹节点
        let folder = folderMap.get(currentPath)
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            type: 'folder',
            children: [],
            expanded: expandedFolders.value.has(currentPath),
            level: i
          }
          folderMap.set(currentPath, folder)
          currentLevel.push(folder)
        }
        currentLevel = folder.children!
      }
    }
  }

  return root
}

// 计算文件夹的总大小和进度
function calculateFolderStats(node: FileTreeNode): { size: number; progress: number } {
  if (node.type === 'file') {
    return { size: node.size || 0, progress: node.progress || 0 }
  }

  let totalSize = 0
  let totalProgress = 0

  for (const child of node.children || []) {
    const stats = calculateFolderStats(child)
    totalSize += stats.size
    totalProgress += stats.progress * stats.size
  }

  return {
    size: totalSize,
    progress: totalSize > 0 ? totalProgress / totalSize : 0
  }
}

function parsePriority(raw: string): TorrentFile['priority'] | null {
  if (raw === 'high' || raw === 'normal' || raw === 'low' || raw === 'do_not_download') return raw
  return null
}

function normalizeTorrentPath(path: string): string {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function extractBasename(path: string): string {
  const normalized = normalizeTorrentPath(path)
  if (!normalized) return ''
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function extractDirname(path: string): string {
  const normalized = normalizeTorrentPath(path)
  const idx = normalized.lastIndexOf('/')
  if (idx === -1) return ''
  return normalized.slice(0, idx)
}

function hasUnsafePathSegments(path: string): boolean {
  const normalized = normalizeTorrentPath(path)
  if (!normalized) return false
  return normalized.split('/').some(seg => seg === '.' || seg === '..')
}

async function handleRenamePath(node: FileTreeNode) {
  if (!props.torrent?.id || !backendStore.adapter) return

  const isFile = node.type === 'file'
  const fn = isFile ? (backendStore.adapter as any)?.renameFile : (backendStore.adapter as any)?.renameFolder
  if (typeof fn !== 'function') return

  const kindText = isFile ? '文件' : '文件夹'
  const current = normalizeTorrentPath(node.path)
  const currentName = node.name || extractBasename(current)
  const values = await uiOverlay.openForm({
    title: `重命名${kindText}`,
    submitLabel: '保存名称',
    fields: [
      {
        key: 'name',
        label: `${kindText}名称`,
        name: 'pathName',
        defaultValue: currentName,
        autocomplete: 'off',
      },
    ],
  })
  if (!values) return

  const trimmedName = readOverlayValue(values, 'name').trim()
  if (!trimmedName || trimmedName === currentName) return
  if (/[\\/]/.test(trimmedName)) {
    uiOverlay.notify({
      title: '名称格式无效',
      message: '重命名仅支持修改名称，不支持输入路径（请勿包含 "/" 或 "\\\\"）。',
      tone: 'warning',
    })
    return
  }

  const dir = extractDirname(current)
  const newPath = dir ? `${dir}/${trimmedName}` : trimmedName
  if (!newPath || newPath === current) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, props.torrent.id, current, newPath)
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Rename path failed:', err)
    showMutationError('重命名失败', err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handleMovePath(node: FileTreeNode) {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (!backendStore.isQbit) return

  const isFile = node.type === 'file'
  const fn = isFile ? (backendStore.adapter as any)?.renameFile : (backendStore.adapter as any)?.renameFolder
  if (typeof fn !== 'function') return

  const kindText = isFile ? '文件' : '文件夹'
  const current = normalizeTorrentPath(node.path)
  const basename = extractBasename(current)
  if (!basename) return

  const currentDir = extractDirname(current)
  const values = await uiOverlay.openForm({
    title: `移动${kindText}`,
    message: '请输入相对种子根目录的目标路径，留空表示根目录。',
    submitLabel: '移动',
    fields: [
      {
        key: 'targetDir',
        label: '目标目录',
        name: 'targetDir',
        defaultValue: currentDir,
        autocomplete: 'off',
      },
    ],
  })
  if (!values) return

  const nextDirRaw = readOverlayValue(values, 'targetDir')
  const nextDir = normalizeTorrentPath(nextDirRaw)
  if (hasUnsafePathSegments(nextDir)) {
    uiOverlay.notify({
      title: '目标目录无效',
      message: '目标目录不允许包含 "." 或 ".."。',
      tone: 'warning',
    })
    return
  }

  if (node.type === 'folder' && nextDir) {
    if (nextDir === current || nextDir.startsWith(`${current}/`)) {
      uiOverlay.notify({
        title: '目标目录无效',
        message: '不能把文件夹移动到自身或其子目录中。',
        tone: 'warning',
      })
      return
    }
  }

  const newPath = nextDir ? `${nextDir}/${basename}` : basename
  if (!newPath || newPath === current) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await fn.call(backendStore.adapter, props.torrent.id, current, newPath)
    emit('refresh')
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Move path failed:', err)
    showMutationError(`移动${kindText}失败`, err)
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}

async function handlePriorityChange(node: FileTreeNode, raw: string) {
  if (!props.torrent?.id || !backendStore.adapter) return
  if (node.type !== 'file') return
  if (typeof node.id !== 'number') return
  const next = parsePriority(raw)
  if (!next) return
  if (node.priority === next) return

  mutating.value = true
  backendStore.beginMutation()
  try {
    await backendStore.adapter.setFilePriority(props.torrent.id, [node.id], next)
    await fetchDetail()
  } catch (err) {
    console.error('[TorrentBottomPanel] Failed to set file priority:', err)
    showMutationError('设置文件优先级失败', err)
    try {
      await fetchDetail()
    } catch {
      // ignore
    }
  } finally {
    backendStore.endMutation()
    mutating.value = false
  }
}
</script>

<template>
  <!-- 底部详情面板 -->
  <div
    v-show="visible"
    class="border-t border-gray-200 bg-white flex flex-col"
    :style="panelStyle"
  >
    <!-- 顶部拖拽调整条 -->
    <div
      @pointerdown="startResize"
      class="h-1 bg-gray-200 hover:bg-gray-300 cursor-ns-resize flex-shrink-0 relative group touch-none select-none"
      :class="{ 'bg-blue-400': isResizing }"
    >
      <div class="absolute inset-x-0 top-0 h-2 -translate-y-1 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <div class="h-0.5 w-12 bg-gray-400 rounded"></div>
      </div>
    </div>

    <!-- 面板头部 -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 flex-1 min-w-0">
        <!-- 种子基本信息 -->
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <Icon
            :name="torrent?.state === 'downloading' ? 'download' : 'upload-cloud'"
            :color="torrent?.state === 'downloading' ? 'blue' : 'cyan'"
            :size="20"
          />
          <div class="min-w-0 flex-1">
            <SafeText
              as="h3"
              class="font-semibold text-gray-900 truncate"
              :text="torrent?.name || '选择一个种子查看详情'"
            />
            <div v-if="torrent" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-gray-500 mt-1">
              <span>{{ formatBytes(torrent.size) }}</span>
              <span>进度 {{ (torrent.progress * 100).toFixed(1) }}%</span>
              <span class="hidden sm:inline">比率 {{ torrent.ratio.toFixed(2) }}</span>
              <div
                v-if="torrent && detail?.partial && detail.hash === torrent.id"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium"
                title="部分详情接口不可用（可能被反代/权限拦截），当前显示为降级结果。"
              >
                <Icon name="alert-triangle" :size="12" />
                <span>部分数据</span>
              </div>
              <div
                class="hidden sm:inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                :class="getHealthStatus(torrent).classes"
                :title="getHealthStatus(torrent).title"
              >
                {{ getHealthStatus(torrent).text }}
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 切换 -->
        <nav class="flex gap-1 p-1 bg-gray-100 rounded-lg overflow-x-auto max-w-full">
          <button
            v-for="tab in [
              { key: 'overview', label: '概览', icon: 'bar-chart-3' },
              { key: 'files', label: '文件', icon: 'file' },
              { key: 'trackers', label: '服务器', icon: 'server' },
              { key: 'peers', label: 'Peers', icon: 'users' }
            ] as const"
            :key="tab.key"
            type="button"
            @click="activeTab = tab.key"
            :aria-pressed="activeTab === tab.key"
            :class="[
              'flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded text-sm font-medium transition-colors whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            ]"
          >
            <Icon :name="tab.icon" :size="14" />
            <span class="hidden sm:inline">{{ tab.label }}</span>
          </button>
        </nav>
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center gap-2 sm:ml-4">
        <!-- 暂停/恢复 -->
        <button
          v-if="torrent"
          type="button"
          @click="handleAction(torrent.state === 'paused' ? 'resume' : 'pause')"
          class="icon-btn"
          :aria-label="torrent.state === 'paused' ? '开始种子' : '暂停种子'"
          :title="torrent.state === 'paused' ? '开始' : '暂停'"
          :disabled="mutating"
        >
          <Icon :name="torrent.state === 'paused' ? 'play' : 'pause'" :size="16" />
        </button>

        <!-- 重新汇报 (Reannounce) -->
        <button
          v-if="torrent"
          type="button"
          @click="handleAction('reannounce')"
          class="icon-btn"
          aria-label="重新汇报种子"
          title="重新汇报"
          :disabled="mutating"
        >
          <Icon name="radio" :size="16" />
        </button>

        <!-- 重新校验 -->
        <button
          v-if="torrent"
          type="button"
          @click="handleAction('recheck')"
          class="icon-btn"
          aria-label="重新校验种子"
          title="重新校验"
          :disabled="mutating"
        >
          <Icon name="refresh-cw" :size="16" />
        </button>

        <!-- 强制开始 -->
        <button
          v-if="torrent && torrent.state !== 'paused'"
          type="button"
          @click="handleAction('forceStart')"
          class="icon-btn text-amber-600 hover:bg-amber-50 hover:border-amber-200"
          aria-label="强制开始种子"
          title="强制开始"
          :disabled="mutating"
        >
          <Icon name="zap" :size="16" />
        </button>

        <!-- 移动位置 -->
        <button
          v-if="torrent"
          type="button"
          @click="handleSetLocation"
          class="icon-btn"
          aria-label="移动保存位置"
          title="移动位置"
          :disabled="mutating"
        >
          <Icon name="folder-open" :size="16" />
        </button>

        <!-- 单种子限速 -->
        <button
          v-if="torrent"
          type="button"
          @click="openLimitDialog"
          class="icon-btn"
          aria-label="编辑单种子限速"
          title="单种子限速"
          :disabled="mutating"
        >
          <Icon name="sliders" :size="16" />
        </button>

        <!-- 重命名（qB） -->
        <button
          v-if="torrent && canRenameTorrent"
          type="button"
          @click="handleRenameTorrent"
          class="icon-btn"
          aria-label="重命名种子"
          title="重命名"
          :disabled="mutating"
        >
          <Icon name="edit-2" :size="16" />
        </button>

        <!-- 关闭 -->
        <button
          type="button"
          @click="emit('close')"
          class="icon-btn"
          aria-label="关闭详情面板"
          title="关闭详情面板"
        >
          <Icon name="x" :size="16" />
        </button>
      </div>
    </div>

    <!-- 面板内容 -->
    <div class="flex-1 overflow-hidden">
      <!-- 加载状态 -->
      <div v-if="loading" class="flex items-center justify-center h-full">
        <div class="flex items-center gap-3 text-gray-500">
          <Icon name="loader-2" :size="20" class="animate-spin" />
          <span>加载详情中...</span>
        </div>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="flex items-center justify-center h-full">
        <div class="text-center">
          <Icon name="alert-circle" color="red" :size="24" class="mx-auto mb-2" />
          <p class="text-red-600 font-medium">{{ error }}</p>
          <button @click="fetchDetail" class="btn mt-3 text-sm">重试</button>
        </div>
      </div>

      <!-- 无种子选择 -->
      <div v-else-if="!torrent" class="flex items-center justify-center h-full">
        <div class="text-center text-gray-500">
          <Icon name="mouse-pointer-click" :size="24" class="mx-auto mb-3 text-gray-300" />
          <p>点击上方种子列表中的任意种子查看详情</p>
        </div>
      </div>

      <!-- 详情内容 -->
      <div v-else-if="detail" class="h-full overflow-hidden flex flex-col">
        <!-- 概览 Tab -->
        <div v-if="activeTab === 'overview'" class="flex-1 overflow-auto p-4 space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 传输统计 -->
            <div class="space-y-4">
              <h4 class="font-semibold text-gray-900 flex items-center gap-2">
                <Icon name="activity" :size="16" />
                传输统计
              </h4>
              <div class="bg-gray-50 rounded-lg p-4 space-y-3">
                <div class="flex justify-between">
                  <span class="text-gray-600">下载速度</span>
                  <span class="font-mono font-medium">{{ formatSpeed(torrent.dlspeed) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">上传速度</span>
                  <span class="font-mono font-medium">{{ formatSpeed(torrent.upspeed) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">已下载</span>
                  <span class="font-mono font-medium">{{ formatBytes(torrent.size * torrent.progress) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">剩余时间</span>
                  <span class="font-mono font-medium">{{ torrent.eta ? formatETA(torrent.eta) : '∞' }}</span>
                </div>
              </div>
            </div>

            <!-- 连接统计 -->
            <div class="space-y-4">
              <h4 class="font-semibold text-gray-900 flex items-center gap-2">
                <Icon name="wifi" :size="16" />
                连接统计
              </h4>
              <div class="bg-gray-50 rounded-lg p-4 space-y-3">
                <div class="flex justify-between">
                  <span class="text-gray-600">做种</span>
                  <span class="font-mono font-medium">{{ formatCountPair(torrent.connectedSeeds, torrent.totalSeeds, torrent.numSeeds) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">下载者</span>
                  <span class="font-mono font-medium">{{ formatCountPair(torrent.connectedPeers, torrent.totalPeers, torrent.numPeers) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">总数</span>
                  <span class="font-mono font-medium">{{ formatTotalPeers(torrent) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-600">健康状态</span>
                  <span
                    class="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                    :class="getHealthStatus(torrent).classes"
                    :title="getHealthStatus(torrent).title"
                  >
                    {{ getHealthStatus(torrent).text }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 进度条详细信息 -->
          <div class="space-y-4">
            <h4 class="font-semibold text-gray-900 flex items-center gap-2">
              <Icon name="trending-up" :size="16" />
              下载进度
            </h4>
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="flex justify-between text-sm text-gray-600 mb-2">
                <span>{{ (torrent.progress * 100).toFixed(2) }}% 完成</span>
                <span>{{ formatBytes(torrent.size * torrent.progress) }} / {{ formatBytes(torrent.size) }}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-3">
                <div
                  class="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full transition-[width] duration-300"
                  :style="{ width: `${Math.max(torrent.progress * 100, 1)}%` }"
                ></div>
              </div>
            </div>
          </div>

          <!-- 限速与优先级 -->
          <div class="space-y-4">
            <h4 class="font-semibold text-gray-900 flex items-center gap-2">
              <Icon name="sliders" :size="16" />
              限速与优先级
            </h4>
            <div class="bg-gray-50 rounded-lg p-4 space-y-3">
              <div class="flex justify-between">
                <span class="text-gray-600">下载限速</span>
                <span class="font-mono font-medium">{{ detail.dlLimit > 0 ? formatSpeed(detail.dlLimit) : '∞' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-600">上传限速</span>
                <span class="font-mono font-medium">{{ detail.upLimit > 0 ? formatSpeed(detail.upLimit) : '∞' }}</span>
              </div>

              <div v-if="canBandwidthPriority" class="flex justify-between items-center gap-4">
                <span class="text-gray-600">带宽优先级</span>
                <select
                  :value="detail.bandwidthPriority || 'normal'"
                  @click.stop
                  @change="handleBandwidthPriorityChange(($event.target as HTMLSelectElement).value)"
                  class="rounded bg-transparent px-2 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                  aria-label="设置带宽优先级"
                  :disabled="mutating"
                >
                  <option value="low">低</option>
                  <option value="normal">普通</option>
                  <option value="high">高</option>
                </select>
              </div>

              <div class="flex justify-end">
                <button type="button" @click="openLimitDialog" class="btn text-sm" :disabled="mutating">编辑限速</button>
              </div>
            </div>
          </div>

          <!-- 高级开关 -->
          <div v-if="canTorrentAdvancedSwitches" class="space-y-4">
            <h4 class="font-semibold text-gray-900 flex items-center gap-2">
              <Icon name="settings" :size="16" />
              高级开关
            </h4>
            <div class="bg-gray-50 rounded-lg p-4 space-y-3">
              <label v-if="canAutoManagement" class="flex items-center justify-between gap-4">
                <span class="text-gray-700">自动管理</span>
                <input
                  type="checkbox"
                  :checked="detail.autoManagement === true"
                  @change="handleAdvancedSwitch('autoManagement', ($event.target as HTMLInputElement).checked)"
                  class="h-4 w-4"
                  :disabled="mutating"
                />
              </label>
              <label v-if="canSequentialDownload" class="flex items-center justify-between gap-4">
                <span class="text-gray-700">顺序下载</span>
                <input
                  type="checkbox"
                  :checked="detail.sequentialDownload === true"
                  @change="handleAdvancedSwitch('sequentialDownload', ($event.target as HTMLInputElement).checked)"
                  class="h-4 w-4"
                  :disabled="mutating"
                />
              </label>
              <label v-if="canFirstLastPiecePriority" class="flex items-center justify-between gap-4">
                <span class="text-gray-700">首尾块优先</span>
                <input
                  type="checkbox"
                  :checked="detail.firstLastPiecePriority === true"
                  @change="handleAdvancedSwitch('firstLastPiecePriority', ($event.target as HTMLInputElement).checked)"
                  class="h-4 w-4"
                  :disabled="mutating"
                />
              </label>
              <label v-if="canSuperSeeding" class="flex items-center justify-between gap-4">
                <span class="text-gray-700">超级做种</span>
                <input
                  type="checkbox"
                  :checked="detail.superSeeding === true"
                  @change="handleAdvancedSwitch('superSeeding', ($event.target as HTMLInputElement).checked)"
                  class="h-4 w-4"
                  :disabled="mutating"
                />
              </label>
            </div>
          </div>
        </div>

        <!-- 文件 Tab -->
        <div v-else-if="activeTab === 'files'" class="h-full flex flex-col">
          <!-- 表头 -->
          <ResizableTableHeader
            :columns="filesColumns"
            :resize-state="filesResizeState"
            @start-resize="(leftId, rightId, startX, snapshots) => startFilesResize(leftId, rightId, startX, snapshots)"
          />

          <!-- 文件树列表 -->
          <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable;">
            <template v-for="node in buildFileTree(detail.files)" :key="node.path">
              <!-- 文件夹节点 -->
              <div v-if="node.type === 'folder'">
                <div
                  @click="toggleFolder(node.path)"
                  @keydown="handleFolderRowKeydown($event, node.path)"
                  @contextmenu="openFileContextMenu($event, node)"
                  class="flex items-center py-1.5 hover:bg-gray-50 border-b border-gray-100 cursor-pointer text-sm"
                  role="button"
                  tabindex="0"
                  :aria-label="`${expandedFolders.has(node.path) ? '折叠' : '展开'}文件夹 ${node.name}`"
                >
                  <!-- 文件名 -->
                  <div
                    class="min-w-0 px-3"
                    :style="getFlexStyle(filesColumnById, 'filename', false, filesResizeState.isResizing)"
                  >
                    <div class="flex items-center min-w-0 w-full" :style="{ paddingLeft: `${8 + node.level * 16}px` }">
                      <Icon
                        :name="expandedFolders.has(node.path) ? 'chevron-down' : 'chevron-right'"
                        :size="12"
                        class="text-gray-400 shrink-0 mr-1"
                      />
                      <Icon name="folder" :size="14" class="text-yellow-500 shrink-0 mr-1.5" />
                      <span class="truncate text-gray-700 flex-1 min-w-0">{{ node.name }}</span>
                      <button
                        v-if="canRenameFolder"
                        type="button"
                        @click.stop="handleRenamePath(node)"
                        class="ml-2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                        aria-label="重命名文件夹"
                        title="重命名文件夹"
                        :disabled="mutating"
                      >
                        <Icon name="edit-2" :size="12" />
                      </button>
                      <button
                        v-if="canMoveFolder"
                        type="button"
                        @click.stop="handleMovePath(node)"
                        class="ml-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                        aria-label="移动文件夹"
                        title="移动文件夹"
                        :disabled="mutating"
                      >
                        <Icon name="folder-input" :size="12" />
                      </button>
                    </div>
                  </div>

                  <!-- 大小 -->
                  <div
                    class="px-3 text-right font-mono text-xs text-gray-500"
                    :style="getFlexStyle(filesColumnById, 'size', false, filesResizeState.isResizing)"
                  >
                    {{ formatBytes(calculateFolderStats(node).size) }}
                  </div>

                  <!-- 进度 -->
                  <div class="px-3" :style="getFlexStyle(filesColumnById, 'progress', false, filesResizeState.isResizing)">
                        <div class="flex items-center gap-1.5 justify-end">
                          <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                            <div
                              class="bg-blue-500 h-1 rounded transition-[width] duration-300"
                              :style="{ width: `${calculateFolderStats(node).progress * 100}%` }"
                            />
                          </div>
                      <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                        {{ (calculateFolderStats(node).progress * 100).toFixed(0) }}%
                      </span>
                    </div>
                  </div>

                  <!-- 优先级 -->
                  <div class="px-3 text-center text-xs text-gray-400" :style="getFlexStyle(filesColumnById, 'priority', false, filesResizeState.isResizing)">
                    -
                  </div>
                </div>

                <!-- 递归渲染子节点 -->
                <template v-if="expandedFolders.has(node.path)">
                  <template v-for="child in node.children" :key="child.path">
                    <!-- 子文件夹 -->
                    <div v-if="child.type === 'folder'">
                      <div
                        @click="toggleFolder(child.path)"
                        @keydown="handleFolderRowKeydown($event, child.path)"
                        @contextmenu="openFileContextMenu($event, child)"
                        class="flex items-center py-1.5 hover:bg-gray-50 border-b border-gray-100 cursor-pointer text-sm"
                        role="button"
                        tabindex="0"
                        :aria-label="`${expandedFolders.has(child.path) ? '折叠' : '展开'}文件夹 ${child.name}`"
                      >
                        <!-- 文件名 -->
                        <div
                          class="min-w-0 px-3"
                          :style="getFlexStyle(filesColumnById, 'filename', false, filesResizeState.isResizing)"
                        >
                          <div class="flex items-center min-w-0 w-full" :style="{ paddingLeft: `${8 + child.level * 16}px` }">
                            <Icon
                              :name="expandedFolders.has(child.path) ? 'chevron-down' : 'chevron-right'"
                              :size="12"
                              class="text-gray-400 shrink-0 mr-1"
                            />
                            <Icon name="folder" :size="14" class="text-yellow-500 shrink-0 mr-1.5" />
                            <span class="truncate text-gray-700 flex-1 min-w-0">{{ child.name }}</span>
                            <button
                              v-if="canRenameFolder"
                              type="button"
                              @click.stop="handleRenamePath(child)"
                              class="ml-2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                              aria-label="重命名文件夹"
                              title="重命名文件夹"
                              :disabled="mutating"
                            >
                              <Icon name="edit-2" :size="12" />
                            </button>
                            <button
                              v-if="canMoveFolder"
                              type="button"
                              @click.stop="handleMovePath(child)"
                              class="ml-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                              aria-label="移动文件夹"
                              title="移动文件夹"
                              :disabled="mutating"
                            >
                              <Icon name="folder-input" :size="12" />
                            </button>
                          </div>
                        </div>

                        <!-- 大小 -->
                        <div
                          class="px-3 text-right font-mono text-xs text-gray-500"
                          :style="getFlexStyle(filesColumnById, 'size', false, filesResizeState.isResizing)"
                        >
                          {{ formatBytes(calculateFolderStats(child).size) }}
                        </div>

                        <!-- 进度 -->
                        <div class="px-3" :style="getFlexStyle(filesColumnById, 'progress', false, filesResizeState.isResizing)">
                            <div class="flex items-center gap-1.5 justify-end">
                              <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                                <div
                                  class="bg-blue-500 h-1 rounded transition-[width] duration-300"
                                  :style="{ width: `${calculateFolderStats(child).progress * 100}%` }"
                                />
                              </div>
                            <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                              {{ (calculateFolderStats(child).progress * 100).toFixed(0) }}%
                            </span>
                          </div>
                        </div>

                        <!-- 优先级 -->
                        <div class="px-3 text-center text-xs text-gray-400" :style="getFlexStyle(filesColumnById, 'priority', false, filesResizeState.isResizing)">
                          -
                        </div>
                      </div>

                      <!-- 继续递归子文件夹 -->
                      <template v-if="expandedFolders.has(child.path)">
                        <template v-for="grandchild in child.children" :key="grandchild.path">
                          <!-- 文件 -->
                          <div
                            v-if="grandchild.type === 'file'"
                            class="flex items-center py-1.5 hover:bg-gray-50 border-b border-gray-100 text-sm"
                            @contextmenu="openFileContextMenu($event, grandchild)"
                          >
                            <!-- 文件名 -->
                            <div
                              class="min-w-0 px-3"
                              :style="getFlexStyle(filesColumnById, 'filename', false, filesResizeState.isResizing)"
                            >
                              <div class="flex items-center min-w-0 w-full" :style="{ paddingLeft: `${8 + grandchild.level * 16}px` }">
                                <span class="w-3.5 shrink-0"></span>
                                <Icon name="file" :size="14" class="text-gray-400 shrink-0 mr-1.5" />
                                <span class="truncate text-gray-900 flex-1 min-w-0">{{ grandchild.name }}</span>
                                <button
                                  v-if="canRenameFile"
                                  type="button"
                                  @click.stop="handleRenamePath(grandchild)"
                                  class="ml-2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                                  aria-label="重命名文件"
                                  title="重命名文件"
                                  :disabled="mutating"
                                >
                                  <Icon name="edit-2" :size="12" />
                                </button>
                                <button
                                  v-if="canMoveFile"
                                  type="button"
                                  @click.stop="handleMovePath(grandchild)"
                                  class="ml-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                                  aria-label="移动文件"
                                  title="移动文件"
                                  :disabled="mutating"
                                >
                                  <Icon name="folder-input" :size="12" />
                                </button>
                              </div>
                            </div>

                            <!-- 大小 -->
                            <div
                              class="px-3 text-right font-mono text-xs text-gray-600"
                              :style="getFlexStyle(filesColumnById, 'size', false, filesResizeState.isResizing)"
                            >
                              {{ formatBytes(grandchild.size!) }}
                            </div>

                            <!-- 进度 -->
                            <div class="px-3" :style="getFlexStyle(filesColumnById, 'progress', false, filesResizeState.isResizing)">
                              <div class="flex items-center gap-1.5 justify-end">
                                <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                                  <div
                                    class="bg-blue-500 h-1 rounded transition-[width] duration-300"
                                    :style="{ width: `${grandchild.progress! * 100}%` }"
                                  />
                                </div>
                                <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                                  {{ (grandchild.progress! * 100).toFixed(0) }}%
                                </span>
                              </div>
                            </div>

                            <!-- 优先级 -->
                            <div
                              class="px-3 text-center"
                              :style="getFlexStyle(filesColumnById, 'priority', false, filesResizeState.isResizing)"
                            >
                              <select
                                :value="grandchild.priority || 'normal'"
                                @click.stop
                                @change="handlePriorityChange(grandchild, ($event.target as HTMLSelectElement).value)"
                                class="w-full rounded bg-transparent px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                                :class="priorityMap[grandchild.priority || 'normal']?.class || 'text-gray-600'"
                                aria-label="设置文件优先级"
                                :disabled="mutating"
                              >
                                <option value="do_not_download">跳过</option>
                                <option v-if="backendStore.isTrans" value="low">低</option>
                                <option value="normal">普</option>
                                <option value="high">高</option>
                              </select>
                            </div>
                          </div>
                        </template>
                      </template>
                    </div>

                    <!-- 文件节点（直接子节点） -->
                    <div
                      v-else
                      class="flex items-center py-1.5 hover:bg-gray-50 border-b border-gray-100 text-sm"
                      @contextmenu="openFileContextMenu($event, child)"
                    >
                      <!-- 文件名 -->
                      <div
                        class="min-w-0 px-3"
                        :style="getFlexStyle(filesColumnById, 'filename', false, filesResizeState.isResizing)"
                      >
                        <div class="flex items-center min-w-0 w-full" :style="{ paddingLeft: `${8 + child.level * 16}px` }">
                          <span class="w-3.5 shrink-0"></span>
                          <Icon name="file" :size="14" class="text-gray-400 shrink-0 mr-1.5" />
                          <span class="truncate text-gray-900 flex-1 min-w-0">{{ child.name }}</span>
                          <button
                            v-if="canRenameFile"
                            type="button"
                            @click.stop="handleRenamePath(child)"
                            class="ml-2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                            aria-label="重命名文件"
                            title="重命名文件"
                            :disabled="mutating"
                          >
                            <Icon name="edit-2" :size="12" />
                          </button>
                          <button
                            v-if="canMoveFile"
                            type="button"
                            @click.stop="handleMovePath(child)"
                            class="ml-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                            aria-label="移动文件"
                            title="移动文件"
                            :disabled="mutating"
                          >
                            <Icon name="folder-input" :size="12" />
                          </button>
                        </div>
                      </div>

                      <!-- 大小 -->
                      <div
                        class="px-3 text-right font-mono text-xs text-gray-600"
                        :style="getFlexStyle(filesColumnById, 'size', false, filesResizeState.isResizing)"
                      >
                        {{ formatBytes(child.size!) }}
                      </div>

                      <!-- 进度 -->
                      <div class="px-3" :style="getFlexStyle(filesColumnById, 'progress', false, filesResizeState.isResizing)">
                        <div class="flex items-center gap-1.5 justify-end">
                          <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                            <div
                              class="bg-blue-500 h-1 rounded transition-[width] duration-300"
                              :style="{ width: `${child.progress! * 100}%` }"
                            />
                          </div>
                          <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                            {{ (child.progress! * 100).toFixed(0) }}%
                          </span>
                        </div>
                      </div>

                      <!-- 优先级 -->
                      <div
                        class="px-3 text-center"
                        :style="getFlexStyle(filesColumnById, 'priority', false, filesResizeState.isResizing)"
                      >
                        <select
                          :value="child.priority || 'normal'"
                          @click.stop
                          @change="handlePriorityChange(child, ($event.target as HTMLSelectElement).value)"
                          class="w-full rounded bg-transparent px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                          :class="priorityMap[child.priority || 'normal']?.class || 'text-gray-600'"
                          aria-label="设置文件优先级"
                          :disabled="mutating"
                        >
                          <option value="do_not_download">跳过</option>
                          <option v-if="backendStore.isTrans" value="low">低</option>
                          <option value="normal">普</option>
                          <option value="high">高</option>
                        </select>
                      </div>
                    </div>
                  </template>
                </template>
              </div>

              <!-- 顶级文件节点（无文件夹） -->
              <div
                v-else
                class="flex items-center py-1.5 hover:bg-gray-50 border-b border-gray-100 text-sm"
                @contextmenu="openFileContextMenu($event, node)"
              >
                <!-- 文件名 -->
                <div
                  class="min-w-0 px-3"
                  :style="getFlexStyle(filesColumnById, 'filename', false, filesResizeState.isResizing)"
                >
                  <div class="flex items-center min-w-0 w-full" :style="{ paddingLeft: `${8 + node.level * 16}px` }">
                    <span class="w-3.5 shrink-0"></span>
                    <Icon name="file" :size="14" class="text-gray-400 shrink-0 mr-1.5" />
                    <span class="truncate text-gray-900 flex-1 min-w-0">{{ node.name }}</span>
                    <button
                      v-if="canRenameFile"
                      type="button"
                      @click.stop="handleRenamePath(node)"
                      class="ml-2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                      aria-label="重命名文件"
                      title="重命名文件"
                      :disabled="mutating"
                    >
                      <Icon name="edit-2" :size="12" />
                    </button>
                    <button
                      v-if="canMoveFile"
                      type="button"
                      @click.stop="handleMovePath(node)"
                      class="ml-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 shrink-0"
                      aria-label="移动文件"
                      title="移动文件"
                      :disabled="mutating"
                    >
                      <Icon name="folder-input" :size="12" />
                    </button>
                  </div>
                </div>

                <!-- 大小 -->
                <div
                  class="px-3 text-right font-mono text-xs text-gray-600"
                  :style="getFlexStyle(filesColumnById, 'size', false, filesResizeState.isResizing)"
                >
                  {{ formatBytes(node.size!) }}
                </div>

                <!-- 进度 -->
                <div class="px-3" :style="getFlexStyle(filesColumnById, 'progress', false, filesResizeState.isResizing)">
                  <div class="flex items-center gap-1.5 justify-end">
                    <div class="flex-1 bg-gray-200 rounded h-1 min-w-0">
                      <div
                        class="bg-blue-500 h-1 rounded transition-[width] duration-300"
                        :style="{ width: `${node.progress! * 100}%` }"
                      />
                    </div>
                    <span class="text-[10px] font-mono text-gray-500 w-8 text-right shrink-0">
                      {{ (node.progress! * 100).toFixed(0) }}%
                    </span>
                  </div>
                </div>

                <!-- 优先级 -->
                <div
                  class="px-3 text-center"
                  :style="getFlexStyle(filesColumnById, 'priority', false, filesResizeState.isResizing)"
                >
                  <select
                    :value="node.priority || 'normal'"
                    @click.stop
                    @change="handlePriorityChange(node, ($event.target as HTMLSelectElement).value)"
                    class="w-full rounded bg-transparent px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                    :class="priorityMap[node.priority || 'normal']?.class || 'text-gray-600'"
                    aria-label="设置文件优先级"
                    :disabled="mutating"
                  >
                    <option value="do_not_download">跳过</option>
                    <option v-if="backendStore.isTrans" value="low">低</option>
                    <option value="normal">普</option>
                    <option value="high">高</option>
                  </select>
                </div>
              </div>
            </template>
          </div>

          <!-- 底部统计 -->
          <div class="px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 shrink-0">
            {{ detail.files.length }} 个文件
          </div>
        </div>

        <!-- 服务器 Tab -->
        <div v-else-if="activeTab === 'trackers'" class="h-full flex flex-col">
          <div
            v-if="canTrackerManagement"
            class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0"
          >
            <button
              type="button"
              @click="handleAddTrackers"
              class="icon-btn"
              aria-label="添加 Tracker"
              title="添加 Tracker"
              :disabled="mutating"
            >
              <Icon name="plus" :size="16" />
            </button>
            <button
              type="button"
              @click="handleEditSelectedTracker"
              class="icon-btn"
              aria-label="编辑已选 Tracker"
              title="编辑 Tracker"
              :disabled="mutating || selectedTrackerUrls.size !== 1"
            >
              <Icon name="edit-2" :size="16" />
            </button>
            <button
              type="button"
              @click="handleRemoveSelectedTrackers"
              class="icon-btn icon-btn-danger"
              aria-label="移除已选 Tracker"
              title="移除 Tracker"
              :disabled="mutating || selectedTrackerUrls.size === 0"
            >
              <Icon name="trash-2" :size="16" />
            </button>
            <div class="ml-auto text-xs text-gray-500">
              已选 {{ selectedTrackerUrls.size }}
            </div>
          </div>

          <!-- 表头 -->
          <ResizableTableHeader
            :columns="trackersColumns"
            :resize-state="trackersResizeState"
            @start-resize="(leftId, rightId, startX, snapshots) => startTrackersResize(leftId, rightId, startX, snapshots)"
          />

          <!-- Tracker 列表 -->
          <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable;">
            <div
              v-for="(tracker, index) in detail.trackers"
              :key="index"
              @click="toggleTrackerSelection(tracker.url)"
              @keydown.enter.prevent="toggleTrackerSelection(tracker.url)"
              @keydown.space.prevent="toggleTrackerSelection(tracker.url)"
              class="flex items-center py-2 border-b border-gray-100 text-sm cursor-pointer"
              :class="selectedTrackerUrls.has(tracker.url) ? 'bg-blue-50' : 'hover:bg-gray-50'"
              role="button"
              tabindex="0"
              :aria-pressed="selectedTrackerUrls.has(tracker.url)"
              :aria-label="`选择 Tracker ${tracker.url}`"
            >
              <!-- URL -->
              <div class="min-w-0 px-3" :style="getFlexStyle(trackersColumnById, 'url', false, trackersResizeState.isResizing)">
                <span class="truncate font-mono text-gray-900 text-xs block">
                  {{ tracker.url }}
                </span>
                <span v-if="tracker.msg" class="truncate text-gray-500 text-[10px] block">
                  {{ tracker.msg }}
                </span>
              </div>

              <!-- 状态 -->
              <div class="px-3 text-center shrink-0" :style="getFlexStyle(trackersColumnById, 'status', false, trackersResizeState.isResizing)">
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                  :class="trackerStatusMap[tracker.status]?.class || 'bg-gray-100 text-gray-600'"
                >
                  <span class="text-[8px]">{{ trackerStatusMap[tracker.status]?.icon || '○' }}</span>
                  <span>{{ trackerStatusMap[tracker.status]?.text || tracker.status }}</span>
                </span>
              </div>

              <!-- Peers -->
              <div class="px-3 text-right font-mono text-xs text-gray-600 shrink-0" :style="getFlexStyle(trackersColumnById, 'peers', false, trackersResizeState.isResizing)">
                {{ tracker.peers }}
              </div>

              <!-- Tier -->
              <div class="px-3 text-right text-xs text-gray-600 shrink-0" :style="getFlexStyle(trackersColumnById, 'tier', false, trackersResizeState.isResizing)">
                {{ tracker.tier }}
              </div>
            </div>
          </div>

          <!-- 底部统计 -->
          <div class="px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 shrink-0">
            {{ detail.trackers.length }} 个 Tracker
          </div>
        </div>

        <!-- Peers Tab -->
        <div v-else-if="activeTab === 'peers'" class="h-full flex flex-col">
          <div
            v-if="canPeerManagement"
            class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0"
          >
            <button
              type="button"
              @click="handleAddPeers"
              class="icon-btn"
              aria-label="添加 Peers"
              title="添加 Peers"
              :disabled="mutating"
            >
              <Icon name="plus" :size="16" />
            </button>
            <button
              type="button"
              @click="handleBanSelectedPeers"
              class="icon-btn icon-btn-danger"
              aria-label="封禁已选 Peers"
              title="封禁已选 Peers（全局）"
              :disabled="mutating || selectedPeers.size === 0"
            >
              <Icon name="alert-triangle" :size="16" />
            </button>
            <div class="ml-auto text-xs text-gray-500">
              已选 {{ selectedPeers.size }}
            </div>
          </div>

          <!-- 表头 -->
          <ResizableTableHeader
            :columns="peersColumns"
            :resize-state="peersResizeState"
            @start-resize="(leftId, rightId, startX, snapshots) => startPeersResize(leftId, rightId, startX, snapshots)"
          />

          <!-- Peer 列表 -->
          <div class="flex-1 overflow-auto" style="scrollbar-gutter: stable;">
            <div
              v-for="(peer, index) in detail.peers"
              :key="index"
              @click="togglePeerSelection(peer)"
              @keydown.enter.prevent="togglePeerSelection(peer)"
              @keydown.space.prevent="togglePeerSelection(peer)"
              class="flex items-center py-2 border-b border-gray-100 text-sm cursor-pointer"
              :class="selectedPeers.has(peerKey(peer)) ? 'bg-blue-50' : 'hover:bg-gray-50'"
              role="button"
              tabindex="0"
              :aria-pressed="selectedPeers.has(peerKey(peer))"
              :aria-label="`选择 Peer ${peer.ip}:${peer.port}`"
            >
              <!-- IP:Port -->
              <div class="px-3 shrink-0" :style="getFlexStyle(peersColumnById, 'address', false, peersResizeState.isResizing)">
                <span class="font-mono text-gray-900 truncate text-xs block">
                  {{ peer.ip }}:{{ peer.port }}
                </span>
              </div>

              <!-- 客户端 -->
              <div class="min-w-0 px-3" :style="getFlexStyle(peersColumnById, 'client', false, peersResizeState.isResizing)">
                <span class="truncate text-gray-700 text-xs block">
                  {{ peer.client || 'Unknown' }}
                </span>
              </div>

              <!-- 进度 -->
              <div class="px-3 text-right shrink-0" :style="getFlexStyle(peersColumnById, 'progress', false, peersResizeState.isResizing)">
                <div class="flex items-center justify-end gap-1.5">
                  <div class="w-10 bg-gray-200 rounded h-1 shrink-0">
                    <div
                      class="bg-blue-500 h-1 rounded transition-[width] duration-300"
                      :style="{ width: `${peer.progress * 100}%` }"
                    />
                  </div>
                  <span class="text-[10px] font-mono text-gray-600 w-7 text-right shrink-0">
                    {{ (peer.progress * 100).toFixed(0) }}%
                  </span>
                </div>
              </div>

              <!-- 下载速度 -->
              <div class="px-3 text-right font-mono text-xs shrink-0" :style="getFlexStyle(peersColumnById, 'dlSpeed', false, peersResizeState.isResizing)">
                <span :class="peer.dlSpeed > 0 ? 'text-blue-600' : 'text-gray-400'">
                  {{ formatSpeed(peer.dlSpeed) }}
                </span>
              </div>

              <!-- 上传速度 -->
              <div class="px-3 text-right font-mono text-xs shrink-0" :style="getFlexStyle(peersColumnById, 'upSpeed', false, peersResizeState.isResizing)">
                <span :class="peer.upSpeed > 0 ? 'text-cyan-600' : 'text-gray-400'">
                  {{ formatSpeed(peer.upSpeed) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 底部统计 -->
          <div class="px-3 py-1 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 shrink-0">
            {{ detail.peers.length }} 个连接
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 单种子限速对话框 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showLimitDialog"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        @click.self="showLimitDialog = false"
      >
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="showLimitDialog"
            class="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
            @click.stop
          >
            <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-900">单种子限速</h2>
              <button
                type="button"
                @click="showLimitDialog = false"
                class="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="关闭单种子限速对话框"
              >
                <Icon name="x" :size="20" class="text-gray-500" />
              </button>
            </div>

            <div class="p-6 space-y-4">
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700">
                  下载限速（{{ speedUnitLabel }}）
                </label>
                <input
                  v-model="dlLimitInput"
                  type="text"
                  class="input font-mono"
                  placeholder="留空或 0 表示不限速"
                />
              </div>

              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700">
                  上传限速（{{ speedUnitLabel }}）
                </label>
                <input
                  v-model="upLimitInput"
                  type="text"
                  class="input font-mono"
                  placeholder="留空或 0 表示不限速"
                />
              </div>

              <p class="text-xs text-gray-500">
                提示：Transmission 的速度单位可能是 kB/s（1000），qBittorrent 按 KiB/s（1024）处理。
              </p>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  class="btn"
                  @click="showLimitDialog = false"
                  :disabled="mutating"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  @click="saveLimits"
                  :disabled="mutating"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <!-- 文件右键菜单 -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
    >
      <div
        v-if="fileContextMenuState.show"
        class="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px] max-h-[60vh] overflow-y-auto"
        :style="{
          left: `${fileMenuPosition.left}px`,
          top: `${fileMenuPosition.top}px`
        }"
        @click.stop
      >
        <button
          v-for="item in fileMenuItems"
          :key="item.id"
          type="button"
          @click="item.action()"
          :class="`w-full px-4 py-2 text-left text-sm flex items-center gap-3 ${
            item.disabled ? 'opacity-50 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50 cursor-pointer'
          }`"
          :disabled="item.disabled"
        >
          <Icon :name="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 确保拖拽调整时有合适的视觉反馈 */
.cursor-ns-resize {
  cursor: ns-resize;
}

/* 防止拖拽时文本被选中 */
.cursor-ns-resize * {
  user-select: none;
}
</style>
