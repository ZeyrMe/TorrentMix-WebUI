import type { LocationQuery, LocationQueryValue } from 'vue-router'
import type { StateFilter } from '@/composables/useTorrentContext'

export type DashboardDetailTab = 'overview' | 'files' | 'trackers' | 'peers'

export interface DashboardRouteState {
  viewMode: 'list' | 'card'
  filter: string
  stateFilter: StateFilter
  categoryFilter: string
  tagFilter: string
  selectedTorrent: string | null
  detailTab: DashboardDetailTab
}

const VALID_STATE_FILTERS = new Set<StateFilter>([
  'all',
  'downloading',
  'seeding',
  'paused',
  'paused-completed',
  'paused-incomplete',
  'checking',
  'queued',
  'error',
])

const VALID_DETAIL_TABS = new Set<DashboardDetailTab>([
  'overview',
  'files',
  'trackers',
  'peers',
])

function pickQueryValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return typeof value === 'string' ? value : ''
}

function hasQueryKey(query: LocationQuery, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(query, key)
}

export function getDefaultDashboardRouteState(): DashboardRouteState {
  return {
    viewMode: 'list',
    filter: '',
    stateFilter: 'all',
    categoryFilter: 'all',
    tagFilter: 'all',
    selectedTorrent: null,
    detailTab: 'overview',
  }
}

export function decodeDashboardRouteState(query: LocationQuery): DashboardRouteState {
  const defaults = getDefaultDashboardRouteState()

  const viewMode = pickQueryValue(query.view)
  const stateFilter = pickQueryValue(query.state)
  const detailTab = pickQueryValue(query.tab)
  const selectedTorrent = pickQueryValue(query.torrent).trim()

  return {
    viewMode: viewMode === 'card' ? 'card' : defaults.viewMode,
    filter: pickQueryValue(query.q).trim(),
    stateFilter: VALID_STATE_FILTERS.has(stateFilter as StateFilter)
      ? (stateFilter as StateFilter)
      : defaults.stateFilter,
    categoryFilter: hasQueryKey(query, 'category')
      ? pickQueryValue(query.category).trim()
      : defaults.categoryFilter,
    tagFilter: pickQueryValue(query.tag).trim() || defaults.tagFilter,
    selectedTorrent: selectedTorrent || null,
    detailTab: VALID_DETAIL_TABS.has(detailTab as DashboardDetailTab)
      ? (detailTab as DashboardDetailTab)
      : defaults.detailTab,
  }
}

export function encodeDashboardRouteState(state: DashboardRouteState): Record<string, string> {
  const defaults = getDefaultDashboardRouteState()
  const next: Record<string, string> = {}

  if (state.viewMode !== defaults.viewMode) next.view = state.viewMode
  if (state.filter.trim()) next.q = state.filter.trim()
  if (state.stateFilter !== defaults.stateFilter) next.state = state.stateFilter
  if (state.categoryFilter !== defaults.categoryFilter) next.category = state.categoryFilter
  if (state.tagFilter !== defaults.tagFilter) next.tag = state.tagFilter
  if (state.selectedTorrent) next.torrent = state.selectedTorrent
  if (state.detailTab !== defaults.detailTab) next.tab = state.detailTab

  return next
}
