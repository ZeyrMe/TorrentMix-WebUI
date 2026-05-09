import { clearTransSessionAuth, clearTransSessionId, saveTransSessionAuth, transClient } from '@/api/trans-client'
import type { BaseAdapter, AddTorrentParams, FetchListResult, TransferSettings, BackendPreferences, BackendCapabilities, TorrentBandwidthPriority } from '../interface'
import type { Category, Peer, ServerState, TorrentFile, TorrentState, Tracker, UnifiedTorrent, UnifiedTorrentDetail } from '../types'
import { VIRTUAL_ROOT_EXTERNAL, VIRTUAL_ROOT_EXTERNAL_PREFIX } from '@/utils/folderTree'

/**
 * Transmission RPC 方法名映射（json-rpc2 vs legacy）
 * - json-rpc2: snake_case, method 形如 torrent_get
 * - legacy: kebab-case, method 形如 torrent-get
 */
type TrMethod =
  | 'session-get'
  | 'session-set'
  | 'queue-move-top'
  | 'queue-move-up'
  | 'queue-move-down'
  | 'queue-move-bottom'
  | 'torrent-get'
  | 'torrent-set'
  | 'torrent-set-location'
  | 'torrent-rename-path'
  | 'torrent-add'
  | 'torrent-remove'
  | 'torrent-start'
  | 'torrent-start-now'
  | 'torrent-stop'
  | 'torrent-verify'
  | 'torrent-reannounce'

const METHOD_MAP: Record<TrMethod, { jsonrpc2: string; legacy: string }> = {
  'session-get': { jsonrpc2: 'session_get', legacy: 'session-get' },
  'session-set': { jsonrpc2: 'session_set', legacy: 'session-set' },
  'queue-move-top': { jsonrpc2: 'queue_move_top', legacy: 'queue-move-top' },
  'queue-move-up': { jsonrpc2: 'queue_move_up', legacy: 'queue-move-up' },
  'queue-move-down': { jsonrpc2: 'queue_move_down', legacy: 'queue-move-down' },
  'queue-move-bottom': { jsonrpc2: 'queue_move_bottom', legacy: 'queue-move-bottom' },
  'torrent-get': { jsonrpc2: 'torrent_get', legacy: 'torrent-get' },
  'torrent-set': { jsonrpc2: 'torrent_set', legacy: 'torrent-set' },
  'torrent-set-location': { jsonrpc2: 'torrent_set_location', legacy: 'torrent-set-location' },
  'torrent-rename-path': { jsonrpc2: 'torrent_rename_path', legacy: 'torrent-rename-path' },
  'torrent-add': { jsonrpc2: 'torrent_add', legacy: 'torrent-add' },
  'torrent-remove': { jsonrpc2: 'torrent_remove', legacy: 'torrent-remove' },
  'torrent-start': { jsonrpc2: 'torrent_start', legacy: 'torrent-start' },
  'torrent-start-now': { jsonrpc2: 'torrent_start_now', legacy: 'torrent-start-now' },
  'torrent-stop': { jsonrpc2: 'torrent_stop', legacy: 'torrent-stop' },
  'torrent-verify': { jsonrpc2: 'torrent_verify', legacy: 'torrent-verify' },
  'torrent-reannounce': { jsonrpc2: 'torrent_reannounce', legacy: 'torrent-reannounce' },
}

/**
 * Transmission RPC 请求体（JSON-RPC 2.0）
 */
interface JSONRPC2Request {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id: number
}

interface JSONRPC2Response<T = unknown> {
  jsonrpc: '2.0'
  result?: T
  error?: {
    code: number
    message: string
    data?: { errorString?: string }
  }
  id?: number
}

/**
 * Transmission RPC 请求体（旧协议）
 */
interface LegacyRequest {
  method: string
  arguments?: Record<string, unknown>
  tag?: number
}

/**
 * Transmission RPC 响应（旧协议）
 */
interface LegacyResponse<T = unknown> {
  result: 'success' | string
  arguments?: T
  tag?: number
}

interface TRTrackerStat {
  announce: string
  tier: number
  hasAnnounced?: boolean
  has_announced?: boolean
  lastAnnounceSucceeded?: boolean
  last_announce_succeeded?: boolean
  lastAnnounceResult?: string
  last_announce_result?: string
  lastAnnouncePeerCount?: number
  last_announce_peer_count?: number
  announceState?: number
  announce_state?: number
  seederCount?: number
  seeder_count?: number
  leecherCount?: number
  leecher_count?: number
}

interface TRPeer {
  address: string
  port: number
  bytesToClient?: number
  bytes_to_client?: number
  bytesToPeer?: number
  bytes_to_peer?: number
  clientName?: string
  client_name?: string
  progress?: number
  rateToClient?: number
  rate_to_client?: number
  rateToPeer?: number
  rate_to_peer?: number
}

/**
 * Transmission 种子对象（字段按需，可同时兼容 json-rpc2/legacy）
 */
interface TRTorrent {
  id?: number
  hashString?: string
  hash_string?: string
  name?: string
  status?: number
  error?: number
  errorString?: string
  error_string?: string
  percentDone?: number
  percent_done?: number
  totalSize?: number
  total_size?: number
  rateDownload?: number
  rate_download?: number
  rateUpload?: number
  rate_upload?: number
  eta?: number
  uploadRatio?: number
  upload_ratio?: number
  addedDate?: number
  added_date?: number
  downloadDir?: string
  download_dir?: string
  labels?: string[]
  downloadedEver?: number
  downloaded_ever?: number
  uploadedEver?: number
  uploaded_ever?: number
  downloadLimit?: number
  download_limit?: number
  downloadLimited?: boolean
  download_limited?: boolean
  uploadLimit?: number
  upload_limit?: number
  uploadLimited?: boolean
  upload_limited?: boolean
  secondsSeeding?: number
  seconds_seeding?: number
  doneDate?: number
  done_date?: number
  peersConnected?: number
  peers_connected?: number
  peersGettingFromUs?: number
  peers_getting_from_us?: number
  peersSendingToUs?: number
  peers_sending_to_us?: number
  bandwidthPriority?: number
  bandwidth_priority?: number
  files?: Array<{
    name: string
    length: number
    bytesCompleted?: number
    bytes_completed?: number
  }>
  trackers?: Array<{
    id?: number
    announce: string
    tier: number
  }>
  trackerStats?: TRTrackerStat[]
  tracker_stats?: TRTrackerStat[]
  peers?: TRPeer[]
  priorities?: number[]
  wanted?: Array<boolean | 0 | 1>
}

/**
 * Transmission 状态码映射到 TorrentState
 *
 * TR_STATUS_STOPPED = 0
 * TR_STATUS_CHECK_WAIT = 1
 * TR_STATUS_CHECK = 2
 * TR_STATUS_DOWNLOAD_WAIT = 3
 * TR_STATUS_DOWNLOAD = 4
 * TR_STATUS_SEED_WAIT = 5
 * TR_STATUS_SEED = 6
 */
const STATE_MAP: Record<number, TorrentState> = {
  0: 'paused',
  1: 'queued',
  2: 'checking',
  3: 'queued',
  4: 'downloading',
  5: 'queued',
  6: 'seeding'
}

/**
 * Transmission 适配器
 *
 * 实现要点：
 * - 使用 hash_string/hashString 作为稳定的 id（daemon 重启后不变）
 * - 支持 JSON-RPC 2.0 (TR 4.1+) 和旧协议 (TR 4.0.x)
 * - 状态用数字枚举，需要映射到 TorrentState
 * - 进度使用 percent_done/percentDone (0-1)
 * - labels 只作为 tags（Transmission 本身没有 Category 概念）
 */
export class TransAdapter implements BaseAdapter {
  private protocolVersion: 'json-rpc2' | 'legacy' = 'legacy'
  private currentMap = new Map<string, UnifiedTorrent>()
  private supportsLabels = true
  private speedBytes = 1024
  private defaultDownloadDir: string | null = null
  private defaultDownloadDirNormalized = ''
  private defaultDownloadDirSegments: string[] = []
  private warnedDirCaseMismatch = false
  private speedBytesState: 'unknown' | 'loading' | 'ready' = 'unknown'
  private speedBytesPromise: Promise<void> | null = null
  private speedBytesEagerLoaded = false
  private tagsMutationChain: Promise<void> = Promise.resolve()
  private transferSettingsCache: { value: TransferSettings; updatedAt: number } | null = null
  private transferSettingsRefreshPromise: Promise<TransferSettings> | null = null
  private readonly transferSettingsTtlMs = 5000

  constructor(versionInfo?: { rpcSemver?: string }) {
    // 根据 rpc-version-semver 判断协议版本和可用字段
    const semverText = versionInfo?.rpcSemver
    const canParseSemver = typeof semverText === 'string' && semverText.includes('.')

    if (!canParseSemver) {
      // 未知版本时优先使用 legacy（兼容面更大；4.1+ 也仍支持 legacy）
      this.protocolVersion = 'legacy'
      // labels 是 Transmission 3.00 (rpc 5.2.0) 才新增；未知版本先乐观开启，失败后降级。
      this.supportsLabels = true
      return
    }

    const semver = String(semverText).split('.').map(Number)
    const major = semver[0] ?? 0
    const minor = semver[1] ?? 0

    // rpc-version-semver >= 6.0.0 使用 JSON-RPC 2.0
    this.protocolVersion = major >= 6 ? 'json-rpc2' : 'legacy'

    // labels 支持：rpc-version-semver >= 5.2.0 (Transmission 3.00+)
    this.supportsLabels = major > 5 || (major === 5 && minor >= 2)
  }

  private normalizeLabels(labels?: string[]): string[] {
    if (!Array.isArray(labels) || labels.length === 0) return []

    const result: string[] = []
    const seen = new Set<string>()
    for (const raw of labels) {
      const tag = String(raw ?? '').trim()
      if (!tag) continue
      if (seen.has(tag)) continue
      seen.add(tag)
      result.push(tag)
    }
    return result
  }

  private normalizeDirPath(path: string): string {
    const normalized = String(path ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')

    if (!normalized) return ''
    if (normalized === '/') return '/'
    return normalized.replace(/\/+$/, '')
  }

  private splitNormalizedDirSegments(normalizedPath: string): string[] {
    if (!normalizedPath || normalizedPath === '/') return []

    const parts = normalizedPath.replace(/^\/+/, '').split('/').filter(Boolean)
    if (parts.length === 0) return []

    const stack: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        if (stack.length > 0) stack.pop()
        continue
      }
      stack.push(part)
    }
    return stack
  }

  private isSegmentsPrefix(pathSegments: string[], baseSegments: string[], caseInsensitive: boolean): boolean {
    if (baseSegments.length === 0) return true
    if (pathSegments.length < baseSegments.length) return false

    for (let i = 0; i < baseSegments.length; i++) {
      const a = pathSegments[i] ?? ''
      const b = baseSegments[i] ?? ''
      if (caseInsensitive) {
        if (a.toLowerCase() !== b.toLowerCase()) return false
      } else {
        if (a !== b) return false
      }
    }

    return true
  }

  private enqueueTagsMutation(task: () => Promise<void>): Promise<void> {
    const run = this.tagsMutationChain.then(task, task)
    this.tagsMutationChain = run.then(() => {}, () => {})
    return run
  }

  private getFolderKey(downloadDir: string): string {
    const dirNormalized = this.normalizeDirPath(downloadDir)
    if (!dirNormalized) return ''

    const dirSegments = this.splitNormalizedDirSegments(dirNormalized)
    const baseNormalized = this.defaultDownloadDirNormalized
    const baseSegments = this.defaultDownloadDirSegments

    if (baseNormalized) {
      if (this.isSegmentsPrefix(dirSegments, baseSegments, false)) {
        return dirSegments.slice(baseSegments.length).join('/')
      }

      if (this.isSegmentsPrefix(dirSegments, baseSegments, true)) {
        if (!this.warnedDirCaseMismatch) {
          this.warnedDirCaseMismatch = true
          console.warn('[TransAdapter] download_dir differs by case from download-dir. Using case-insensitive path mapping.')
        }
        return dirSegments.slice(baseSegments.length).join('/')
      }

      // 若 torrent 被移动到默认目录之外，为避免与默认目录内的相对路径冲突，统一挂在“外部”分支下
      const external = dirSegments.join('/')
      return external ? `${VIRTUAL_ROOT_EXTERNAL_PREFIX}${external}` : VIRTUAL_ROOT_EXTERNAL
    }

    return dirSegments.join('/')
  }

  private pick<T>(obj: Record<string, unknown> | undefined, ...keys: string[]): T | undefined {
    if (!obj) return undefined
    for (const key of keys) {
      const value = (obj as any)[key]
      if (value !== undefined) return value as T
    }
    return undefined
  }

  private updateSessionInfo(session: Record<string, unknown> | undefined): void {
    if (!session) return

    const units = this.pick<Record<string, unknown>>(session, 'units')
    if (units && typeof units === 'object') {
      const speedBytes = this.pick<number>(units as any, 'speed_bytes', 'speed-bytes', 'speedBytes')
      if (typeof speedBytes === 'number' && Number.isFinite(speedBytes) && speedBytes > 0) {
        this.speedBytes = speedBytes
      }
    }

    const downloadDir = this.pick<string>(session, 'download_dir', 'download-dir', 'downloadDir')
    if (typeof downloadDir === 'string' && downloadDir.trim()) {
      this.defaultDownloadDir = downloadDir.trim()
      this.defaultDownloadDirNormalized = this.normalizeDirPath(this.defaultDownloadDir)
      this.defaultDownloadDirSegments = this.splitNormalizedDirSegments(this.defaultDownloadDirNormalized)
    }
  }

  private isInvalidArgumentError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /invalid argument/i.test(message)
  }

  private async ensureSpeedBytes(): Promise<void> {
    if (this.speedBytesState === 'ready') return
    if (this.speedBytesPromise) return this.speedBytesPromise

    this.speedBytesState = 'loading'
    this.speedBytesPromise = (async () => {
      try {
        const session = await this.rpcCall<Record<string, unknown>>('session-get')
        this.updateSessionInfo(session)
        this.speedBytesState = 'ready'
      } catch (error) {
        this.speedBytesState = 'unknown'
        throw error
      } finally {
        this.speedBytesPromise = null
      }
    })()

    return this.speedBytesPromise
  }

  private isTransferSettingsCacheFresh(now: number): boolean {
    if (!this.transferSettingsCache) return false
    return now - this.transferSettingsCache.updatedAt <= this.transferSettingsTtlMs
  }

  private async refreshTransferSettingsCache(): Promise<TransferSettings> {
    if (this.transferSettingsRefreshPromise) return this.transferSettingsRefreshPromise

    this.transferSettingsRefreshPromise = this.getTransferSettings()

    try {
      return await this.transferSettingsRefreshPromise
    } finally {
      this.transferSettingsRefreshPromise = null
    }
  }

  private getSwarmCounts(trackerStats?: TRTrackerStat[]): { seeds: number; leechers: number } | undefined {
    if (!trackerStats || trackerStats.length === 0) return undefined

    // tracker_stats 每个 tracker 都会给一次统计，多 tracker 场景下简单相加会明显过量；
    // 这里取 max 来近似当前可见的 swarm 规模。
    let seeds = 0
    let leechers = 0
    let hasAny = false
    for (const stat of trackerStats) {
      const s = this.pick<number>(stat as any, 'seeder_count', 'seederCount')
      const l = this.pick<number>(stat as any, 'leecher_count', 'leecherCount')
      if (typeof s === 'number' && Number.isFinite(s) && s >= 0) {
        hasAny = true
        seeds = Math.max(seeds, s)
      }
      if (typeof l === 'number' && Number.isFinite(l) && l >= 0) {
        hasAny = true
        leechers = Math.max(leechers, l)
      }
    }

    if (!hasAny) return undefined
    return { seeds, leechers }
  }

  /**
   * 封装 RPC 调用，统一处理协议版本和错误
   */
  private async rpcCall<T = unknown>(
    method: TrMethod,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (this.protocolVersion === 'json-rpc2') {
      const payload: JSONRPC2Request = {
        jsonrpc: '2.0',
        method: METHOD_MAP[method].jsonrpc2,
        params,
        id: Date.now(),
      }
      const { data, status } = await transClient.post<JSONRPC2Response<T>>('', payload)
      if (status === 204) return undefined as T
      if (!data) return undefined as T
      if (data.error) {
        const extra = data.error.data?.errorString ? `: ${data.error.data.errorString}` : ''
        throw new Error(`Transmission RPC error(${data.error.code}): ${data.error.message}${extra}`)
      }
      return data.result as T
    }

    const payload: LegacyRequest = {
      method: METHOD_MAP[method].legacy,
      arguments: params,
      tag: Date.now(),
    }

    const { data } = await transClient.post<LegacyResponse<T>>('', payload)

    if (data.result !== 'success') {
      throw new Error(`Transmission RPC error: ${data.result}`)
    }

    return data.arguments as T
  }

  /**
   * 归一化：Transmission → UnifiedTorrent
   */
  private normalize(raw: TRTorrent): UnifiedTorrent {
    const hash = this.pick<string>(raw as any, 'hash_string', 'hashString') ?? ''
    const statusCode = this.pick<number>(raw as any, 'status') ?? -1
    const errorCode = this.pick<number>(raw as any, 'error') ?? 0

    const state = errorCode !== 0 ? 'error' : (STATE_MAP[statusCode] ?? 'error')

    const trackerStats = this.pick<TRTrackerStat[]>(raw as any, 'tracker_stats', 'trackerStats')
    const swarm = this.getSwarmCounts(trackerStats)
    const savePath = this.pick<string>(raw as any, 'download_dir', 'downloadDir') ?? ''
    const category = this.getFolderKey(savePath)
    const tags = this.normalizeLabels(raw.labels)

    return {
      id: hash,
      name: this.pick<string>(raw as any, 'name') ?? '',
      state,
      progress: this.pick<number>(raw as any, 'percent_done', 'percentDone') ?? 0,
      size: this.pick<number>(raw as any, 'total_size', 'totalSize') ?? 0,
      dlspeed: this.pick<number>(raw as any, 'rate_download', 'rateDownload') ?? 0,
      upspeed: this.pick<number>(raw as any, 'rate_upload', 'rateUpload') ?? 0,
      eta: (() => {
        const eta = this.pick<number>(raw as any, 'eta') ?? -1
        return eta === -1 ? -1 : eta
      })(),
      ratio: this.pick<number>(raw as any, 'upload_ratio', 'uploadRatio') ?? 0,
      addedTime: this.pick<number>(raw as any, 'added_date', 'addedDate') ?? 0,
      savePath,
      category,
      tags,
      totalSeeds: swarm?.seeds,
      totalPeers: swarm?.leechers,
      numSeeds: swarm?.seeds,
      numPeers: swarm?.leechers,
    }
  }

  /**
   * 映射 Tracker 状态
   */
  private mapTracker(
    tracker: { announce: string; tier: number },
    stat?: TRTrackerStat
  ): Tracker {
    let status: Tracker['status'] = 'not_working'

    if (stat) {
      const announceState = this.pick<number>(stat as any, 'announce_state', 'announceState') ?? 0
      const hasAnnounced = this.pick<boolean>(stat as any, 'has_announced', 'hasAnnounced') ?? false
      const lastAnnounceSucceeded = this.pick<boolean>(stat as any, 'last_announce_succeeded', 'lastAnnounceSucceeded') ?? false
      if (announceState > 0) {
        status = 'updating'
      } else if (hasAnnounced && lastAnnounceSucceeded) {
        status = 'working'
      }
    }

    return {
      url: tracker.announce,
      status,
      msg: this.pick<string>(stat as any, 'last_announce_result', 'lastAnnounceResult') || '',
      peers: this.pick<number>(stat as any, 'last_announce_peer_count', 'lastAnnouncePeerCount') || 0,
      tier: tracker.tier || 0,
    }
  }

  // ========== 全局/备用限速设置 ==========

  async getTransferSettings(): Promise<TransferSettings> {
    const args = await this.rpcCall<Record<string, unknown>>('session-get')
    this.updateSessionInfo(args)
    this.speedBytesState = 'ready'

    const dlEnabled = Boolean(this.pick<boolean>(args, 'speed_limit_down_enabled', 'speed-limit-down-enabled'))
    const ulEnabled = Boolean(this.pick<boolean>(args, 'speed_limit_up_enabled', 'speed-limit-up-enabled'))
    const dlKbps = this.pick<number>(args, 'speed_limit_down', 'speed-limit-down') ?? 0
    const ulKbps = this.pick<number>(args, 'speed_limit_up', 'speed-limit-up') ?? 0

    const altEnabled = Boolean(this.pick<boolean>(args, 'alt_speed_enabled', 'alt-speed-enabled'))
    const altDlKbps = this.pick<number>(args, 'alt_speed_down', 'alt-speed-down') ?? 0
    const altUlKbps = this.pick<number>(args, 'alt_speed_up', 'alt-speed-up') ?? 0

    const settings: TransferSettings = {
      downloadLimit: dlEnabled ? Math.max(0, dlKbps) * this.speedBytes : 0,
      uploadLimit: ulEnabled ? Math.max(0, ulKbps) * this.speedBytes : 0,
      altEnabled,
      altDownloadLimit: Math.max(0, altDlKbps) * this.speedBytes,
      altUploadLimit: Math.max(0, altUlKbps) * this.speedBytes,
      speedBytes: this.speedBytes,
    }
    this.transferSettingsCache = { value: settings, updatedAt: Date.now() }
    return settings
  }

  async setTransferSettings(patch: Partial<TransferSettings>): Promise<void> {
    await this.ensureSpeedBytes().catch(error => {
      console.warn('[TransAdapter] Failed to load speed units:', error)
    })

    const args: Record<string, unknown> = {}
    const downEnabledKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_down_enabled' : 'speed-limit-down-enabled'
    const downKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_down' : 'speed-limit-down'
    const upEnabledKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_up_enabled' : 'speed-limit-up-enabled'
    const upKey = this.protocolVersion === 'json-rpc2' ? 'speed_limit_up' : 'speed-limit-up'
    const altEnabledKey = this.protocolVersion === 'json-rpc2' ? 'alt_speed_enabled' : 'alt-speed-enabled'
    const altDownKey = this.protocolVersion === 'json-rpc2' ? 'alt_speed_down' : 'alt-speed-down'
    const altUpKey = this.protocolVersion === 'json-rpc2' ? 'alt_speed_up' : 'alt-speed-up'

    if (typeof patch.downloadLimit === 'number') {
      const kbps = Math.max(0, Math.round(patch.downloadLimit / this.speedBytes))
      args[downEnabledKey] = kbps > 0
      args[downKey] = kbps
    }
    if (typeof patch.uploadLimit === 'number') {
      const kbps = Math.max(0, Math.round(patch.uploadLimit / this.speedBytes))
      args[upEnabledKey] = kbps > 0
      args[upKey] = kbps
    }
    if (typeof patch.altEnabled === 'boolean') {
      args[altEnabledKey] = patch.altEnabled
    }
    if (typeof patch.altDownloadLimit === 'number') {
      args[altDownKey] = Math.max(0, Math.round(patch.altDownloadLimit / this.speedBytes))
    }
    if (typeof patch.altUploadLimit === 'number') {
      args[altUpKey] = Math.max(0, Math.round(patch.altUploadLimit / this.speedBytes))
    }

    if (Object.keys(args).length === 0) return

    await this.rpcCall('session-set', args)

    if (this.transferSettingsCache) {
      const previous = this.transferSettingsCache.value
      const next: TransferSettings = { ...previous }
      if (typeof patch.downloadLimit === 'number') next.downloadLimit = patch.downloadLimit
      if (typeof patch.uploadLimit === 'number') next.uploadLimit = patch.uploadLimit
      if (typeof patch.altEnabled === 'boolean') next.altEnabled = patch.altEnabled
      if (typeof patch.altDownloadLimit === 'number') next.altDownloadLimit = patch.altDownloadLimit
      if (typeof patch.altUploadLimit === 'number') next.altUploadLimit = patch.altUploadLimit
      this.transferSettingsCache = { value: next, updatedAt: Date.now() }
    }
  }

  async getPreferences(): Promise<BackendPreferences> {
    const session = await this.rpcCall<Record<string, unknown>>('session-get')
    this.updateSessionInfo(session)
    this.speedBytesState = 'ready'

    return {
      // 连接
      maxConnections: this.pick<number>(session, 'peer_limit_global', 'peer-limit-global'),
      maxConnectionsPerTorrent: this.pick<number>(session, 'peer_limit_per_torrent', 'peer-limit-per-torrent'),

      // 队列
      queueDownloadEnabled: this.pick<boolean>(session, 'download_queue_enabled', 'download-queue-enabled'),
      queueDownloadMax: this.pick<number>(session, 'download_queue_size', 'download-queue-size'),
      queueSeedEnabled: this.pick<boolean>(session, 'seed_queue_enabled', 'seed-queue-enabled'),
      queueSeedMax: this.pick<number>(session, 'seed_queue_size', 'seed-queue-size'),
      queueStalledEnabled: this.pick<boolean>(session, 'queue_stalled_enabled', 'queue-stalled-enabled'),
      queueStalledMinutes: this.pick<number>(session, 'queue_stalled_minutes', 'queue-stalled-minutes'),

      // 端口
      listenPort: this.pick<number>(session, 'peer_port', 'peer-port'),
      randomPort: this.pick<boolean>(session, 'peer_port_random_on_start', 'peer-port-random-on-start'),
      upnpEnabled: this.pick<boolean>(session, 'port_forwarding_enabled', 'port-forwarding-enabled'),

      // 协议
      dhtEnabled: this.pick<boolean>(session, 'dht_enabled', 'dht-enabled'),
      pexEnabled: this.pick<boolean>(session, 'pex_enabled', 'pex-enabled'),
      lsdEnabled: this.pick<boolean>(session, 'lpd_enabled', 'lpd-enabled'),
      encryption: this.mapEncryptionMode(this.pick<string>(session, 'encryption')),

      // Phase 1: 做种限制
      shareRatioLimit: this.pick<number>(session, 'seed_ratio_limit', 'seedRatioLimit', 'seed-ratio-limit'),
      shareRatioLimited: this.pick<boolean>(session, 'seed_ratio_limited', 'seedRatioLimited', 'seed-ratio-limited'),
      seedingTimeLimit: this.pick<number>(session, 'seed_idle_limit', 'seedIdleLimit', 'seed-idle-limit'),
      seedingTimeLimited: this.pick<boolean>(session, 'seed_idle_limited', 'seedIdleLimited', 'seed-idle-limited'),

      // Phase 1: 下载路径
      savePath: this.pick<string>(session, 'download_dir', 'download-dir'),
      incompleteDirEnabled: this.pick<boolean>(session, 'incomplete_dir_enabled', 'incomplete-dir-enabled'),
      incompleteDir: this.pick<string>(session, 'incomplete_dir', 'incomplete-dir'),
      incompleteFilesSuffix: this.pick<boolean>(session, 'rename_partial_files', 'rename-partial-files')
    }
  }

  async setPreferences(patch: Partial<BackendPreferences>): Promise<void> {
    const args: Record<string, unknown> = {}

    // 字段名映射（根据协议版本）
    const keyMapper = (key: string) =>
      this.protocolVersion === 'json-rpc2' ? key : key.replace(/_/g, '-')

    if (patch.maxConnections !== undefined) {
      args[keyMapper('peer_limit_global')] = patch.maxConnections
    }
    if (patch.maxConnectionsPerTorrent !== undefined) {
      args[keyMapper('peer_limit_per_torrent')] = patch.maxConnectionsPerTorrent
    }
    if (patch.queueDownloadEnabled !== undefined) {
      args[keyMapper('download_queue_enabled')] = patch.queueDownloadEnabled
    }
    if (patch.queueDownloadMax !== undefined) {
      args[keyMapper('download_queue_size')] = patch.queueDownloadMax
    }
    if (patch.queueSeedEnabled !== undefined) {
      args[keyMapper('seed_queue_enabled')] = patch.queueSeedEnabled
    }
    if (patch.queueSeedMax !== undefined) {
      args[keyMapper('seed_queue_size')] = patch.queueSeedMax
    }
    if (patch.listenPort !== undefined) {
      args[keyMapper('peer_port')] = patch.listenPort
    }
    if (patch.randomPort !== undefined) {
      args[keyMapper('peer_port_random_on_start')] = patch.randomPort
    }
    if (patch.upnpEnabled !== undefined) {
      args[keyMapper('port_forwarding_enabled')] = patch.upnpEnabled
    }
    if (patch.dhtEnabled !== undefined) {
      args[keyMapper('dht_enabled')] = patch.dhtEnabled
    }
    if (patch.pexEnabled !== undefined) {
      args[keyMapper('pex_enabled')] = patch.pexEnabled
    }
    if (patch.lsdEnabled !== undefined) {
      args[keyMapper('lpd_enabled')] = patch.lsdEnabled
    }
    if (patch.encryption !== undefined) {
      args.encryption = this.unmapEncryptionMode(patch.encryption)
    }

    // Phase 1: 做种限制和队列
    if (patch.shareRatioLimit !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_ratio_limit = patch.shareRatioLimit
      else args.seedRatioLimit = patch.shareRatioLimit
    }
    if (patch.shareRatioLimited !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_ratio_limited = patch.shareRatioLimited
      else args.seedRatioLimited = patch.shareRatioLimited
    }
    if (patch.seedingTimeLimit !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_idle_limit = patch.seedingTimeLimit
      else args.seedIdleLimit = patch.seedingTimeLimit
    }
    if (patch.seedingTimeLimited !== undefined) {
      if (this.protocolVersion === 'json-rpc2') args.seed_idle_limited = patch.seedingTimeLimited
      else args.seedIdleLimited = patch.seedingTimeLimited
    }
    if (patch.queueStalledEnabled !== undefined) {
      args[keyMapper('queue_stalled_enabled')] = patch.queueStalledEnabled
    }
    if (patch.queueStalledMinutes !== undefined) {
      args[keyMapper('queue_stalled_minutes')] = patch.queueStalledMinutes
    }

    // Phase 1: 下载路径
    if (patch.savePath !== undefined) {
      args[keyMapper('download_dir')] = patch.savePath
    }
    if (patch.incompleteDirEnabled !== undefined) {
      args[keyMapper('incomplete_dir_enabled')] = patch.incompleteDirEnabled
    }
    if (patch.incompleteDir !== undefined) {
      args[keyMapper('incomplete_dir')] = patch.incompleteDir
    }
    if (patch.incompleteFilesSuffix !== undefined) {
      args[keyMapper('rename_partial_files')] = patch.incompleteFilesSuffix
    }

    if (Object.keys(args).length === 0) return

    await this.rpcCall('session-set', args)
  }

  getCapabilities(): BackendCapabilities {
    return {
      // 队列相关
      hasSeparateSeedQueue: true, // TR 的下载/做种队列是独立的
      hasStalledQueue: true,       // 支持 queue-stalled-minutes
      hasTorrentQueue: true,

      // 协议相关
      hasLSD: true,                // 支持 LPD（本地发现）
      hasEncryption: true,
      encryptionModes: ['tolerate', 'prefer', 'require'],

      // 做种限制
      hasSeedingRatioLimit: true,  // 支持 seedRatioLimit
      hasSeedingTimeLimit: true,   // 支持 seedIdleLimit
      seedingTimeLimitMode: 'idle',

      // 路径相关
      hasDefaultSavePath: true,    // 支持 download-dir
      hasIncompleteDir: true,      // 支持 incomplete-dir
      hasCreateSubfolder: false,
      hasIncompleteFilesSuffix: true,

      hasTrackerManagement: true,
      hasPeerManagement: false,
      hasBandwidthPriority: true,
      hasTorrentAdvancedSwitches: false,
      hasAutoManagement: false,
      hasSequentialDownload: false,
      hasFirstLastPiecePriority: false,
      hasSuperSeeding: false,

      hasLogs: false,
      hasRss: false,
      hasSearch: false,

      // 高级功能
      hasProxy: false,             // 不支持代理设置
      hasScheduler: false,         // 不支持调度器
      hasIPFilter: false,          // 不支持 IP 过滤
      hasScripts: true,            // 支持脚本系统（script-torrent-done-filename）
      hasBlocklist: true,          // 支持屏蔽列表（blocklist-url）
      hasTrashTorrentFiles: true,  // 支持 trash-original-torrent-files
    }
  }

  private mapEncryptionMode(mode?: string): BackendPreferences['encryption'] {
    if (!mode) return undefined
    const normalized = String(mode).toLowerCase()
    if (normalized === 'required') return 'require'
    if (normalized === 'preferred') return 'prefer'
    if (normalized === 'tolerated') return 'tolerate'
    return 'tolerate'
  }

  private unmapEncryptionMode(mode: BackendPreferences['encryption']): string {
    if (mode === 'require') return 'required'
    if (mode === 'prefer') return 'preferred'
    return 'tolerated'
  }

  private buildIds(hashes: string[]): Record<string, unknown> {
    return hashes.length > 0 ? { ids: hashes } : {}
  }

  async fetchList(): Promise<FetchListResult> {
    // speedBytes/defaultDownloadDir：稳定配置，优先在首次列表加载前拿到，避免 UI 首屏出现“目录树抖动”
    const now = Date.now()
    let transferSettings: TransferSettings | undefined = this.transferSettingsCache?.value

    const shouldInitSession = !this.speedBytesEagerLoaded
    if (shouldInitSession) this.speedBytesEagerLoaded = true

    const initTransferSettingsPromise = shouldInitSession
      ? this.refreshTransferSettingsCache().catch(error => {
          console.warn('[TransAdapter] Failed to load session info:', error)
          return undefined
        })
      : null

    if (!shouldInitSession && (!transferSettings || !this.isTransferSettingsCacheFresh(now))) {
      // Stale-While-Revalidate：不阻塞列表，后台刷新一次
      void this.refreshTransferSettingsCache().catch(error => {
        console.warn('[TransAdapter] Failed to refresh session info:', error)
      })
    }

    const call = async () => this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
      fields: this.protocolVersion === 'json-rpc2'
        ? [
            'hash_string', 'id', 'name', 'status', 'error', 'error_string',
            'percent_done', 'total_size',
            'rate_download', 'rate_upload',
            'eta', 'upload_ratio',
            'added_date', 'download_dir',
            ...(this.supportsLabels ? ['labels'] : []),
            'tracker_stats',
          ]
        : [
            'hashString', 'id', 'name', 'status', 'error', 'errorString',
            'percentDone', 'totalSize',
            'rateDownload', 'rateUpload',
            'eta', 'uploadRatio',
            'addedDate', 'downloadDir',
            ...(this.supportsLabels ? ['labels'] : []),
            'trackerStats',
          ],
    })

    const torrentsPromise = (async () => {
      let data: { torrents: TRTorrent[] }
      try {
        data = await call()
      } catch (error) {
        if (!this.supportsLabels) throw error
        if (!this.isInvalidArgumentError(error)) throw error
        this.supportsLabels = false
        try {
          data = await call()
        } catch {
          this.supportsLabels = true
          throw error
        }
      }
      return data
    })()

    let data: { torrents: TRTorrent[] }
    if (initTransferSettingsPromise) {
      const [ts, torrentsData] = await Promise.all([initTransferSettingsPromise, torrentsPromise])
      transferSettings = ts ?? transferSettings
      data = torrentsData
    } else {
      data = await torrentsPromise
    }

    const map = new Map<string, UnifiedTorrent>()
    for (const torrent of data.torrents || []) {
      const hash = this.pick<string>(torrent as any, 'hash_string', 'hashString')
      if (!hash) continue
      map.set(hash, this.normalize(torrent))
    }

    this.currentMap = map

    // Transmission：用 downloadDir 聚合“目录树”筛选项；labels 仅作为 tags。
    const categoryNames = new Set<string>()
    let hasRoot = false
    const tagSet = new Set<string>()
    let dlInfoSpeed = 0
    let upInfoSpeed = 0
    for (const torrent of this.currentMap.values()) {
      dlInfoSpeed += torrent.dlspeed
      upInfoSpeed += torrent.upspeed
      const category = (torrent.category ?? '').trim()
      if (category === '') hasRoot = true
      else categoryNames.add(category)
      for (const tag of torrent.tags || []) {
        const normalized = tag.trim()
        if (normalized) tagSet.add(normalized)
      }
    }

    const categories = new Map<string, Category>()
    if (hasRoot) categories.set('', { name: '', savePath: this.defaultDownloadDir ?? '' })
    for (const name of Array.from(categoryNames).sort((a, b) => a.localeCompare(b))) {
      categories.set(name, { name, savePath: '' })
    }

    const useAltSpeed = transferSettings?.altEnabled ?? false
    const serverState: ServerState = {
      dlInfoSpeed,
      upInfoSpeed,
      dlRateLimit: transferSettings ? (useAltSpeed ? transferSettings.altDownloadLimit : transferSettings.downloadLimit) : 0,
      upRateLimit: transferSettings ? (useAltSpeed ? transferSettings.altUploadLimit : transferSettings.uploadLimit) : 0,
      connectionStatus: 'connected',
      peers: 0,
      freeSpaceOnDisk: 0,
      useAltSpeed,
      altDlLimit: transferSettings?.altDownloadLimit ?? 0,
      altUpLimit: transferSettings?.altUploadLimit ?? 0,
      backendName: 'Transmission',
    }

    return {
      torrents: this.currentMap,
      categories,
      tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b)),
      serverState,
    }
  }

  async pause(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-stop', this.buildIds(hashes))
  }

  async resume(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-start', this.buildIds(hashes))
  }

  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    const deleteKey = this.protocolVersion === 'json-rpc2' ? 'delete_local_data' : 'delete-local-data'
    await this.rpcCall('torrent-remove', {
      ...this.buildIds(hashes),
      [deleteKey]: deleteFiles,
    })
  }

  async addTorrent(params: AddTorrentParams): Promise<void> {
    const rpcParams: Record<string, unknown> = {}
    const downloadDirKey = this.protocolVersion === 'json-rpc2' ? 'download_dir' : 'download-dir'

    if (params.paused !== undefined) {
      rpcParams['paused'] = params.paused
    }
    if (params.savepath) {
      rpcParams[downloadDirKey] = params.savepath
    }

    if (params.category?.trim()) {
      console.warn('[TransAdapter] category is ignored for Transmission; use savepath/download dir + labels(tags).')
    }

    const labels = (params.tags || []).map(t => t.trim()).filter(Boolean)
    let includeLabels = this.supportsLabels && labels.length > 0

    const addOne = async (body: Record<string, unknown>) => {
      try {
        await this.rpcCall('torrent-add', body)
      } catch (error) {
        if (!includeLabels) throw error
        if (!this.isInvalidArgumentError(error)) throw error
        this.supportsLabels = false
        includeLabels = false
        try {
          const retryBody = { ...body }
          delete (retryBody as any).labels
          await this.rpcCall('torrent-add', retryBody)
        } catch {
          // 保守：若禁用 labels 后仍失败，恢复 supportsLabels，抛出原错误
          this.supportsLabels = true
          includeLabels = true
          throw error
        }
      }
    }

    // 处理 URL（magnet 和 HTTP URL 都用 filename 参数）
    if (params.urls?.trim()) {
      const urls = params.urls.trim().split('\n').filter((u: string) => u)
      for (const url of urls) {
        await addOne({
          ...rpcParams,
          ...(includeLabels ? { labels } : {}),
          filename: url,
        })
      }
    }

    // 处理 .torrent 文件
    if (params.files?.length) {
      for (const file of params.files) {
        const arrayBuffer = await file.arrayBuffer()
        const base64 = uint8ToBase64(new Uint8Array(arrayBuffer))

        await addOne({
          ...rpcParams,
          ...(includeLabels ? { labels } : {}),
          metainfo: base64,
        })
      }
    }
  }

  // 登录认证（Transmission 使用 HTTP Basic Auth）
  async login(username: string, password: string): Promise<void> {
    const user = String(username ?? '').trim()
    const pass = String(password ?? '').trim()

    clearTransSessionId()

    // 允许“开放后端”不配置凭证：不设置 Basic Auth 头，直接验证 RPC 是否可用。
    transClient.defaults.auth = (!user && !pass) ? undefined : { username: user, password: pass }

    try {
      // 验证凭证有效性
      const session = await this.rpcCall<Record<string, unknown>>('session-get')
      this.updateSessionInfo(session)
      this.speedBytesState = 'ready'
      saveTransSessionAuth(user, pass)
    } catch (error) {
      clearTransSessionAuth()
      throw error
    }
  }

  /**
   * 当前是否配置了 HTTP Basic Auth 凭证
   * 用于 UI 层区分显示“退出登录”还是“断开连接”
   */
  get hasCredentials(): boolean {
    return Boolean(transClient.defaults.auth)
  }

  // 登出
  async logout(): Promise<void> {
    clearTransSessionAuth()
  }

  // 静默验证 session
  async checkSession(): Promise<boolean> {
    try {
      const session = await this.rpcCall<Record<string, unknown>>('session-get')
      this.updateSessionInfo(session)
      this.speedBytesState = 'ready'
      return true
    } catch {
      return false
    }
  }

  // 获取种子详情
  async fetchDetail(hash: string): Promise<UnifiedTorrentDetail> {
    await this.ensureSpeedBytes().catch(error => {
      console.warn('[TransAdapter] Failed to load speed units:', error)
    })

    const call = async () => this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
      ids: [hash],
          fields: this.protocolVersion === 'json-rpc2'
          ? [
              'hash_string', 'name',
              'total_size',
              'downloaded_ever', 'uploaded_ever',
              'bandwidth_priority',
              'download_limit', 'download_limited',
              'upload_limit', 'upload_limited',
              'seconds_seeding',
              'added_date', 'done_date',
              'download_dir',
            ...(this.supportsLabels ? ['labels'] : []),
            'peers_connected',
            'peers_getting_from_us',
            'peers_sending_to_us',
            'files',
            'trackers',
            'tracker_stats',
            'peers',
            'priorities',
            'wanted',
          ]
          : [
              'hashString', 'name',
              'totalSize',
              'downloadedEver', 'uploadedEver',
              'bandwidthPriority',
              'downloadLimit', 'downloadLimited',
              'uploadLimit', 'uploadLimited',
              'secondsSeeding',
              'addedDate', 'doneDate',
              'downloadDir',
            ...(this.supportsLabels ? ['labels'] : []),
            'peersConnected',
            'peersGettingFromUs',
            'peersSendingToUs',
            'files',
            'trackers',
            'trackerStats',
            'peers',
            'priorities',
            'wanted',
          ],
    })

    let data: { torrents: TRTorrent[] }
    try {
      data = await call()
    } catch (error) {
      if (!this.supportsLabels) throw error
      if (!this.isInvalidArgumentError(error)) throw error
      this.supportsLabels = false
      try {
        data = await call()
      } catch {
        this.supportsLabels = true
        throw error
      }
    }

    const torrent = data.torrents?.[0]
    if (!torrent) {
      throw new Error('Torrent not found')
    }

    const trackerStats = torrent.tracker_stats || torrent.trackerStats || []

    const swarm = this.getSwarmCounts(trackerStats)
    const totalSeeds = swarm?.seeds ?? 0
    const totalLeechers = swarm?.leechers ?? 0

    const files: TorrentFile[] = (torrent.files || []).map((f, idx) => {
      const priorityNum = torrent.priorities?.[idx] ?? 0
      const wantedRaw = torrent.wanted?.[idx]
      const wanted = wantedRaw === undefined ? true : Boolean(wantedRaw)

      let priority: TorrentFile['priority'] = 'normal'
      if (!wanted) {
        priority = 'do_not_download'
      } else if (priorityNum === 1) {
        priority = 'high'
      } else if (priorityNum === -1) {
        priority = 'low'
      }

      const completedBytes = this.pick<number>(f as any, 'bytes_completed', 'bytesCompleted') ?? 0
      const length = f.length || 0

      return {
        id: idx,
        name: f.name,
        size: length,
        progress: length > 0 ? completedBytes / length : 0,
        priority,
      }
    })

    const trackerStatsByKey = new Map<string, TRTrackerStat>()
    const trackerStatsByAnnounce = new Map<string, TRTrackerStat>()
    for (const stat of trackerStats) {
      if (!stat || typeof stat !== 'object') continue
      const announce = (stat as any).announce
      const tier = (stat as any).tier
      if (typeof announce !== 'string' || !announce) continue
      trackerStatsByAnnounce.set(announce, stat)
      trackerStatsByKey.set(`${announce}\n${String(tier ?? '')}`, stat)
    }

    const trackers: Tracker[] = (torrent.trackers || []).map((t) => {
      const key = `${t.announce}\n${String((t as any).tier ?? '')}`
      const stat = trackerStatsByKey.get(key) ?? trackerStatsByAnnounce.get(t.announce)
      return this.mapTracker(t, stat)
    })

    const peers: Peer[] = (torrent.peers || []).map(p => ({
      ip: p.address,
      port: p.port,
      client: this.pick<string>(p as any, 'client_name', 'clientName') || '',
      progress: p.progress || 0,
      dlSpeed: this.pick<number>(p as any, 'rate_to_client', 'rateToClient') || 0,
      upSpeed: this.pick<number>(p as any, 'rate_to_peer', 'rateToPeer') || 0,
      downloaded: this.pick<number>(p as any, 'bytes_to_client', 'bytesToClient') ?? 0,
      uploaded: this.pick<number>(p as any, 'bytes_to_peer', 'bytesToPeer') ?? 0,
    }))

    const dlLimited = this.pick<boolean>(torrent as any, 'download_limited', 'downloadLimited') ?? false
    const dlLimitKb = this.pick<number>(torrent as any, 'download_limit', 'downloadLimit') ?? 0
    const upLimited = this.pick<boolean>(torrent as any, 'upload_limited', 'uploadLimited') ?? false
    const upLimitKb = this.pick<number>(torrent as any, 'upload_limit', 'uploadLimit') ?? 0
    const bandwidthPriorityRaw = this.pick<number>(torrent as any, 'bandwidth_priority', 'bandwidthPriority')
    const bandwidthPriority: UnifiedTorrentDetail['bandwidthPriority'] = bandwidthPriorityRaw === 1
      ? 'high'
      : bandwidthPriorityRaw === -1
        ? 'low'
        : bandwidthPriorityRaw === 0
          ? 'normal'
          : undefined

    // Transmission 的 swarm 总数来自 trackerStats；连接侧的 seeds/leechers 只能用 peers 列表近似统计。
    // 注意：peers 列表可能被 daemon 截断（不是完整连接），因此这两个值更偏“可见连接”而非精确值。
    const connectedSeeds = peers.filter(p => p.progress >= 1).length
    const connectedLeechers = peers.filter(p => p.progress >= 0 && p.progress < 1).length
    const savePath = this.pick<string>(torrent as any, 'download_dir', 'downloadDir') ?? ''
    const category = this.getFolderKey(savePath)
    const tags = this.normalizeLabels(torrent.labels)

    return {
      hash: this.pick<string>(torrent as any, 'hash_string', 'hashString') || hash,
      name: torrent.name || '',
      size: this.pick<number>(torrent as any, 'total_size', 'totalSize') ?? 0,
      completed: this.pick<number>(torrent as any, 'downloaded_ever', 'downloadedEver') ?? 0,
      uploaded: this.pick<number>(torrent as any, 'uploaded_ever', 'uploadedEver') ?? 0,
      dlLimit: dlLimited ? dlLimitKb * this.speedBytes : -1,
      upLimit: upLimited ? upLimitKb * this.speedBytes : -1,
      seedingTime: this.pick<number>(torrent as any, 'seconds_seeding', 'secondsSeeding') ?? 0,
      addedTime: this.pick<number>(torrent as any, 'added_date', 'addedDate') ?? 0,
      completionOn: this.pick<number>(torrent as any, 'done_date', 'doneDate') ?? 0,
      savePath,
      category,
      tags,
      connections: this.pick<number>(torrent as any, 'peers_connected', 'peersConnected') || 0,
      numSeeds: connectedSeeds,
      numLeechers: connectedLeechers,
      totalSeeds,
      totalLeechers,
      files,
      trackers,
      peers,
      ...(bandwidthPriority ? { bandwidthPriority } : {}),
    }
  }

  // ========== 种子操作 ==========

  async recheck(hash: string): Promise<void> {
    await this.rpcCall('torrent-verify', { ids: [hash] })
  }

  async recheckBatch(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-verify', this.buildIds(hashes))
  }

  async reannounce(hash: string): Promise<void> {
    await this.rpcCall('torrent-reannounce', { ids: [hash] })
  }

  async reannounceBatch(hashes: string[]): Promise<void> {
    await this.rpcCall('torrent-reannounce', this.buildIds(hashes))
  }

  async forceStart(hash: string, value: boolean): Promise<void> {
    await this.rpcCall(value ? 'torrent-start-now' : 'torrent-start', { ids: [hash] })
  }

  async forceStartBatch(hashes: string[], value: boolean): Promise<void> {
    await this.rpcCall(value ? 'torrent-start-now' : 'torrent-start', this.buildIds(hashes))
  }

  async queueMoveTop(hashes: string[]): Promise<void> {
    await this.rpcCall('queue-move-top', this.buildIds(hashes))
  }

  async queueMoveUp(hashes: string[]): Promise<void> {
    await this.rpcCall('queue-move-up', this.buildIds(hashes))
  }

  async queueMoveDown(hashes: string[]): Promise<void> {
    await this.rpcCall('queue-move-down', this.buildIds(hashes))
  }

  async queueMoveBottom(hashes: string[]): Promise<void> {
    await this.rpcCall('queue-move-bottom', this.buildIds(hashes))
  }

  private async getTorrentTrackers(hash: string): Promise<Array<{ id: number; announce: string }>> {
    const fields = this.protocolVersion === 'json-rpc2'
      ? ['hash_string', 'trackers']
      : ['hashString', 'trackers']

    const data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', { ids: [hash], fields })
    const torrent = data.torrents?.[0]
    const trackers = torrent?.trackers
    if (!Array.isArray(trackers)) return []

    const out: Array<{ id: number; announce: string }> = []
    for (const t of trackers) {
      const id = typeof t.id === 'number' && Number.isFinite(t.id) ? t.id : null
      const announce = String((t as any)?.announce ?? '').trim()
      if (id === null || !announce) continue
      out.push({ id, announce })
    }

    return out
  }

  async addTrackers(hash: string, urls: string[]): Promise<void> {
    const sanitized = urls.map(u => u.trim()).filter(Boolean)
    if (sanitized.length === 0) return
    const key = this.protocolVersion === 'json-rpc2' ? 'tracker_add' : 'trackerAdd'
    await this.rpcCall('torrent-set', { ids: [hash], [key]: sanitized })
  }

  async editTracker(hash: string, origUrl: string, newUrl: string): Promise<void> {
    const from = String(origUrl ?? '').trim()
    const to = String(newUrl ?? '').trim()
    if (!from || !to || from === to) return
    const trackers = await this.getTorrentTrackers(hash)
    const ids = trackers.filter(t => t.announce === from).map(t => t.id)
    if (ids.length === 0) return

    const key = this.protocolVersion === 'json-rpc2' ? 'tracker_replace' : 'trackerReplace'
    for (const id of ids) {
      await this.rpcCall('torrent-set', {
        ids: [hash],
        [key]: [id, to],
      })
    }
  }

  async removeTrackers(hash: string, urls: string[]): Promise<void> {
    const sanitized = urls.map(u => u.trim()).filter(Boolean)
    if (sanitized.length === 0) return
    const removeSet = new Set(sanitized)
    const trackers = await this.getTorrentTrackers(hash)
    const ids = trackers.filter(t => removeSet.has(t.announce)).map(t => t.id)
    if (ids.length === 0) return

    const key = this.protocolVersion === 'json-rpc2' ? 'tracker_remove' : 'trackerRemove'
    await this.rpcCall('torrent-set', {
      ids: [hash],
      [key]: ids,
    })
  }

  private mapBandwidthPriority(priority: TorrentBandwidthPriority): number {
    if (priority === 'high') return 1
    if (priority === 'low') return -1
    return 0
  }

  async setBandwidthPriority(hashes: string[], priority: TorrentBandwidthPriority): Promise<void> {
    const key = this.protocolVersion === 'json-rpc2' ? 'bandwidth_priority' : 'bandwidthPriority'
    await this.rpcCall('torrent-set', {
      ...this.buildIds(hashes),
      [key]: this.mapBandwidthPriority(priority),
    })
  }

  async setDownloadLimit(hash: string, limit: number): Promise<void> {
    await this.setDownloadLimitBatch([hash], limit)
  }

  async setDownloadLimitBatch(hashes: string[], limit: number): Promise<void> {
    await this.ensureSpeedBytes().catch(error => {
      console.warn('[TransAdapter] Failed to load speed units:', error)
    })

    const limited = limit > 0
    const kbLimit = limited ? Math.max(1, Math.round(limit / this.speedBytes)) : 0
    const limitedKey = this.protocolVersion === 'json-rpc2' ? 'download_limited' : 'downloadLimited'
    const limitKey = this.protocolVersion === 'json-rpc2' ? 'download_limit' : 'downloadLimit'
    await this.rpcCall('torrent-set', {
      ...this.buildIds(hashes),
      [limitedKey]: limited,
      [limitKey]: kbLimit,
    })
  }

  async setUploadLimit(hash: string, limit: number): Promise<void> {
    await this.setUploadLimitBatch([hash], limit)
  }

  async setUploadLimitBatch(hashes: string[], limit: number): Promise<void> {
    await this.ensureSpeedBytes().catch(error => {
      console.warn('[TransAdapter] Failed to load speed units:', error)
    })

    const limited = limit > 0
    const kbLimit = limited ? Math.max(1, Math.round(limit / this.speedBytes)) : 0
    const limitedKey = this.protocolVersion === 'json-rpc2' ? 'upload_limited' : 'uploadLimited'
    const limitKey = this.protocolVersion === 'json-rpc2' ? 'upload_limit' : 'uploadLimit'
    await this.rpcCall('torrent-set', {
      ...this.buildIds(hashes),
      [limitedKey]: limited,
      [limitKey]: kbLimit,
    })
  }

  async setLocation(hash: string, location: string): Promise<void> {
    await this.rpcCall('torrent-set-location', {
      ids: [hash],
      location,
      move: true,
    })
  }

  private normalizePath(path: string): string {
    return String(path ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
  }

  private extractBasename(path: string): string {
    const normalized = this.normalizePath(path)
    if (!normalized) return ''
    const parts = normalized.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? ''
  }

  private async renamePath(hash: string, oldPath: string, newPath: string): Promise<void> {
    const from = this.normalizePath(oldPath)
    const toName = this.extractBasename(newPath)
    if (!from || !toName) return
    if (this.extractBasename(from) === toName) return

    await this.rpcCall('torrent-rename-path', {
      ids: [hash],
      path: from,
      name: toName,
    })
  }

  async renameFile(hash: string, oldPath: string, newPath: string): Promise<void> {
    await this.renamePath(hash, oldPath, newPath)
  }

  async renameFolder(hash: string, oldPath: string, newPath: string): Promise<void> {
    await this.renamePath(hash, oldPath, newPath)
  }

  async setCategory(hash: string, category: string): Promise<void> {
    await this.setCategoryBatch([hash], category)
  }

  async setCategoryBatch(hashes: string[], category: string): Promise<void> {
    void hashes
    void category
    console.warn('[TransAdapter] Transmission does not support categories. Use setLocation/downloadDir + labels(tags).')
  }

  async setTags(hash: string, tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    await this.setTagsBatch([hash], tags, mode)
  }

  async setTagsBatch(hashes: string[], tags: string[], mode: 'set' | 'add' | 'remove'): Promise<void> {
    return this.enqueueTagsMutation(async () => {
      if (hashes.length === 0) return
      if (!this.supportsLabels) {
        console.warn('[TransAdapter] Tags/labels not supported on this Transmission version')
        return
      }

      const sanitized = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)))

      if (mode === 'set') {
        try {
          await this.rpcCall('torrent-set', {
            ...this.buildIds(hashes),
            labels: sanitized,
          })
        } catch (error) {
          if (!this.isInvalidArgumentError(error)) throw error
          this.supportsLabels = false
          console.warn('[TransAdapter] Tags/labels not supported on this Transmission version')
        }
        return
      }

      if (sanitized.length === 0) return

      let data: { torrents: TRTorrent[] }
      try {
        data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
          ...this.buildIds(hashes),
          fields: this.protocolVersion === 'json-rpc2' ? ['hash_string', 'labels'] : ['hashString', 'labels'],
        })
      } catch (error) {
        if (!this.isInvalidArgumentError(error)) throw error
        this.supportsLabels = false
        console.warn('[TransAdapter] Tags/labels not supported on this Transmission version')
        return
      }

      const target = new Set(sanitized)
      const groups = new Map<string, { ids: string[]; labels: string[] }>()

      for (const torrent of data.torrents || []) {
        const torrentHash = this.pick<string>(torrent as any, 'hash_string', 'hashString')
        if (!torrentHash) continue

        const existingTags = this.normalizeLabels(torrent.labels)

        const nextTags = (() => {
          if (mode === 'add') {
            const merged: string[] = [...existingTags]
            const existing = new Set(existingTags)
            for (const t of sanitized) {
              if (existing.has(t)) continue
              existing.add(t)
              merged.push(t)
            }
            return merged
          }
          // remove
          return existingTags.filter(t => !target.has(t))
        })()

        const isSame = existingTags.length === nextTags.length && existingTags.every((t, i) => t === nextTags[i])
        if (isSame) continue

        const key = JSON.stringify(nextTags)
        const group = groups.get(key)
        if (group) {
          group.ids.push(torrentHash)
        } else {
          groups.set(key, { ids: [torrentHash], labels: nextTags })
        }
      }

      for (const group of groups.values()) {
        await this.rpcCall('torrent-set', {
          ids: group.ids,
          labels: group.labels,
        })
      }
    })
  }

  async setFilePriority(
    hash: string,
    fileIds: number[],
    priority: 'high' | 'normal' | 'low' | 'do_not_download'
  ): Promise<void> {
    const filesUnwantedKey = this.protocolVersion === 'json-rpc2' ? 'files_unwanted' : 'files-unwanted'
    const filesWantedKey = this.protocolVersion === 'json-rpc2' ? 'files_wanted' : 'files-wanted'
    const priorityKey = (value: 'high' | 'normal' | 'low') => {
      if (this.protocolVersion === 'json-rpc2') return `priority_${value}`
      return `priority-${value}`
    }

    if (priority === 'do_not_download') {
      await this.rpcCall('torrent-set', {
        ids: [hash],
        [filesUnwantedKey]: fileIds,
      })
      return
    }

    // Transmission priority: low=-1, normal=0, high=1
    await this.rpcCall('torrent-set', {
      ids: [hash],
      [filesWantedKey]: fileIds,
      [priorityKey(priority)]: fileIds,
    })
  }

  // ========== 分类管理 ==========

  async getCategories(): Promise<Map<string, Category>> {
    // Transmission 不支持独立的分类管理
    return new Map()
  }

  async createCategory(_name: string, _savePath?: string): Promise<void> {
    throw new Error('Transmission 不支持创建分类（labels）')
  }

  async editCategory(_name: string, _newName?: string, _savePath?: string): Promise<void> {
    throw new Error('Transmission 不支持编辑分类（labels）')
  }

  async deleteCategories(..._names: string[]): Promise<void> {
    throw new Error('Transmission 不支持删除分类（labels）')
  }

  async setCategorySavePath(_category: string, _savePath: string): Promise<void> {
    throw new Error('Transmission 不支持设置分类保存路径')
  }

  // ========== 标签管理 ==========

  async getTags(): Promise<string[]> {
    if (!this.supportsLabels) {
      console.warn('[TransAdapter] Tags/labels not supported on this Transmission version')
      return []
    }
    // 从所有种子中聚合 labels
    const data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
      fields: ['labels'],
    })

    const labels = new Set<string>()
    for (const torrent of data.torrents || []) {
      const tags = this.normalizeLabels(torrent.labels)
      for (const label of tags) {
        labels.add(label)
      }
    }

    return Array.from(labels).sort((a, b) => a.localeCompare(b))
  }

  async createTags(..._tags: string[]): Promise<void> {
    throw new Error('Transmission 不支持预创建标签（labels 随种子自动创建）')
  }

  async deleteTags(...tags: string[]): Promise<void> {
    return this.enqueueTagsMutation(async () => {
      if (!this.supportsLabels) {
        throw new Error('Transmission 当前版本不支持标签（labels）')
      }

      const sanitized = Array.from(new Set(tags.map(t => t.trim()).filter(Boolean)))
      if (sanitized.length === 0) return

      let data: { torrents: TRTorrent[] }
      try {
        data = await this.rpcCall<{ torrents: TRTorrent[] }>('torrent-get', {
          fields: this.protocolVersion === 'json-rpc2' ? ['hash_string', 'labels'] : ['hashString', 'labels'],
        })
      } catch (error) {
        if (!this.isInvalidArgumentError(error)) throw error
        this.supportsLabels = false
        throw new Error('Transmission 当前版本不支持标签（labels）')
      }

      const target = new Set(sanitized)
      const groups = new Map<string, { ids: string[]; labels: string[] }>()

      for (const torrent of data.torrents || []) {
        const torrentHash = this.pick<string>(torrent as any, 'hash_string', 'hashString')
        if (!torrentHash) continue

        const existingTags = this.normalizeLabels(torrent.labels)
        const nextTags = existingTags.filter(t => !target.has(t))

        const isSame = existingTags.length === nextTags.length && existingTags.every((t, i) => t === nextTags[i])
        if (isSame) continue

        const key = JSON.stringify(nextTags)
        const group = groups.get(key)
        if (group) {
          group.ids.push(torrentHash)
        } else {
          groups.set(key, { ids: [torrentHash], labels: nextTags })
        }
      }

      if (groups.size === 0) return

      const CHUNK_SIZE = 100
      for (const group of groups.values()) {
        for (let i = 0; i < group.ids.length; i += CHUNK_SIZE) {
          const chunkIds = group.ids.slice(i, i + CHUNK_SIZE)
          await this.rpcCall('torrent-set', { ids: chunkIds, labels: group.labels })
        }
      }
    })
  }
}

/**
 * 安全地将 Uint8Array 转换为 Base64 字符串（binary）
 *
 * 避免 `String.fromCharCode(...u8)` 在大文件下触发引擎参数上限导致 RangeError。
 */
function uint8ToBase64(u8Arr: Uint8Array): string {
  const CHUNK_SIZE = 0x8000 // 32768: conservative, below typical engine arg limits
  const chunks: string[] = []

  for (let i = 0; i < u8Arr.length; i += CHUNK_SIZE) {
    const slice = u8Arr.subarray(i, Math.min(i + CHUNK_SIZE, u8Arr.length))
    chunks.push(String.fromCharCode.apply(null, slice as unknown as number[]))
  }

  const binary = chunks.join('')

  const btoaFn = (globalThis as any).btoa as ((data: string) => string) | undefined
  if (typeof btoaFn === 'function') return btoaFn(binary)

  const BufferCtor = (globalThis as any).Buffer as
    | { from: (data: string, encoding: string) => { toString: (encoding: string) => string } }
    | undefined
  if (BufferCtor?.from) return BufferCtor.from(binary, 'binary').toString('base64')

  throw new Error('Base64 encoder is not available in current runtime')
}
