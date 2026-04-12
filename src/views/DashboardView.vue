<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTorrentStore } from '@/store/torrent'
import { useAuthStore } from '@/store/auth'
import { useBackendStore } from '@/store/backend'
import { usePolling } from '@/composables/usePolling'
import { useTorrentContext, type TorrentAction } from '@/composables/useTorrentContext'
import { useUiOverlay } from '@/composables/useUiOverlay'
import { useTableColumns } from '@/composables/useTableColumns'
import { TORRENT_TABLE_COLUMNS } from '@/composables/useTableColumns/configs'
import { AuthError } from '@/api/client'
import type { UnifiedTorrent } from '@/adapter/types'
import type { AddTorrentParams } from '@/adapter/interface'
import type { DashboardDetailTab } from '@/utils/dashboardRouteState'
import TorrentRow from '@/components/torrent/TorrentRow.vue'
import TorrentCard from '@/components/torrent/TorrentCard.vue'
import AddTorrentDialog from '@/components/AddTorrentDialog.vue'
import VirtualTorrentList from '@/components/VirtualTorrentList.vue'
import VirtualTorrentCardList from '@/components/VirtualTorrentCardList.vue'
import TorrentBottomPanel from '@/components/TorrentBottomPanel.vue'
import DashboardSearchControl from '@/components/dashboard/DashboardSearchControl.vue'
import DashboardStatusBar from '@/components/dashboard/DashboardStatusBar.vue'
import ResizableTableHeader from '@/components/table/ResizableTableHeader.vue'
import OverflowActionBar, { type OverflowActionItem } from '@/components/toolbar/OverflowActionBar.vue'
import ColumnSettingsDialog from '@/components/ColumnSettingsDialog.vue'
import BackendSettingsDialog from '@/components/BackendSettingsDialog.vue'
import CategoryManageDialog from '@/components/CategoryManageDialog.vue'
import TagManageDialog from '@/components/TagManageDialog.vue'
import ToolsDialog from '@/components/ToolsDialog.vue'
import FolderTree from '@/components/FolderTree.vue'
import Icon from '@/components/Icon.vue'
import TorrentContextMenu from '@/components/torrent/contextmenu/TorrentContextMenu.vue'
import SafeText from '@/components/SafeText.vue'
import QueueMenu from '@/components/toolbar/QueueMenu.vue'
import ServerSwitchMenu from '@/components/toolbar/ServerSwitchMenu.vue'

// 虚拟滚动阈值：超过 200 个种子时启用虚拟滚动（性能优化）
const VIRTUAL_SCROLL_THRESHOLD = 200
// 移动端卡片视图更重：阈值单独设置，避免大量 DOM 导致窄屏 resize 卡顿
const MOBILE_VIRTUAL_SCROLL_THRESHOLD = 80
const TORRENT_ROW_ESTIMATED_HEIGHT = 60

const router = useRouter()
const route = useRoute()
const torrentStore = useTorrentStore()
const authStore = useAuthStore()
const backendStore = useBackendStore()
const uiOverlay = useUiOverlay()

// 确保在访问 adapter 之前已初始化
if (!backendStore.isInitialized) {
  throw new Error('[DashboardView] Backend not initialized. This should not happen after bootstrap.')
}

const torrentContext = useTorrentContext({
  router,
  route,
  normalizeViewMode: normalizeViewModeForViewport,
})
const { state, actions } = torrentContext
const uiState = state.ui
const { debouncedFilter, stateFilter, categoryFilter, tagFilter } = state.filters
const {
  sortedTorrents,
  selectedCount,
  selectedBadge,
  isAllSelected,
  contextMenuState,
} = state.data
const contextmenuState = contextMenuState
const { selectedTorrentId: requestedDetailTorrentId, detailTab } = state.route
const {
  toggleSort: toggleSortByColumn,
  getSortIconForColumn,
  select,
  selectRange,
  selectAllVisible,
  openContextMenu,
  closeContextMenu,
  refresh: refreshList,
  runTorrentAction,
  runContextMenuAction,
  runBatchSpeedLimit,
  addTorrent,
  setViewMode,
  setSelectedTorrentId,
  setDetailTab,
} = actions

const capabilities = computed(() => backendStore.capabilities)

const sidebarCollapsed = ref(false)
const isMobile = ref(window.innerWidth < 768)
const windowWidth = ref(window.innerWidth)
const tableScrollRef = ref<HTMLElement | null>(null)
const mobileScrollRef = ref<HTMLElement | null>(null)

const transFolderPaths = computed(() =>
  Array.from(backendStore.categories.values()).map(c => c.name)
)

type ScrollAnchor = {
  id?: string
  offset: number
  scrollTop: number
}

const pendingScrollAnchor = ref<ScrollAnchor | null>(null)
let restoreScheduled = false

function captureScrollAnchor(): ScrollAnchor | null {
  const scrollEl = tableScrollRef.value
  if (!scrollEl) return null

  const scrollRect = scrollEl.getBoundingClientRect()
  const rows = Array.from(scrollEl.querySelectorAll<HTMLElement>('[data-torrent-id]'))
  if (rows.length === 0) {
    return { offset: 0, scrollTop: scrollEl.scrollTop }
  }

  let bestRow: HTMLElement | null = null
  let bestOffset = 0

  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (rect.bottom <= scrollRect.top) continue
    if (rect.top >= scrollRect.bottom) continue
    const offset = rect.top - scrollRect.top
    if (!bestRow || Math.abs(offset) < Math.abs(bestOffset)) {
      bestRow = row
      bestOffset = offset
    }
  }

  return {
    id: bestRow?.dataset.torrentId,
    offset: bestOffset,
    scrollTop: scrollEl.scrollTop,
  }
}

async function restoreScrollAnchor() {
  const scrollEl = tableScrollRef.value
  const anchor = pendingScrollAnchor.value
  pendingScrollAnchor.value = null
  restoreScheduled = false
  if (!scrollEl || !anchor) return

  const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)

  const index = anchor.id ? sortedTorrents.value.findIndex(t => t.id === anchor.id) : -1
  if (index < 0) {
    scrollEl.scrollTop = Math.max(0, Math.min(anchor.scrollTop, maxScroll))
    return
  }

  const id = anchor.id
  if (!id) return

  const target = index * TORRENT_ROW_ESTIMATED_HEIGHT - anchor.offset
  scrollEl.scrollTop = Math.max(0, Math.min(target, maxScroll))

  await nextTick()

  const row = scrollEl.querySelector<HTMLElement>(`[data-torrent-id="${CSS.escape(id)}"]`)
  if (!row) return
  const scrollRect = scrollEl.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const offsetNow = rowRect.top - scrollRect.top
  const delta = offsetNow - anchor.offset
  if (delta === 0) return

  scrollEl.scrollTop = Math.max(0, Math.min(scrollEl.scrollTop + delta, maxScroll))
}

function schedulePreserveTopAnchor() {
  if (isMobile.value) return
  if (restoreScheduled) return
  pendingScrollAnchor.value = captureScrollAnchor()
  restoreScheduled = true
  void nextTick().then(restoreScrollAnchor)
}

// 表格列宽调整与可见性控制
const {
  columns,
  resizeState,
  startResize,
  toggleVisibility,
  resetToDefaults
} = useTableColumns('torrents', TORRENT_TABLE_COLUMNS)

// 添加种子对话框
const showAddDialog = ref(false)

// 分类/标签管理对话框
const showCategoryManage = ref(false)
const showTagManage = ref(false)
const showColumnSettings = ref(false)
const showBackendSettings = ref(false)
const showToolsDialog = ref(false)

// 底部详情面板
const showDetailPanel = ref(false)
const selectedTorrent = ref<UnifiedTorrent | null>(null)
const detailPanelHeight = ref(350)
const hasHydratedTorrentList = ref(false)

function normalizeViewModeForViewport(viewMode: 'list' | 'card') {
  if (isMobile.value) return 'card'
  return viewMode === 'card' ? 'list' : viewMode
}

function syncSelectedTorrentFromController(hash: string | null) {
  if (!hash) {
    showDetailPanel.value = false
    selectedTorrent.value = null
    return
  }

  const torrent = torrentStore.torrents.get(hash)
  if (!torrent) {
    showDetailPanel.value = false
    selectedTorrent.value = null
    if (hasHydratedTorrentList.value && requestedDetailTorrentId.value === hash) {
      setSelectedTorrentId(null)
    }
    return
  }

  const shouldSyncSelection = uiState.selection.size === 0 || !uiState.selection.has(hash)
  selectedTorrent.value = torrent
  if (shouldSyncSelection) {
    select(hash, { mode: 'replace' })
  }
  showDetailPanel.value = true
}

function handleDetailTabChange(tab: DashboardDetailTab) {
  setDetailTab(tab)
}

// 选择种子并显示详情
function selectTorrentForDetail(hash: string, event?: Event) {
  const torrent = torrentStore.torrents.get(hash)
  if (!torrent) return

  // 检查是否是特殊按键点击
  const isCtrlClick = event && (event as MouseEvent).ctrlKey
  const isShiftClick = event && (event as MouseEvent).shiftKey
  
  if (isCtrlClick) {
    // Ctrl+点击：切换选择状态，不改变详情面板
    select(hash, { mode: 'toggle' })
    return
  }
  
  if (isShiftClick && uiState.selection.size > 0) {
    // Shift+点击：范围选择
    const allTorrents = sortedTorrents.value
    const lastSelected = Array.from(uiState.selection)[uiState.selection.size - 1]
    const currentIndex = allTorrents.findIndex(t => t.id === hash)
    const lastIndex = allTorrents.findIndex(t => t.id === lastSelected)
    
    if (currentIndex !== -1 && lastIndex !== -1) {
      const start = Math.min(currentIndex, lastIndex)
      const end = Math.max(currentIndex, lastIndex)

      const hashes = allTorrents
        .slice(start, end + 1)
        .map(torrent => torrent.id)
      selectRange(hashes)
    }
    return
  }

  // 普通点击：选择种子并显示详情
  if (!showDetailPanel.value) setDetailTab('overview')
  selectedTorrent.value = torrent
  setSelectedTorrentId(hash)
  showDetailPanel.value = true
  
  // 单选模式
  select(hash, { mode: 'replace' })
}

// 关闭详情面板
function closeDetailPanel() {
  showDetailPanel.value = false
  selectedTorrent.value = null
  setSelectedTorrentId(null)
}

// Store 更新后同步底部面板展示的 torrent 引用；删除后自动关闭详情面板
watch(() => torrentStore.torrents, () => {
  const current = selectedTorrent.value
  if (!current) {
    if (requestedDetailTorrentId.value) {
      syncSelectedTorrentFromController(requestedDetailTorrentId.value)
    }
    return
  }
  const updated = torrentStore.torrents.get(current.id)
  if (updated) selectedTorrent.value = updated
  else closeDetailPanel()
})

watch(
  requestedDetailTorrentId,
  (hash) => syncSelectedTorrentFromController(hash),
  { immediate: true }
)

// 调整面板高度
function resizeDetailPanel(height: number) {
  detailPanelHeight.value = height
}

// 键盘导航
const focusedIndex = ref(-1)

function isKeyboardEventFromEditableTarget(event: KeyboardEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
}

// 键盘事件处理
function handleKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || isKeyboardEventFromEditableTarget(e)) return
  if (sortedTorrents.value.length === 0) return
  
  const maxIndex = sortedTorrents.value.length - 1
  
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      focusedIndex.value = Math.max(0, focusedIndex.value - 1)
      selectTorrentByIndex(focusedIndex.value)
      break
      
    case 'ArrowDown':
      e.preventDefault()
      if (focusedIndex.value === -1) {
        focusedIndex.value = 0
      } else {
        focusedIndex.value = Math.min(maxIndex, focusedIndex.value + 1)
      }
      selectTorrentByIndex(focusedIndex.value)
      break
      
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (focusedIndex.value >= 0) {
        const torrent = sortedTorrents.value[focusedIndex.value]
        if (!torrent) break
        if (e.ctrlKey || e.key === ' ') {
          select(torrent.id, { mode: 'toggle' })
        } else {
          selectTorrentForDetail(torrent.id)
        }
      }
      break
      
    case 'Escape':
      closeDetailPanel()
      break
  }
}

// 通过索引选择种子
function selectTorrentByIndex(index: number) {
  const torrent = sortedTorrents.value[index]
  if (torrent) {
    selectTorrentForDetail(torrent.id)
  }
}

// 监听屏幕尺寸变化
let resizeRafId: number | null = null
let pendingResizeWidth = window.innerWidth
const handleResize = () => {
  pendingResizeWidth = window.innerWidth
  if (resizeRafId !== null) return
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null

    const w = pendingResizeWidth
    if (windowWidth.value !== w) windowWidth.value = w

    const nextMobile = w < 768
    if (isMobile.value !== nextMobile) isMobile.value = nextMobile
    setViewMode(normalizeViewModeForViewport(uiState.viewMode))

    // 移动端自动折叠侧边栏
    if (nextMobile) sidebarCollapsed.value = true

  })
}

// 统计数据 - 优先使用 ServerState 的全局速度（后端不支持时回退到求和）
const stats = computed(() => {
  const torrents = Array.from(torrentStore.torrents.values())
  const ss = backendStore.serverState
  const serverDlSpeed = ss?.dlInfoSpeed
  const serverUpSpeed = ss?.upInfoSpeed
  const hasServerSpeed = typeof serverDlSpeed === 'number' && typeof serverUpSpeed === 'number'

  // 单次遍历完成状态计数（无法避免）
  const result = {
    total: torrents.length,
    downloading: 0,
    seeding: 0,
    paused: 0,
    pausedCompleted: 0,
    pausedIncomplete: 0,
    checking: 0,
    queued: 0,
    error: 0,
    dlSpeed: hasServerSpeed ? serverDlSpeed : 0,
    upSpeed: hasServerSpeed ? serverUpSpeed : 0
  }

  for (const t of torrents) {
    // 状态计数
    if (t.state === 'downloading') result.downloading++
    else if (t.state === 'seeding') result.seeding++
    else if (t.state === 'paused') {
      result.paused++
      // 二级分类：已完成 vs 未完成
      if (t.progress >= 1.0) result.pausedCompleted++
      else result.pausedIncomplete++
    }
    else if (t.state === 'checking') result.checking++
    else if (t.state === 'queued') result.queued++
    else if (t.state === 'error') result.error++

    if (!hasServerSpeed) {
      result.dlSpeed += t.dlspeed
      result.upSpeed += t.upspeed
    }
  }

  return result
})

const totalTorrentSize = computed(() =>
  Array.from(torrentStore.torrents.values()).reduce((sum, torrent) => sum + torrent.size, 0),
)

watch(
  [stateFilter, categoryFilter, tagFilter, debouncedFilter, () => uiState.sortBy, () => uiState.sortOrder],
  () => schedulePreserveTopAnchor(),
  { flush: 'pre' }
)

// 是否使用虚拟滚动（超过阈值时启用）
const useVirtualScroll = computed(() => sortedTorrents.value.length >= VIRTUAL_SCROLL_THRESHOLD)
const useMobileVirtualScroll = computed(() => sortedTorrents.value.length >= MOBILE_VIRTUAL_SCROLL_THRESHOLD)

function handleQueueAction(action: 'queue-top' | 'queue-up' | 'queue-down' | 'queue-bottom') {
  void runTorrentAction(action, Array.from(uiState.selection), { clearSelection: true })
}

function handleToolbarAction(actionId: string) {
  switch (actionId) {
    case 'filter':
      sidebarCollapsed.value = false
      break
    case 'add':
      showAddDialog.value = true
      break
    case 'resume':
      void handleResume()
      break
    case 'pause':
      void handlePause()
      break
    case 'delete':
      void handleDelete()
      break
    case 'selectAll':
      selectAll()
      break
    case 'recheckSelected':
      void handleRecheckSelected()
      break
    case 'forceStartSelected':
      void handleForceStartSelected()
      break
    case 'reannounceSelected':
      void handleReannounceSelected()
      break
    case 'batchSpeedLimit':
      void handleBatchSpeedLimit()
      break
    case 'categoryManage':
      showCategoryManage.value = true
      break
    case 'tagManage':
      showTagManage.value = true
      break
    case 'columns':
      showColumnSettings.value = true
      break
    case 'backendSettings':
      showBackendSettings.value = true
      break
    case 'tools':
      showToolsDialog.value = true
      break
  }
}

const toolbarPrimaryItems = computed<OverflowActionItem[]>(() => [
  { id: 'filter', title: '筛选', icon: 'panel-left', show: isMobile.value, pinned: true, priority: 0, group: 'main', groupLabel: '操作' },
  { id: 'add', title: '添加种子', icon: 'plus', variant: 'primary', pinned: true, priority: 0, group: 'main', groupLabel: '操作' },
  { id: 'resume', title: '开始', icon: 'play', color: 'blue', disabled: selectedCount.value === 0, pinned: true, priority: 1, group: 'main', groupLabel: '操作' },
  { id: 'pause', title: '暂停', icon: 'pause', color: 'gray', disabled: selectedCount.value === 0, pinned: true, priority: 1, group: 'main', groupLabel: '操作' },
  { id: 'delete', title: '删除', icon: 'trash-2', variant: 'danger', disabled: selectedCount.value === 0, pinned: true, priority: 1, group: 'main', groupLabel: '操作' },
])

const toolbarBatchItems = computed<OverflowActionItem[]>(() => [
  { id: 'recheckSelected', title: '重新校验', icon: 'refresh-cw', disabled: selectedCount.value === 0, pinned: true, priority: 0, group: 'batch', groupLabel: '批量' },
  { id: 'reannounceSelected', title: '重新汇报', icon: 'radio', disabled: selectedCount.value === 0, pinned: true, priority: 1, group: 'batch', groupLabel: '批量' },
  { id: 'forceStartSelected', title: '强制开始', icon: 'zap', disabled: selectedCount.value === 0, pinned: true, priority: 2, group: 'batch', groupLabel: '批量' },
  { id: 'batchSpeedLimit', title: '批量限速', icon: 'sliders', disabled: selectedCount.value === 0, pinned: true, priority: 3, group: 'batch', groupLabel: '批量' },
  // 队列管理按钮已移到独立的 QueueMenu 组件中
])

const toolbarSelectItems = computed<OverflowActionItem[]>(() => [
  { id: 'selectAll', title: isAllSelected.value ? '取消全选' : '全选', icon: isAllSelected.value ? 'square-x' : 'square-check', badge: selectedBadge.value, pinned: true, priority: 0, group: 'select', groupLabel: '选择' },
])

const toolbarManageItems = computed<OverflowActionItem[]>(() => [
  { id: 'columns', title: '列设置', icon: 'columns-3', pinned: false, priority: 10, group: 'manage', groupLabel: '管理' },
  { id: 'categoryManage', title: '分类管理', icon: 'folder', show: backendStore.isQbit, pinned: false, priority: 11, group: 'manage', groupLabel: '管理' },
  { id: 'tagManage', title: '标签管理', icon: 'tag', show: backendStore.isQbit || backendStore.isTrans, pinned: false, priority: 12, group: 'manage', groupLabel: '管理' },
  { id: 'backendSettings', title: '设置', icon: 'settings', pinned: false, priority: 13, group: 'manage', groupLabel: '管理' },
  { id: 'tools', title: '工具', icon: 'activity', show: capabilities.value.hasLogs || capabilities.value.hasRss || capabilities.value.hasSearch, pinned: false, priority: 14, group: 'manage', groupLabel: '管理' },
])

const toolbarSingleRowLeftItems = computed<OverflowActionItem[]>(() => [
  ...toolbarPrimaryItems.value,
  ...toolbarBatchItems.value,
  ...toolbarSelectItems.value,
])
const toolbarTwoRowTopItems = computed<OverflowActionItem[]>(() => [
  ...toolbarPrimaryItems.value,
  ...toolbarSelectItems.value,
])

// 渐进式：先在一排内收缩搜索/状态，最后再把“批量+管理”移到第二排
const showSearchInput = computed(() => windowWidth.value >= 1120)
const useTwoRowToolbar = computed(() => windowWidth.value < 960)

async function refreshDashboardData() {
  const result = await refreshList()
  hasHydratedTorrentList.value = true
  return result
}

// 立即刷新函数（操作后调用）
async function immediateRefresh() {
  try {
    await refreshDashboardData()
  } catch (error) {
    console.error('[Dashboard] Refresh failed:', error)
  }
}

// 使用智能轮询（指数退避 + 熔断器 + 页面可见性监听 + 致命错误处理）
const { start: startPolling, failureCount, isCircuitBroken } = usePolling({
  fn: async () => {
    await refreshDashboardData()
  },
  shouldSkip: () => backendStore.isMutating,
  // 遇到 403 立即跳转登录
  onFatalError: (error) => {
    if (error instanceof AuthError) {
      router.replace('/login')
    }
  },
  baseInterval: 2000,
  maxInterval: 30000,
  circuitBreakerThreshold: 5,
  circuitBreakerDelay: 60000,
  pauseWhenHidden: true
})

// 连接状态计算
const connectionStatus = computed(() => {
  if (isCircuitBroken.value) {
    return { text: '连接断开', type: 'error' as const, icon: 'disconnected' }
  }
  if (failureCount.value > 0) {
    return { text: `重连中... (${failureCount.value})`, type: 'warning' as const, icon: 'reconnecting' }
  }
  return { text: '已连接', type: 'success' as const, icon: 'connected' }
})

const connectionLabel = computed(() => {
  if (windowWidth.value >= 1400) return connectionStatus.value.text
  if (connectionStatus.value.type === 'success') return '已连'
  if (connectionStatus.value.type === 'warning') return '异常'
  return '断开'
})

const showToolbarConnection = computed(() => showSearchInput.value && !useTwoRowToolbar.value)

function selectAll() {
  selectAllVisible()
}

async function handlePause() {
  await runTorrentAction('pause', Array.from(uiState.selection), { clearSelection: true })
}

async function handleResume() {
  await runTorrentAction('resume', Array.from(uiState.selection), { clearSelection: true })
}

async function handleDelete() {
  await runTorrentAction('delete', Array.from(uiState.selection), { clearSelection: true })
}

async function logout() {
  await authStore.logout()
  await router.replace('/login')
}

function showActionError(title: string, error: unknown) {
  uiOverlay.notify({
    title,
    message: error instanceof Error ? error.message : title,
    tone: 'danger',
  })
}

function toggleSelect(hash: string) {
  select(hash, { mode: 'toggle' })
}

// 添加种子
async function handleAddTorrent(params: AddTorrentParams) {
  const added = await addTorrent(params)
  if (added) {
    showAddDialog.value = false
  }
}

// 处理种子行操作（来自 TorrentRow 的 action 事件）
async function handleTorrentAction(action: string, hash: string) {
  try {
    await runTorrentAction(action as TorrentAction, [hash])
  } catch (err) {
    console.error('[Dashboard] Action failed:', err)
    showActionError('操作失败', err)
  }
}

// 处理右键菜单打开
function handleContextMenu(e: MouseEvent, hash: string) {
  e.preventDefault()
  e.stopPropagation()

  const hashes = uiState.selection.has(hash)
    ? Array.from(uiState.selection)
    : [hash]

  openContextMenu({ x: e.clientX, y: e.clientY }, hashes)
}

// 处理右键菜单操作
async function handleContextMenuAction(action: string, hashes: string[]) {
  await runContextMenuAction(action, hashes)
}

// 批量操作：重新校验选中项
async function handleRecheckSelected() {
  try {
    await runTorrentAction('recheck', Array.from(uiState.selection), { clearSelection: true })
  } catch (err) {
    console.error('[Dashboard] Recheck failed:', err)
    showActionError('重新校验失败', err)
  }
}

// 批量操作：强制开始选中项
async function handleForceStartSelected() {
  try {
    await runTorrentAction('force-start', Array.from(uiState.selection), { clearSelection: true })
  } catch (err) {
    console.error('[Dashboard] Force start failed:', err)
    showActionError('强制开始失败', err)
  }
}

// 批量操作：重新汇报选中项
async function handleReannounceSelected() {
  try {
    await runTorrentAction('reannounce', Array.from(uiState.selection), { clearSelection: true })
  } catch (err) {
    console.error('[Dashboard] Reannounce failed:', err)
    showActionError('重新汇报失败', err)
  }
}

// 批量操作：限速
async function handleBatchSpeedLimit() {
  await runBatchSpeedLimit(Array.from(uiState.selection))
}

onMounted(() => {
  startPolling()
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  handleResize() // 初始化
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeyDown)
  if (resizeRafId !== null) cancelAnimationFrame(resizeRafId)
})
</script>

<template>
  <div class="h-screen flex bg-gray-50">
    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden relative">
      <!-- 移动端遮罩层 -->
      <div
        v-if="!sidebarCollapsed && isMobile"
        @click="sidebarCollapsed = true"
        class="fixed inset-0 bg-black/50 z-40 md:hidden"
      ></div>

      <!-- 左侧边栏 -->
      <aside
        :class="`bg-white border-r border-gray-200 flex flex-col shrink-0 z-50
        ${isMobile
          ? (sidebarCollapsed ? '-translate-x-full w-64 fixed left-0 top-0 h-full transition-transform duration-300' : 'translate-x-0 w-64 fixed left-0 top-0 h-full transition-transform duration-300')
          : (sidebarCollapsed ? 'w-16' : 'w-64')
        }`"
        :style="!isMobile ? 'transition: width 300ms ease;' : ''"
      >
        <!-- 移动端顶部栏 -->
        <div v-if="isMobile" class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 class="font-medium text-gray-900">筛选</h2>
          <button
            type="button"
            class="btn p-2 hover:bg-gray-100"
            aria-label="关闭筛选侧栏"
            @click="sidebarCollapsed = true"
          >
            <Icon name="x" :size="16" />
          </button>
        </div>

        <!-- 桌面端侧边栏头部 -->
        <div v-else class="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 :class="`font-medium text-gray-900 ${sidebarCollapsed ? 'hidden' : ''}`">TorrentMix UI</h2>
          <button
            type="button"
            class="btn p-2 hover:bg-gray-100"
            :aria-label="sidebarCollapsed ? '展开筛选侧栏' : '折叠筛选侧栏'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <Icon name="chevron-left" :size="16" :class="{ 'rotate-180': sidebarCollapsed }" />
          </button>
        </div>

        <!-- 过滤器列表 -->
        <nav class="flex-1 overflow-y-auto p-2">
          <div class="space-y-1">
            <button
              type="button"
              aria-label="筛选全部种子"
              @click="stateFilter = 'all'"
              :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'all' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
            >
              <Icon name="list" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">全部</span>
              <span v-if="stats.total > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.total }}</span>
            </button>

            <button
              type="button"
              aria-label="筛选下载中的种子"
              @click="stateFilter = 'downloading'"
              :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'downloading' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
            >
              <Icon name="download" color="blue" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">下载中</span>
              <span v-if="stats.downloading > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'downloading' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.downloading }}</span>
            </button>

            <button
              type="button"
              aria-label="筛选做种中的种子"
              @click="stateFilter = 'seeding'"
              :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'seeding' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
            >
              <Icon name="upload-cloud" color="cyan" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">做种中</span>
              <span v-if="stats.seeding > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'seeding' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.seeding }}</span>
            </button>

            <!-- 已暂停（固定展开二级分类） -->
            <div>
              <button
                type="button"
                aria-label="筛选已暂停的种子"
                @click="stateFilter = 'paused'"
                :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'paused' || stateFilter.startsWith('paused-') ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
              >
                <Icon name="pause-circle" color="gray" :size="16" />
                <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">已暂停</span>
                <span v-if="stats.paused > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'paused' || stateFilter.startsWith('paused-') ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.paused }}</span>
              </button>

              <!-- 二级分类：固定展开 -->
              <div v-if="!sidebarCollapsed" class="ml-6 mt-1 space-y-1">
                <button
                  type="button"
                  @click.stop="stateFilter = 'paused-completed'"
                  :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'paused-completed' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`"
                >
                  <Icon name="check-circle" color="green" :size="14" />
                  <span class="truncate text-sm">已完成</span>
                  <span v-if="stats.pausedCompleted > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${stateFilter === 'paused-completed' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.pausedCompleted }}</span>
                </button>

                <button
                  type="button"
                  @click.stop="stateFilter = 'paused-incomplete'"
                  :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'paused-incomplete' ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`"
                >
                  <Icon name="download-cloud" color="orange" :size="14" />
                  <span class="truncate text-sm">未完成</span>
                  <span v-if="stats.pausedIncomplete > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${stateFilter === 'paused-incomplete' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.pausedIncomplete }}</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              aria-label="筛选检查中的种子"
              @click="stateFilter = 'checking'"
              :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'checking' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
            >
              <Icon name="refresh-cw" color="purple" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">检查中</span>
              <span v-if="stats.checking > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'checking' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.checking }}</span>
            </button>

            <button
              type="button"
              aria-label="筛选队列中的种子"
              @click="stateFilter = 'queued'"
              :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'queued' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
            >
              <Icon name="clock" color="orange" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">队列中</span>
              <span v-if="stats.queued > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'queued' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.queued }}</span>
            </button>

            <button
              type="button"
              aria-label="筛选出错的种子"
              @click="stateFilter = 'error'"
              :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${stateFilter === 'error' ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`"
            >
              <Icon name="alert-circle" color="red" :size="16" />
              <span :class="`truncate text-sm ${sidebarCollapsed ? 'hidden' : ''}`">错误</span>
              <span v-if="stats.error > 0" :class="`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sidebarCollapsed ? 'hidden' : ''} ${stateFilter === 'error' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`">{{ stats.error }}</span>
            </button>
          </div>

          <!-- 分类/目录筛选 -->
          <div v-if="backendStore.categories.size > 0" :class="`mt-4 ${sidebarCollapsed ? 'hidden' : ''}`">
            <h3 :class="`text-xs font-medium text-gray-500 uppercase tracking-wider px-3 mb-2`">
              {{ backendStore.isTrans ? '目录' : '分类' }}
            </h3>

            <FolderTree
              v-if="backendStore.isTrans"
              v-model="categoryFilter"
              :paths="transFolderPaths"
              all-label="全部目录"
              root-label="默认目录"
            />

            <div v-else class="space-y-1">
              <button
                type="button"
                @click="categoryFilter = 'all'"
                :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${categoryFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`"
              >
                <Icon name="folder" :size="14" />
                <span class="truncate text-sm">全部分类</span>
              </button>
              <button
                v-for="cat in Array.from(backendStore.categories.values())"
                :key="cat.name"
                type="button"
                @click="categoryFilter = cat.name"
                :class="`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors duration-150 ${categoryFilter === cat.name ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`"
              >
                <Icon name="folder" :size="14" />
                <SafeText as="span" class="truncate text-sm" :text="cat.name" />
              </button>
            </div>
          </div>

          <!-- 标签筛选 -->
          <div v-if="backendStore.tags.length > 0" :class="`mt-4 ${sidebarCollapsed ? 'hidden' : ''}`">
            <h3 :class="`text-xs font-medium text-gray-500 uppercase tracking-wider px-3 mb-2`">标签</h3>
            <div class="flex flex-wrap gap-2 px-3">
              <button
                type="button"
                @click="tagFilter = 'all'"
                :class="`px-2 py-1 rounded text-xs font-medium transition-colors ${tagFilter === 'all' ? 'bg-black text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`"
              >
                全部
              </button>
              <button
                v-for="tag in backendStore.tags"
                :key="tag"
                type="button"
                @click="tagFilter = tag"
                :class="`px-2 py-1 rounded text-xs font-medium transition-colors ${tagFilter === tag ? 'bg-black text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`"
              >
                <SafeText as="span" :text="tag" />
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <!-- 右侧主内容 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-white">
        <!-- 工具栏 -->
        <div class="border-b border-gray-200 px-3 py-2 sm:px-4 sm:py-3 flex flex-col gap-2 shrink-0">
          <!-- 单排：能放下时尽量一排 -->
          <div v-if="!useTwoRowToolbar" class="flex items-center gap-2 w-full min-w-0">
            <OverflowActionBar
              class="flex-1 min-w-0"
              :items="toolbarSingleRowLeftItems"
              overflow-title="更多操作"
              grouped
              @action="handleToolbarAction"
            />

            <QueueMenu
              v-if="capabilities.hasTorrentQueue"
              :selected-count="selectedCount"
              :disabled="selectedCount === 0"
              @action="handleQueueAction"
            />

            <div class="flex items-center gap-2 min-w-0">
              <OverflowActionBar
                class="min-w-0"
                :items="toolbarManageItems"
                overflow-title="更多管理"
                grouped
                @action="handleToolbarAction"
              />

              <!-- 搜索 -->
              <div class="flex items-center">
                <DashboardSearchControl
                  v-model="uiState.filter"
                  :inline="showSearchInput"
                />
              </div>

              <!-- 连接状态 -->
              <div v-if="showToolbarConnection" class="flex items-center gap-2 shrink-0" :title="connectionStatus.text">
                <div
                  :class="`w-2 h-2 rounded-full ${
                    connectionStatus.type === 'success' ? 'bg-green-500' :
                    connectionStatus.type === 'warning' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
                  }`"
                ></div>
                <span class="text-xs text-gray-500 max-w-[5rem] truncate">{{ connectionLabel }}</span>
              </div>

              <ServerSwitchMenu />

              <button
                v-if="authStore.isSecuredConnection"
                type="button"
                class="icon-btn"
                aria-label="退出登录"
                title="退出登录"
                @click="logout"
              >
                <Icon name="log-out" :size="16" />
              </button>
            </div>
          </div>

          <!-- 双排：批量 + 管理下移 -->
          <template v-else>
            <!-- 第一排：主操作 + 搜索/状态/退出 -->
            <div class="flex items-center gap-2 w-full min-w-0">
              <OverflowActionBar
                class="flex-1 min-w-0"
                :items="toolbarTwoRowTopItems"
                overflow-title="更多操作"
                grouped
                @action="handleToolbarAction"
              />

              <div class="flex items-center gap-2 shrink-0">
                <!-- 搜索 -->
                <div class="flex items-center">
                  <DashboardSearchControl
                    v-model="uiState.filter"
                    :inline="false"
                  />
                </div>

                <ServerSwitchMenu />

                <button
                  v-if="authStore.isSecuredConnection"
                  type="button"
                  class="icon-btn"
                  aria-label="退出登录"
                  title="退出登录"
                  @click="logout"
                >
                  <Icon name="log-out" :size="16" />
                </button>
              </div>
            </div>

            <!-- 第二排：批量 + 管理 -->
            <div class="flex items-center gap-2 w-full min-w-0">
              <OverflowActionBar
                class="flex-1 min-w-0"
                :items="toolbarBatchItems"
                overflow-title="更多操作"
                grouped
                @action="handleToolbarAction"
              />
              <QueueMenu
                v-if="capabilities.hasTorrentQueue"
                :selected-count="selectedCount"
                :disabled="selectedCount === 0"
                @action="handleQueueAction"
              />
              <OverflowActionBar
                class="ml-auto flex-initial min-w-0"
                :items="toolbarManageItems"
                overflow-title="更多管理"
                grouped
                @action="handleToolbarAction"
              />
            </div>
          </template>
        </div>

        <!-- 种子列表容器：flex-1 自动填充剩余空间 -->
        <div class="flex-1 overflow-hidden min-h-0">
          <!-- 桌面端列表视图 -->
          <div v-if="uiState.viewMode === 'list'" class="h-full min-h-0 flex flex-col">
            <!-- 表头 -->
            <ResizableTableHeader
              :columns="columns"
              :resize-state="resizeState"
              @start-resize="(leftId, rightId, startX, snapshots) => startResize(leftId, rightId, startX, snapshots)"
              @toggle-sort="(columnId) => toggleSortByColumn(columnId)"
            >
              <template #header-name="{ column }">
                {{ column.label }} {{ getSortIconForColumn('name') }}
              </template>
              <template #header-progress="{ column }">
                {{ column.label }} {{ getSortIconForColumn('progress') }}
              </template>
              <template #header-dlSpeed="{ column }">
                {{ column.label }} {{ getSortIconForColumn('dlSpeed') }}
              </template>
              <template #header-upSpeed="{ column }">
                {{ column.label }} {{ getSortIconForColumn('upSpeed') }}
              </template>
              <template #header-eta="{ column }">
                {{ column.label }} {{ getSortIconForColumn('eta') }}
              </template>
            </ResizableTableHeader>

            <!-- 列表滚动容器：单一滚动条（避免嵌套） -->
            <div
              ref="tableScrollRef"
              class="flex-1 overflow-auto overflow-x-hidden min-h-0"
              style="scrollbar-gutter: stable;"
            >
              <!-- 虚拟滚动（大量种子时） -->
              <VirtualTorrentList
                v-if="useVirtualScroll && sortedTorrents.length > 0"
                :torrents="sortedTorrents"
                :selected-hashes="uiState.selection"
                :columns="columns"
                :scroll-element="tableScrollRef"
                :is-resizing="resizeState.isResizing"
                @click="selectTorrentForDetail"
                @toggle-select="toggleSelect"
                @action="handleTorrentAction"
                @contextmenu="handleContextMenu"
              />

              <!-- 普通列表（少量种子时） -->
              <template v-else-if="sortedTorrents.length > 0">
                <TorrentRow
                  v-for="torrent in sortedTorrents"
                  :key="torrent.id"
                  :torrent="torrent"
                  :selected="uiState.selection.has(torrent.id)"
                  :columns="columns"
                  :is-resizing="resizeState.isResizing"
                  @click="selectTorrentForDetail(torrent.id, $event)"
                  @toggle-select="toggleSelect($event.detail)"
                  @action="handleTorrentAction"
                  @contextmenu="handleContextMenu"
                />
              </template>

              <!-- 空状态 -->
              <div v-else class="px-4 py-16 text-center h-full flex items-center justify-center">
                <div class="flex flex-col items-center gap-4">
                  <Icon name="inbox" :size="48" class="text-gray-300" />
                  <div class="text-gray-500">
                    <p class="font-medium">{{ uiState.filter ? '未找到匹配的种子' : '暂无种子' }}</p>
                    <p class="text-sm mt-1">{{ uiState.filter ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 移动端卡片视图 -->
          <div v-else ref="mobileScrollRef" class="h-full overflow-auto p-4">
            <!-- 空状态 -->
            <div v-if="sortedTorrents.length === 0" class="text-center py-16">
              <Icon name="inbox" :size="64" class="text-gray-300 mx-auto mb-4" />
              <div class="text-gray-500">
                <p class="font-medium text-base">{{ uiState.filter ? '未找到匹配的种子' : '暂无种子' }}</p>
                <p class="text-sm mt-1">{{ uiState.filter ? '尝试调整搜索关键词' : '添加种子后将在此处显示' }}</p>
              </div>
            </div>

            <!-- 卡片列表 -->
            <VirtualTorrentCardList
              v-if="useMobileVirtualScroll && sortedTorrents.length > 0"
              :torrents="sortedTorrents"
              :selected-hashes="uiState.selection"
              :scroll-element="mobileScrollRef"
              @click="selectTorrentForDetail"
              @toggle-select="toggleSelect"
            />

            <div v-else class="space-y-3">
              <TorrentCard
                v-for="torrent in sortedTorrents"
                :key="torrent.id"
                :torrent="torrent"
                :selected="uiState.selection.has(torrent.id)"
                @click="selectTorrentForDetail(torrent.id)"
                @toggle-select="toggleSelect($event.detail)"
                @action="handleTorrentAction"
              />
            </div>
          </div>
        </div>

        <!-- 底部详情面板（在状态栏上面） -->
        <TorrentBottomPanel
          :torrent="selectedTorrent"
          :visible="showDetailPanel"
          :height="detailPanelHeight"
          :active-tab="detailTab"
          @close="closeDetailPanel"
          @resize="resizeDetailPanel"
          @action="handleTorrentAction"
          @refresh="immediateRefresh"
          @tab-change="handleDetailTabChange"
        />

        <!-- 底部状态栏 -->
        <DashboardStatusBar
          :version-display="backendStore.versionDisplay ?? ''"
          :has-version-error="!backendStore.versionDisplay"
          :downloading-count="stats.downloading"
          :seeding-count="stats.seeding"
          :total-size="totalTorrentSize"
          :dl-speed="stats.dlSpeed"
          :up-speed="stats.upSpeed"
          :dl-rate-limit="backendStore.serverState?.dlRateLimit ?? 0"
          :up-rate-limit="backendStore.serverState?.upRateLimit ?? 0"
          :use-alt-speed="backendStore.serverState?.useAltSpeed ?? false"
          :show-connection-indicator="!showToolbarConnection"
          :connection-status-text="connectionStatus.text"
          :connection-status-type="connectionStatus.type"
        />
      </main>
    </div>

    <!-- 添加种子对话框 -->
    <AddTorrentDialog
      :open="showAddDialog"
      @close="showAddDialog = false"
      @add="handleAddTorrent"
    />

    <!-- 列设置对话框 -->
    <ColumnSettingsDialog
      :open="showColumnSettings"
      :columns="columns"
      @close="showColumnSettings = false"
      @toggle-visibility="toggleVisibility"
      @reset="resetToDefaults"
    />

    <!-- 后端设置对话框 -->
    <BackendSettingsDialog
      :open="showBackendSettings"
      @close="showBackendSettings = false; immediateRefresh()"
    />

    <!-- 工具对话框（Logs / RSS / Search） -->
    <ToolsDialog
      :open="showToolsDialog"
      @close="showToolsDialog = false"
    />

    <!-- 分类管理对话框 -->
    <CategoryManageDialog
      v-if="showCategoryManage"
      @close="showCategoryManage = false; immediateRefresh()"
    />

    <!-- 标签管理对话框 -->
    <TagManageDialog
      v-if="showTagManage"
      @close="showTagManage = false; immediateRefresh()"
    />

    <!-- 右键菜单 -->
    <TorrentContextMenu
      :show="contextmenuState.show"
      :x="contextmenuState.x"
      :y="contextmenuState.y"
      :hashes="contextmenuState.hashes"
      :can-set-category="backendStore.isQbit"
      :can-queue="capabilities.hasTorrentQueue"
      @close="closeContextMenu"
      @action="handleContextMenuAction"
    />
  </div>
</template>
