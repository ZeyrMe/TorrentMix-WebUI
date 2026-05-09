import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { BaseAdapter, BackendCapabilities } from '@/adapter/interface'
import type { Category, ServerState } from '@/adapter/types'
import type { BackendVersion } from '@/adapter/detect'
import { resolveBackendTaxonomyFacet } from '@/utils/backendTaxonomy'

/**
 * 后端全局 Store
 */
export const useBackendStore = defineStore('backend', () => {
  const DEFAULT_CAPABILITIES: BackendCapabilities = {
    hasSeparateSeedQueue: false,
    hasStalledQueue: false,
    hasTorrentQueue: false,

    hasLSD: false,
    hasEncryption: false,
    encryptionModes: [],

    hasSeedingRatioLimit: false,
    hasSeedingTimeLimit: false,
    seedingTimeLimitMode: 'duration',

    hasDefaultSavePath: false,
    hasIncompleteDir: false,
    hasCreateSubfolder: false,
    hasIncompleteFilesSuffix: false,

    hasTrackerManagement: false,
    hasPeerManagement: false,
    hasBandwidthPriority: false,
    hasTorrentAdvancedSwitches: false,
    hasAutoManagement: false,
    hasSequentialDownload: false,
    hasFirstLastPiecePriority: false,
    hasSuperSeeding: false,

    hasLogs: false,
    hasRss: false,
    hasSearch: false,

    hasProxy: false,
    hasScheduler: false,
    hasIPFilter: false,
    hasScripts: false,
    hasBlocklist: false,
    hasTrashTorrentFiles: false,
  }

  const adapter = ref<BaseAdapter | null>(null)
  const backendType = ref<'qbit' | 'trans' | null>(null)
  const version = ref<BackendVersion | null>(null)

  const categories = shallowRef<Map<string, Category>>(new Map())
  const tags = shallowRef<string[]>([])
  const serverState = shallowRef<ServerState | null>(null)
  const capabilities = shallowRef<BackendCapabilities>(DEFAULT_CAPABILITIES)
  const settingsLoadedPartial = ref(false)
  const mutationCount = ref(0)

  const isMutating = computed(() => mutationCount.value > 0)

  const isInitialized = computed(() => adapter.value !== null)
  const isQbit = computed(() => backendType.value === 'qbit')
  const isTrans = computed(() => backendType.value === 'trans')
  const taxonomyFacet = computed(() => resolveBackendTaxonomyFacet(backendType.value))
  const backendName = computed(() =>
    backendType.value === 'qbit' ? 'qBittorrent' :
    backendType.value === 'trans' ? 'Transmission' : '种子管理器'
  )

  const versionDisplay = computed(() => {
    if (!version.value) return null
    const v = version.value
    if (v.version === 'unknown') return '版本未知'
    return `${backendName.value} ${v.version}`
  })

  function refreshCapabilities() {
    const a = adapter.value as any
    capabilities.value = typeof a?.getCapabilities === 'function' ? a.getCapabilities() : DEFAULT_CAPABILITIES
  }

  function setAdapter(a: BaseAdapter, v: BackendVersion) {
    adapter.value = a
    backendType.value = v.type === 'unknown' ? 'qbit' : v.type
    version.value = v
    refreshCapabilities()
  }

  function clearAdapter() {
    adapter.value = null
    backendType.value = null
    version.value = null
    categories.value = new Map()
    tags.value = []
    serverState.value = null
    capabilities.value = DEFAULT_CAPABILITIES
    settingsLoadedPartial.value = false
    mutationCount.value = 0
  }

  function beginMutation() {
    mutationCount.value++
  }

  function endMutation() {
    mutationCount.value = Math.max(0, mutationCount.value - 1)
  }

  function updateGlobalData(data: {
    categories?: Map<string, Category>
    tags?: string[]
    serverState?: ServerState | null
  }) {
    if (data.categories !== undefined) {
      categories.value = new Map(data.categories)
    }
    if (data.tags !== undefined) {
      tags.value = [...data.tags]
    }
    if (data.serverState !== undefined) {
      serverState.value = data.serverState
    }

    refreshCapabilities()
  }

  return {
    adapter,
    backendType,
    version,
    isInitialized,
    isQbit,
    isTrans,
    taxonomyFacet,
    backendName,
    versionDisplay,
    categories,
    tags,
    serverState,
    capabilities,
    settingsLoadedPartial,
    isMutating,
    beginMutation,
    endMutation,
    setAdapter,
    clearAdapter,
    refreshCapabilities,
    updateGlobalData
  }
})
