import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'

import { useBackendStore } from '../src/store/backend.ts'
import { useTorrentStore } from '../src/store/torrent.ts'
import { useTorrentContext } from '../src/composables/useTorrentContext.ts'

function makeTorrent(
  id: string,
  name: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    name,
    state: 'paused',
    progress: 0,
    size: 100,
    dlspeed: 0,
    upspeed: 0,
    eta: -1,
    ratio: 0,
    addedTime: 0,
    savePath: '',
    category: '',
    tags: [],
    ...overrides,
  } as any
}

function createOverlayMock(options: {
  confirmResults?: Array<boolean | null>
  formResults?: Array<Record<string, string> | null>
} = {}) {
  const confirmResults = [...(options.confirmResults ?? [])]
  const formResults = [...(options.formResults ?? [])]
  const notifications: Array<{ title?: string; message: string; tone?: string }> = []

  return {
    notifications,
    notify(payload: { title?: string; message: string; tone?: string }) {
      notifications.push(payload)
    },
    async confirm() {
      return confirmResults.shift() ?? false
    },
    async openForm() {
      return formResults.shift() ?? null
    },
  }
}

test('torrent controller: refresh updates torrentStore + backend global data', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrents = new Map([['a', makeTorrent('a', 'A')]])
  const categories = new Map([['c1', { name: 'c1', savePath: '/x' }]])
  const tags = ['t1']

  let fetchListCalled = 0
  backend.setAdapter(
    {
      fetchList: async () => {
        fetchListCalled++
        return {
          torrents,
          categories,
          tags,
          serverState: { dlInfoSpeed: 1, upInfoSpeed: 2 } as any,
        }
      },
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: createOverlayMock() as any })
  await ctx.actions.refresh()

  const torrentStore = useTorrentStore()
  assert.equal(fetchListCalled, 1)
  assert.equal(torrentStore.torrents.get('a')?.name, 'A')
  assert.equal(backend.categories.get('c1')?.name, 'c1')
  assert.deepEqual(backend.tags, ['t1'])
})

test('torrent controller: delete clears selection and pause/resume dispatch through action executor', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  torrentStore.updateTorrents(new Map([['a', makeTorrent('a', 'Alpha')]]))

  const overlay = createOverlayMock({ confirmResults: [false, true] })

  let fetchListCalled = 0
  let pauseCalled: string[] | null = null
  let resumeCalled: string[] | null = null
  let deleteCalled: { hashes: string[]; deleteFiles: boolean } | null = null

  backend.setAdapter(
    {
      fetchList: async () => {
        fetchListCalled++
        return { torrents: torrentStore.torrents }
      },
      pause: async (hashes: string[]) => { pauseCalled = hashes },
      resume: async (hashes: string[]) => { resumeCalled = hashes },
      delete: async (hashes: string[], deleteFiles: boolean) => {
        deleteCalled = { hashes, deleteFiles }
      },
      recheck: async () => {},
      recheckBatch: async () => {},
      reannounce: async () => {},
      reannounceBatch: async () => {},
      forceStart: async () => {},
      forceStartBatch: async () => {},
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: overlay as any })

  ctx.actions.select('a', { mode: 'replace' })
  await ctx.actions.runTorrentAction('pause', ['a'], { clearSelection: true })
  assert.deepEqual(pauseCalled, ['a'])
  assert.equal(ctx.state.ui.selection.size, 0)

  ctx.actions.select('a', { mode: 'replace' })
  await ctx.actions.runTorrentAction('resume', ['a'], { clearSelection: true })
  assert.deepEqual(resumeCalled, ['a'])
  assert.equal(ctx.state.ui.selection.size, 0)

  ctx.actions.select('a', { mode: 'replace' })
  await ctx.actions.runTorrentAction('delete', ['a'], { clearSelection: true })
  assert.deepEqual(deleteCalled, { hashes: ['a'], deleteFiles: false })
  assert.equal(ctx.state.ui.selection.size, 0)
  assert.ok(fetchListCalled >= 3)
})

test('torrent controller: syncFilterImmediately keeps debounced filter and applies state/category/tag filters', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  torrentStore.updateTorrents(new Map([
    ['a', makeTorrent('a', 'Ubuntu ISO', { state: 'downloading', category: 'linux', tags: ['os'] })],
    ['b', makeTorrent('b', 'Movie Pack', { state: 'paused', category: 'media', tags: ['video'] })],
  ]))

  backend.setAdapter(
    {
      fetchList: async () => ({ torrents: torrentStore.torrents }),
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: createOverlayMock() as any })

  ctx.state.ui.filter = 'alpha'
  ctx.actions.syncFilterImmediately('ubuntu')
  ctx.state.filters.stateFilter.value = 'downloading'
  ctx.state.filters.categoryFilter.value = 'linux'
  ctx.state.filters.tagFilter.value = 'os'

  assert.equal(ctx.state.ui.filter, 'ubuntu')
  assert.equal(ctx.state.filters.debouncedFilter.value, 'ubuntu')
  assert.deepEqual(ctx.state.data.sortedTorrents.value.map(torrent => torrent.id), ['a'])

  await new Promise(resolve => setTimeout(resolve, 350))

  assert.equal(ctx.state.filters.debouncedFilter.value, 'ubuntu')
})

test('torrent controller: qB empty category filter includes uncategorized torrents', () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  torrentStore.updateTorrents(new Map([
    ['a', makeTorrent('a', 'Alpha', { category: '' })],
    ['b', makeTorrent('b', 'Beta', { category: undefined })],
    ['c', makeTorrent('c', 'Linux ISO', { category: 'linux' })],
  ]))

  backend.setAdapter(
    {
      fetchList: async () => ({ torrents: torrentStore.torrents }),
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: createOverlayMock() as any })
  ctx.state.filters.categoryFilter.value = ''

  assert.deepEqual(ctx.state.data.sortedTorrents.value.map(torrent => torrent.id), ['a', 'b'])
})

test('torrent controller: context menu action can set category and tags through overlay forms', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  torrentStore.updateTorrents(new Map([
    ['a', makeTorrent('a', 'Alpha', { category: 'old', tags: ['x', 'y'] })],
    ['b', makeTorrent('b', 'Beta', { category: 'old', tags: ['x'] })],
  ]))
  backend.categories = new Map([
    ['movie', { name: 'movie', savePath: '/movie' }],
    ['tv', { name: 'tv', savePath: '/tv' }],
  ]) as any
  backend.tags = ['fav', 'archive'] as any

  const overlay = createOverlayMock({
    formResults: [
      { category: 'movie' },
      { tags: 'fav, archive' },
    ],
  })

  let setCategoryArgs: { hashes: string[]; category: string } | null = null
  let setTagsArgs: { hashes: string[]; tags: string[]; mode: string } | null = null
  let refreshCount = 0

  backend.setAdapter(
    {
      fetchList: async () => {
        refreshCount++
        return { torrents: torrentStore.torrents }
      },
      setCategoryBatch: async (hashes: string[], category: string) => {
        setCategoryArgs = { hashes, category }
      },
      setTagsBatch: async (hashes: string[], tags: string[], mode: string) => {
        setTagsArgs = { hashes, tags, mode }
      },
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: overlay as any })

  await ctx.actions.runContextMenuAction('set-category', ['a', 'b'])
  await ctx.actions.runContextMenuAction('set-tags', ['a', 'b'])

  assert.deepEqual(setCategoryArgs, { hashes: ['a', 'b'], category: 'movie' })
  assert.deepEqual(setTagsArgs, { hashes: ['a', 'b'], tags: ['fav', 'archive'], mode: 'set' })
  assert.equal(refreshCount, 2)
})

test('torrent controller: batch speed limit uses overlay input, clears selection, and refreshes', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  torrentStore.updateTorrents(new Map([
    ['a', makeTorrent('a', 'Alpha')],
    ['b', makeTorrent('b', 'Beta')],
  ]))

  const overlay = createOverlayMock({
    formResults: [{ downloadLimit: '200', uploadLimit: '50' }],
  })

  let downloadArgs: { hashes: string[]; limit: number } | null = null
  let uploadArgs: { hashes: string[]; limit: number } | null = null
  let refreshCount = 0

  backend.setAdapter(
    {
      fetchList: async () => {
        refreshCount++
        return { torrents: torrentStore.torrents }
      },
      getTransferSettings: async () => ({ speedBytes: 1000 }),
      setDownloadLimitBatch: async (hashes: string[], limit: number) => {
        downloadArgs = { hashes, limit }
      },
      setUploadLimitBatch: async (hashes: string[], limit: number) => {
        uploadArgs = { hashes, limit }
      },
    } as any,
    { type: 'trans', version: '4.1.0', major: 4, minor: 1, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: overlay as any })
  ctx.actions.select('a', { mode: 'replace' })
  ctx.actions.select('b', { mode: 'toggle' })

  await ctx.actions.runBatchSpeedLimit()

  assert.deepEqual(downloadArgs, { hashes: ['a', 'b'], limit: 200000 })
  assert.deepEqual(uploadArgs, { hashes: ['a', 'b'], limit: 50000 })
  assert.equal(ctx.state.ui.selection.size, 0)
  assert.equal(refreshCount, 1)
})

test('torrent controller: addTorrent reports success/failure through action executor', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  const overlay = createOverlayMock()

  let addedUrls: string | undefined
  let refreshCount = 0

  backend.setAdapter(
    {
      fetchList: async () => {
        refreshCount++
        return { torrents: torrentStore.torrents }
      },
      addTorrent: async (params: { urls?: string }) => {
        addedUrls = params.urls
      },
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const ctx = useTorrentContext({ overlay: overlay as any })
  const success = await ctx.actions.addTorrent({ urls: 'magnet:?xt=urn:btih:abc' })

  assert.equal(success, true)
  assert.equal(addedUrls, 'magnet:?xt=urn:btih:abc')
  assert.equal(refreshCount, 1)

  backend.setAdapter(
    {
      fetchList: async () => ({ torrents: torrentStore.torrents }),
      addTorrent: async () => {
        throw new Error('boom')
      },
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const originalError = console.error
  console.error = () => {}
  try {
    const failed = await ctx.actions.addTorrent({ urls: 'magnet:?xt=urn:btih:def' })
    assert.equal(failed, false)
    assert.equal(overlay.notifications.at(-1)?.title, '添加种子失败')
  } finally {
    console.error = originalError
  }
})

test('torrent controller: route sync preserves empty category, selected torrent, and detail tab', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  backend.setAdapter(
    {
      fetchList: async () => ({ torrents: new Map() }),
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const route = reactive({
    query: {
      view: 'card',
      q: ' ubuntu ',
      category: '',
      torrent: ' abc123 ',
      tab: 'files',
    } as any,
  })

  const router = {
    async replace({ query }: { query: Record<string, string> }) {
      route.query = query as any
    },
  }

  const ctx = useTorrentContext({
    route: route as any,
    router: router as any,
    overlay: createOverlayMock() as any,
    normalizeViewMode: (viewMode) => viewMode,
  })

  await nextTick()

  assert.equal(ctx.state.ui.viewMode, 'card')
  assert.equal(ctx.state.ui.filter, 'ubuntu')
  assert.equal(ctx.state.filters.categoryFilter.value, '')
  assert.equal(ctx.state.route.selectedTorrentId.value, 'abc123')
  assert.equal(ctx.state.route.detailTab.value, 'files')

  ctx.actions.syncFilterImmediately('arch')
  ctx.actions.setSelectedTorrentId('hash-1')
  ctx.actions.setDetailTab('trackers')

  await nextTick()
  await nextTick()

  assert.deepEqual(route.query, {
    view: 'card',
    q: 'arch',
    category: '',
    torrent: 'hash-1',
    tab: 'trackers',
  })
})

test('torrent controller: normalizeViewMode can run during route initialization with viewport state ready', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  backend.setAdapter(
    {
      fetchList: async () => ({ torrents: new Map() }),
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any,
  )

  const route = reactive({
    query: {
      view: 'list',
    } as any,
  })

  const viewport = reactive({ isMobile: true })
  let normalizeCalls = 0
  let ctx!: ReturnType<typeof useTorrentContext>

  assert.doesNotThrow(() => {
    ctx = useTorrentContext({
      route: route as any,
      overlay: createOverlayMock() as any,
      normalizeViewMode: (viewMode) => {
        normalizeCalls++
        if (viewport.isMobile) return 'card'
        return viewMode === 'card' ? 'list' : viewMode
      },
    })
  })

  await nextTick()

  assert.ok(normalizeCalls >= 1)
  assert.equal(ctx.state.ui.viewMode, 'card')

  viewport.isMobile = false
  ctx.actions.setViewMode('card')

  assert.equal(ctx.state.ui.viewMode, 'list')
})
