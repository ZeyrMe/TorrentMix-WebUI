import {
  computed,
  getCurrentScope,
  nextTick,
  onScopeDispose,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'
import type { LocationQuery, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import type { UnifiedTorrent } from '@/adapter/types'
import type { AddTorrentParams, BaseAdapter, FetchListResult } from '@/adapter/interface'
import { useBackendStore } from '@/store/backend'
import { useTorrentStore } from '@/store/torrent'
import { useUiOverlay } from '@/composables/useUiOverlay'
import {
  decodeDashboardRouteState,
  encodeDashboardRouteState,
  type DashboardDetailTab,
} from '@/utils/dashboardRouteState'

export interface TorrentUIState {
  selection: Set<string>
  sortBy: keyof UnifiedTorrent
  sortOrder: 'asc' | 'desc'
  filter: string
  viewMode: 'list' | 'card'
}

export type StateFilter =
  | 'all'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'paused-completed'
  | 'paused-incomplete'
  | 'checking'
  | 'queued'
  | 'error'

export type TorrentAction =
  | 'pause'
  | 'resume'
  | 'delete'
  | 'recheck'
  | 'reannounce'
  | 'forceStart'
  | 'force-start'
  | 'queue-top'
  | 'queue-up'
  | 'queue-down'
  | 'queue-bottom'

export interface DashboardContextMenuState {
  show: boolean
  x: number
  y: number
  hashes: string[]
}

type DashboardUiOverlay = Pick<
  ReturnType<typeof useUiOverlay>,
  'confirm' | 'notify' | 'openForm'
>

type DashboardRoutePort = Pick<RouteLocationNormalizedLoaded, 'query'>
type DashboardRouterPort = Pick<Router, 'replace'>

export interface DashboardControllerOptions {
  route?: DashboardRoutePort
  router?: DashboardRouterPort
  normalizeViewMode?: (viewMode: TorrentUIState['viewMode']) => TorrentUIState['viewMode']
  overlay?: DashboardUiOverlay
  torrentStore?: ReturnType<typeof useTorrentStore>
  backendStore?: ReturnType<typeof useBackendStore>
}

export interface DashboardActionExecutorPorts {
  overlay: DashboardUiOverlay
}

export interface DashboardControllerState {
  ui: TorrentUIState
  filters: {
    debouncedFilter: Ref<string>
    stateFilter: Ref<StateFilter>
    categoryFilter: Ref<string>
    tagFilter: Ref<string>
  }
  data: {
    adapter: ComputedRef<BaseAdapter>
    filteredTorrents: ComputedRef<Map<string, UnifiedTorrent>>
    sortedTorrents: ComputedRef<UnifiedTorrent[]>
    selectedCount: ComputedRef<number>
    selectedBadge: ComputedRef<string | undefined>
    isAllSelected: ComputedRef<boolean>
    contextMenuState: Ref<DashboardContextMenuState>
  }
  route: {
    syncing: Ref<boolean>
    selectedTorrentId: Ref<string | null>
    detailTab: Ref<DashboardDetailTab>
  }
}

export interface DashboardControllerActions {
  syncFilterImmediately: (value: string) => void
  toggleSort: (columnId: string) => void
  getSortIconForColumn: (columnId: string) => string
  select: (hash: string, options?: { mode?: 'toggle' | 'replace' }) => void
  selectRange: (hashes: string[]) => void
  clearSelection: () => void
  selectAllVisible: () => void
  openContextMenu: (position: { x: number; y: number }, hashes: string[]) => void
  closeContextMenu: () => void
  refresh: () => Promise<FetchListResult>
  runTorrentAction: (
    action: TorrentAction,
    hashes: string[],
    options?: { refresh?: boolean; clearSelection?: boolean }
  ) => Promise<void>
  runContextMenuAction: (action: string, hashes: string[]) => Promise<void>
  runBatchSpeedLimit: (hashes?: string[]) => Promise<void>
  addTorrent: (params: AddTorrentParams) => Promise<boolean>
  applyRouteState: (query?: LocationQuery) => void
  persistRouteState: () => Promise<void>
  setViewMode: (viewMode: TorrentUIState['viewMode']) => void
  setSelectedTorrentId: (hash: string | null) => void
  setDetailTab: (tab: DashboardDetailTab) => void
}

export interface DashboardController {
  state: DashboardControllerState
  actions: DashboardControllerActions
}

function getDefaultViewMode(): TorrentUIState['viewMode'] {
  if (typeof window === 'undefined') return 'list'
  return window.innerWidth < 768 ? 'card' : 'list'
}

function normalizeEta(eta: number): number {
  if (eta === -1) return Number.POSITIVE_INFINITY
  return eta
}

function isSameRouteQuery(nextQuery: Record<string, string>, currentQuery: LocationQuery) {
  const currentEntries = Object.entries(currentQuery)
    .map(([key, value]) => [key, Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')] as const)
    .sort(([a], [b]) => a.localeCompare(b))

  const nextEntries = Object.entries(nextQuery)
    .sort(([a], [b]) => a.localeCompare(b))

  if (currentEntries.length !== nextEntries.length) return false
  return currentEntries.every(([key, value], index) => {
    const current = nextEntries[index]
    return current?.[0] === key && current?.[1] === value
  })
}

function createDashboardListState(options: DashboardControllerOptions) {
  const torrentStore = options.torrentStore ?? useTorrentStore()
  const backendStore = options.backendStore ?? useBackendStore()

  const adapter = computed<BaseAdapter>(() => {
    if (!backendStore.adapter) {
      throw new Error('[useTorrentContext] Backend adapter not initialized.')
    }
    return backendStore.adapter
  })

  const ui = reactive<TorrentUIState>({
    selection: new Set(),
    sortBy: 'name',
    sortOrder: 'asc',
    filter: '',
    viewMode: getDefaultViewMode(),
  })

  const stateFilter = ref<StateFilter>('all')
  const categoryFilter = ref('all')
  const tagFilter = ref('all')
  const debouncedFilter = ref('')
  const routeSyncing = ref(false)
  const selectedTorrentId = ref<string | null>(null)
  const detailTab = ref<DashboardDetailTab>('overview')
  const contextMenuState = ref<DashboardContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    hashes: [],
  })

  const applyViewMode = (viewMode: TorrentUIState['viewMode']) =>
    options.normalizeViewMode ? options.normalizeViewMode(viewMode) : viewMode

  let filterSyncVersion = 0
  let suppressNextFilterWatch = false
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null

  watch(() => ui.filter, (value) => {
    if (suppressNextFilterWatch) {
      suppressNextFilterWatch = false
      return
    }

    filterSyncVersion += 1
    const version = filterSyncVersion

    if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
    filterDebounceTimer = setTimeout(() => {
      if (version !== filterSyncVersion) return
      debouncedFilter.value = value
      filterDebounceTimer = null
    }, 300)
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (filterDebounceTimer) clearTimeout(filterDebounceTimer)
    })
  }

  function syncFilterImmediately(value: string) {
    filterSyncVersion += 1
    if (filterDebounceTimer) {
      clearTimeout(filterDebounceTimer)
      filterDebounceTimer = null
    }

    debouncedFilter.value = value
    if (ui.filter === value) return
    suppressNextFilterWatch = true
    ui.filter = value
  }

  function select(hash: string, options?: { mode?: 'toggle' | 'replace' }) {
    const mode = options?.mode ?? 'toggle'
    if (mode === 'replace') {
      ui.selection.clear()
      ui.selection.add(hash)
      return
    }

    if (ui.selection.has(hash)) ui.selection.delete(hash)
    else ui.selection.add(hash)
  }

  function selectRange(hashes: string[]) {
    ui.selection.clear()
    for (const hash of hashes) ui.selection.add(hash)
  }

  function clearSelection() {
    ui.selection.clear()
  }

  function removeFromSelection(hashes: string[]) {
    for (const hash of hashes) ui.selection.delete(hash)
  }

  const sortKeyByColumnId: Record<string, keyof UnifiedTorrent> = {
    name: 'name',
    progress: 'progress',
    dlSpeed: 'dlspeed',
    upSpeed: 'upspeed',
    eta: 'eta',
    size: 'size',
    ratio: 'ratio',
    addedTime: 'addedTime',
  }

  function toggleSort(columnId: string) {
    const key = sortKeyByColumnId[columnId]
    if (!key) return

    if (ui.sortBy === key) {
      ui.sortOrder = ui.sortOrder === 'asc' ? 'desc' : 'asc'
      return
    }

    ui.sortBy = key
    ui.sortOrder = key === 'name' ? 'asc' : 'desc'
  }

  function getSortIconForColumn(columnId: string): string {
    const key = sortKeyByColumnId[columnId]
    if (!key) return ''
    if (ui.sortBy !== key) return ''
    return ui.sortOrder === 'asc' ? '↑' : '↓'
  }

  function compareTorrents(a: UnifiedTorrent, b: UnifiedTorrent): number {
    if (a.state === 'downloading' && b.state !== 'downloading') return -1
    if (b.state === 'downloading' && a.state !== 'downloading') return 1

    const key = ui.sortBy
    let compare: number

    if (key === 'name') {
      compare = a.name.localeCompare(b.name, 'zh-CN')
    } else if (key === 'eta') {
      compare = normalizeEta(a.eta) - normalizeEta(b.eta)
    } else {
      const av = a[key]
      const bv = b[key]
      if (typeof av === 'number' && typeof bv === 'number') compare = av - bv
      else compare = String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN')
    }

    return ui.sortOrder === 'asc' ? compare : -compare
  }

  const filteredTorrents = computed(() => {
    let result: Map<string, UnifiedTorrent> = torrentStore.torrents

    if (stateFilter.value !== 'all') {
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.state === stateFilter.value) filtered.set(hash, torrent)
        else if (stateFilter.value === 'paused-completed' && torrent.state === 'paused' && torrent.progress >= 1.0) {
          filtered.set(hash, torrent)
        } else if (stateFilter.value === 'paused-incomplete' && torrent.state === 'paused' && torrent.progress < 1.0) {
          filtered.set(hash, torrent)
        }
      }
      result = filtered
    }

    if (categoryFilter.value !== 'all') {
      const filtered = new Map<string, UnifiedTorrent>()
      const selected = categoryFilter.value
      for (const [hash, torrent] of result) {
        const category = torrent.category ?? ''
        if (backendStore.isTrans) {
          if (selected === '') {
            if (category === '') filtered.set(hash, torrent)
          } else if (category === selected || category.startsWith(`${selected}/`)) {
            filtered.set(hash, torrent)
          }
        } else if (category === selected) {
          filtered.set(hash, torrent)
        }
      }
      result = filtered
    }

    if (tagFilter.value !== 'all') {
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.tags?.includes(tagFilter.value)) filtered.set(hash, torrent)
      }
      result = filtered
    }

    if (debouncedFilter.value) {
      const query = debouncedFilter.value.toLowerCase()
      const filtered = new Map<string, UnifiedTorrent>()
      for (const [hash, torrent] of result) {
        if (torrent.name.toLowerCase().includes(query)) filtered.set(hash, torrent)
      }
      result = filtered
    }

    return result
  })

  const sortedTorrents = computed(() =>
    Array.from(filteredTorrents.value.values()).sort(compareTorrents)
  )

  type Deferred<T> = {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (error: unknown) => void
  }

  function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  let refreshDeferred: Deferred<FetchListResult> | null = null
  let refreshRunning = false
  let refreshQueued = false

  async function refreshOnce(): Promise<FetchListResult> {
    const result = await adapter.value.fetchList()
    torrentStore.updateTorrents(result.torrents)
    backendStore.updateGlobalData({
      categories: result.categories,
      tags: result.tags,
      serverState: result.serverState,
    })
    return result
  }

  async function refreshWorker(): Promise<void> {
    if (refreshRunning || !refreshDeferred) return

    refreshRunning = true
    try {
      let last: FetchListResult
      do {
        refreshQueued = false
        last = await refreshOnce()
      } while (refreshQueued)
      refreshDeferred.resolve(last!)
    } catch (error) {
      refreshDeferred.reject(error)
    } finally {
      refreshDeferred = null
      refreshRunning = false
      refreshQueued = false
    }
  }

  function refresh() {
    if (!refreshDeferred) {
      refreshDeferred = createDeferred<FetchListResult>()
      void refreshWorker()
    } else {
      refreshQueued = true
    }
    return refreshDeferred.promise
  }

  function selectAllVisible() {
    if (ui.selection.size === sortedTorrents.value.length) {
      ui.selection.clear()
      return
    }

    for (const hash of filteredTorrents.value.keys()) {
      ui.selection.add(hash)
    }
  }

  function setViewMode(viewMode: TorrentUIState['viewMode']) {
    ui.viewMode = applyViewMode(viewMode)
  }

  function setSelectedTorrentId(hash: string | null) {
    selectedTorrentId.value = hash
  }

  function setDetailTab(tab: DashboardDetailTab) {
    detailTab.value = tab
  }

  function buildRouteQuery() {
    return encodeDashboardRouteState({
      viewMode: applyViewMode(ui.viewMode),
      filter: ui.filter,
      stateFilter: stateFilter.value,
      categoryFilter: categoryFilter.value,
      tagFilter: tagFilter.value,
      selectedTorrent: selectedTorrentId.value,
      detailTab: detailTab.value,
    })
  }

  function applyRouteState(query?: LocationQuery) {
    const nextQuery = query ?? options.route?.query ?? {}
    routeSyncing.value = true
    const decoded = decodeDashboardRouteState(nextQuery)

    if (decoded.filter !== ui.filter) syncFilterImmediately(decoded.filter)
    stateFilter.value = decoded.stateFilter
    categoryFilter.value = decoded.categoryFilter
    tagFilter.value = decoded.tagFilter
    detailTab.value = decoded.detailTab
    selectedTorrentId.value = decoded.selectedTorrent
    setViewMode(decoded.viewMode)

    void nextTick().then(() => {
      routeSyncing.value = false
    })
  }

  async function persistRouteState() {
    if (!options.router || !options.route || routeSyncing.value) return

    const query = buildRouteQuery()
    if (isSameRouteQuery(query, options.route.query)) return
    await options.router.replace({ query })
  }

  if (options.route) {
    watch(
      () => options.route!.query,
      (query) => applyRouteState(query),
      { immediate: true },
    )
  }

  if (options.route && options.router) {
    watch(
      [
        () => ui.viewMode,
        () => ui.filter,
        stateFilter,
        categoryFilter,
        tagFilter,
        selectedTorrentId,
        detailTab,
      ],
      () => {
        void persistRouteState()
      },
    )
  }

  const selectedCount = computed(() => ui.selection.size)
  const selectedBadge = computed<string | undefined>(() => {
    const count = selectedCount.value
    if (count <= 0) return undefined
    return count > 99 ? '99+' : String(count)
  })
  const isAllSelected = computed(() => {
    const total = sortedTorrents.value.length
    return total > 0 && selectedCount.value === total
  })

  function getTorrentName(hash: string) {
    return torrentStore.torrents.get(hash)?.name || hash
  }

  return {
    state: {
      ui,
      filters: {
        debouncedFilter,
        stateFilter,
        categoryFilter,
        tagFilter,
      },
      data: {
        adapter,
        filteredTorrents,
        sortedTorrents,
        selectedCount,
        selectedBadge,
        isAllSelected,
        contextMenuState,
      },
      route: {
        syncing: routeSyncing,
        selectedTorrentId,
        detailTab,
      },
    },
    helpers: {
      backendStore,
      torrentStore,
      getTorrentName,
      removeFromSelection,
    },
    actions: {
      syncFilterImmediately,
      toggleSort,
      getSortIconForColumn,
      select,
      selectRange,
      clearSelection,
      selectAllVisible,
      refresh,
      applyRouteState,
      persistRouteState,
      setViewMode,
      setSelectedTorrentId,
      setDetailTab,
    },
  }
}

function createDashboardActionExecutor(
  listState: ReturnType<typeof createDashboardListState>,
  ports: DashboardActionExecutorPorts,
) {
  const {
    state: {
      data: { adapter, contextMenuState },
    },
    helpers: {
      backendStore,
      torrentStore,
      getTorrentName,
      removeFromSelection,
    },
    actions: {
      clearSelection,
      refresh,
    },
  } = listState

  const { overlay } = ports

  function readOverlayValue(values: Record<string, string>, key: string) {
    return values[key] ?? ''
  }

  function notifyError(title: string, error: unknown) {
    overlay.notify({
      title,
      message: error instanceof Error ? error.message : title,
      tone: 'danger',
    })
  }

  function openContextMenu(position: { x: number; y: number }, hashes: string[]) {
    contextMenuState.value = {
      show: true,
      x: position.x,
      y: position.y,
      hashes: [...hashes],
    }
  }

  function closeContextMenu() {
    contextMenuState.value = {
      ...contextMenuState.value,
      show: false,
    }
  }

  async function confirmDelete(hashes: string[]): Promise<{ deleteFiles: boolean } | null> {
    const count = hashes.length
    if (count === 0) return null

    const names = hashes
      .map(getTorrentName)
      .filter(Boolean)
      .slice(0, 3)

    const nameList = names.join('、')
    const moreText = count > 3 ? `等 ${count} 个种子` : `${count} 个种子`

    let deleteFiles = false
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const values = await overlay.openForm({
        title: '删除种子',
        message: `请选择删除方式。\n\n种子：${nameList}${count > 3 ? '...' : ''}\n(${moreText})`,
        submitLabel: '继续删除',
        cancelLabel: '取消',
        tone: 'danger',
        fields: [
          {
            key: 'deleteFiles',
            label: '同时删除下载文件（此操作不可恢复）',
            name: 'deleteFiles',
            type: 'checkbox',
            defaultValue: '',
          },
        ],
      })
      if (!values) return null
      deleteFiles = values.deleteFiles === 'true'
    } else {
      const result = await overlay.confirm({
        title: '删除种子',
        message: `是否同时删除下载文件？\n\n种子：${nameList}${count > 3 ? '...' : ''}\n(${moreText})`,
        confirmLabel: '删除种子与文件',
        cancelLabel: '仅删除种子',
        tone: 'danger',
      })
      if (result === null) return null
      deleteFiles = result
    }

    if (deleteFiles) {
      const confirmed = await overlay.confirm({
        title: '确认删除文件',
        message: `警告：确定删除 ${moreText} 并同时删除下载文件吗？\n\n此操作不可恢复！`,
        confirmLabel: '确认删除',
        cancelLabel: '取消',
        tone: 'danger',
      })
      if (!confirmed) return null
    } else {
      const confirmed = await overlay.confirm({
        title: '确认删除种子',
        message: `确定删除 ${moreText} 吗？\n（仅删除种子，保留文件）`,
        confirmLabel: '确认删除',
        cancelLabel: '取消',
        tone: 'danger',
      })
      if (!confirmed) return null
    }

    return { deleteFiles }
  }

  async function withMutation<T>(task: () => Promise<T>): Promise<T> {
    backendStore.beginMutation()
    try {
      return await task()
    } finally {
      backendStore.endMutation()
    }
  }

  async function runTorrentAction(
    action: TorrentAction,
    hashes: string[],
    options?: { refresh?: boolean; clearSelection?: boolean }
  ) {
    if (hashes.length === 0) return

    await withMutation(async () => {
      switch (action) {
        case 'pause':
          await adapter.value.pause(hashes)
          break
        case 'resume':
          await adapter.value.resume(hashes)
          break
        case 'delete': {
          const confirmed = await confirmDelete(hashes)
          if (!confirmed) return
          await adapter.value.delete(hashes, confirmed.deleteFiles)
          removeFromSelection(hashes)
          break
        }
        case 'recheck':
          if (hashes.length === 1) await adapter.value.recheck(hashes[0]!)
          else await adapter.value.recheckBatch(hashes)
          break
        case 'reannounce':
          if (hashes.length === 1) await adapter.value.reannounce(hashes[0]!)
          else await adapter.value.reannounceBatch(hashes)
          break
        case 'forceStart':
        case 'force-start':
          if (hashes.length === 1) await adapter.value.forceStart(hashes[0]!, true)
          else await adapter.value.forceStartBatch(hashes, true)
          break
        case 'queue-top':
          await adapter.value.queueMoveTop(hashes)
          break
        case 'queue-up':
          await adapter.value.queueMoveUp(hashes)
          break
        case 'queue-down':
          await adapter.value.queueMoveDown(hashes)
          break
        case 'queue-bottom':
          await adapter.value.queueMoveBottom(hashes)
          break
        default:
          console.warn('[useTorrentContext] Unknown action:', action)
          return
      }

      if (options?.clearSelection) clearSelection()
      if (options?.refresh !== false) await refresh()
    })
  }

  async function addTorrent(params: AddTorrentParams) {
    try {
      await withMutation(async () => {
        await adapter.value.addTorrent(params)
        await refresh()
      })
      return true
    } catch (error) {
      console.error('[DashboardController] Failed to add torrent:', error)
      notifyError('添加种子失败', error)
      return false
    }
  }

  async function runContextMenuAction(action: string, hashes: string[]) {
    closeContextMenu()

    try {
      switch (action) {
        case 'set-category':
          if (backendStore.isTrans) {
            overlay.notify({
              title: '当前后端不支持分类',
              message: 'Transmission 不支持分类（Category）。请使用“移动位置”或“标签”。',
              tone: 'warning',
            })
            return
          }

          {
            const currentValues = hashes.map(hash => torrentStore.torrents.get(hash)?.category ?? '')
            const unique = Array.from(new Set(currentValues.map(value => value.trim())))
            const defaultValue = unique.length === 1 ? unique[0]! : ''

            const categories = Array.from(backendStore.categories.values())
              .map(category => category.name.trim())
              .filter(Boolean)
            const preview = categories.slice(0, 20)
            const previewText = preview.length > 0
              ? `\n\n可用分类（前 ${preview.length} 个）：\n${preview.join('\n')}${categories.length > preview.length ? '\n…' : ''}`
              : ''

            const values = await overlay.openForm({
              title: '设置分类',
              message: `支持留空清除分类。${previewText}`,
              submitLabel: '保存分类',
              fields: [
                {
                  key: 'category',
                  label: '分类名',
                  name: 'category',
                  placeholder: '例如：movie',
                  defaultValue,
                  autocomplete: 'off',
                },
              ],
            })
            if (!values) return

            await withMutation(async () => {
              await adapter.value.setCategoryBatch(hashes, readOverlayValue(values, 'category').trim())
              await refresh()
            })
            return
          }
        case 'set-tags':
          {
            const getCommonTags = (targetHashes: string[]) => {
              if (targetHashes.length === 0) return []
              const all = targetHashes.map(hash => new Set(torrentStore.torrents.get(hash)?.tags ?? []))
              let common = new Set(all[0] ?? [])
              for (const tags of all.slice(1)) {
                common = new Set(Array.from(common).filter(tag => tags.has(tag)))
              }
              return Array.from(common).sort((a, b) => a.localeCompare(b, 'zh-CN'))
            }

            const defaultTags = hashes.length === 1
              ? (torrentStore.torrents.get(hashes[0]!)?.tags ?? []).join(', ')
              : getCommonTags(hashes).join(', ')

            const allTags = backendStore.tags
              .map(tag => tag.trim())
              .filter(Boolean)
            const preview = allTags.slice(0, 30)
            const previewText = preview.length > 0
              ? `\n\n已有标签（前 ${preview.length} 个）：\n${preview.join('、')}${allTags.length > preview.length ? '…' : ''}`
              : ''

            const values = await overlay.openForm({
              title: '设置标签',
              message: `多个标签请用逗号或换行分隔，留空会清空标签。${previewText}`,
              submitLabel: '保存标签',
              fields: [
                {
                  key: 'tags',
                  label: '标签',
                  name: 'tags',
                  placeholder: '例如：movie, favorite',
                  defaultValue: defaultTags,
                  autocomplete: 'off',
                  multiline: true,
                },
              ],
            })
            if (!values) return

            const tags = readOverlayValue(values, 'tags')
              .split(/[,，\n]/g)
              .map(tag => tag.trim())
              .filter(Boolean)

            await withMutation(async () => {
              await adapter.value.setTagsBatch(hashes, tags, 'set')
              await refresh()
            })
            return
          }
        default:
          await runTorrentAction(action as TorrentAction, hashes)
      }
    } catch (error) {
      console.error('[DashboardController] Context menu action failed:', error)
      notifyError('操作失败', error)
    }
  }

  async function runBatchSpeedLimit(hashes = Array.from(listState.state.ui.selection)) {
    if (hashes.length === 0) return

    let speedBytes = 1024
    if (backendStore.isTrans) {
      try {
        const settings = await adapter.value.getTransferSettings()
        if (typeof settings.speedBytes === 'number' && Number.isFinite(settings.speedBytes) && settings.speedBytes > 0) {
          speedBytes = settings.speedBytes
        }
      } catch (error) {
        console.warn('[DashboardController] Failed to load speedBytes for batch limits:', error)
      }
    }

    const unitLabel = speedBytes === 1000 ? 'kB/s' : 'KiB/s'
    const values = await overlay.openForm({
      title: '批量限速',
      message: `单位为 ${unitLabel}。留空或输入 0 表示不限制。`,
      submitLabel: '应用限速',
      fields: [
        {
          key: 'downloadLimit',
          label: `下载限制 (${unitLabel})`,
          name: 'downloadLimit',
          type: 'number',
          inputmode: 'numeric',
          placeholder: '例如：2048',
        },
        {
          key: 'uploadLimit',
          label: `上传限制 (${unitLabel})`,
          name: 'uploadLimit',
          type: 'number',
          inputmode: 'numeric',
          placeholder: '例如：512',
        },
      ],
    })
    if (!values) return

    try {
      const parseKbLimit = (raw: string) => {
        const text = raw.trim()
        if (text === '' || text === '0') return 0
        const kb = Number.parseInt(text, 10)
        if (!Number.isFinite(kb) || kb < 0) {
          throw new Error(`限速请输入非负整数（${unitLabel}）`)
        }
        return kb * speedBytes
      }

      const downloadLimit = parseKbLimit(readOverlayValue(values, 'downloadLimit'))
      const uploadLimit = parseKbLimit(readOverlayValue(values, 'uploadLimit'))

      await withMutation(async () => {
        await adapter.value.setDownloadLimitBatch(hashes, downloadLimit)
        await adapter.value.setUploadLimitBatch(hashes, uploadLimit)
        clearSelection()
        await refresh()
      })
    } catch (error) {
      console.error('[DashboardController] Set speed limit failed:', error)
      notifyError('设置限速失败', error)
    }
  }

  return {
    openContextMenu,
    closeContextMenu,
    runTorrentAction,
    runContextMenuAction,
    runBatchSpeedLimit,
    addTorrent,
  }
}

export function useTorrentContext(options: DashboardControllerOptions = {}): DashboardController {
  const listState = createDashboardListState(options)
  const overlay = options.overlay ?? useUiOverlay()
  const actionExecutor = createDashboardActionExecutor(listState, { overlay })

  return {
    state: listState.state,
    actions: {
      ...listState.actions,
      ...actionExecutor,
    },
  }
}
