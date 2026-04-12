import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeDashboardRouteState,
  encodeDashboardRouteState,
  getDefaultDashboardRouteState,
} from '@/utils/dashboardRouteState'

test('dashboard route state: decode should preserve explicit empty category query', () => {
  const state = decodeDashboardRouteState({
    view: 'card',
    q: [' ubuntu  '],
    state: 'paused-completed',
    category: '',
    tag: 'movie',
    torrent: ' abc123 ',
    tab: 'files',
  })

  assert.deepEqual(state, {
    viewMode: 'card',
    filter: 'ubuntu',
    stateFilter: 'paused-completed',
    categoryFilter: '',
    tagFilter: 'movie',
    selectedTorrent: 'abc123',
    detailTab: 'files',
  })
})

test('dashboard route state: decode should fallback to all when category is missing', () => {
  const state = decodeDashboardRouteState({
    q: 'ubuntu',
  })

  assert.equal(state.categoryFilter, 'all')
})

test('dashboard route state: encode should omit defaults', () => {
  const query = encodeDashboardRouteState({
    ...getDefaultDashboardRouteState(),
    filter: 'ubuntu',
    selectedTorrent: 'hash-1',
    detailTab: 'trackers',
  })

  assert.deepEqual(query, {
    q: 'ubuntu',
    torrent: 'hash-1',
    tab: 'trackers',
  })
})

test('dashboard route state: encode should preserve explicit empty category filter', () => {
  const query = encodeDashboardRouteState({
    ...getDefaultDashboardRouteState(),
    categoryFilter: '',
  })

  assert.deepEqual(query, {
    category: '',
  })
})
