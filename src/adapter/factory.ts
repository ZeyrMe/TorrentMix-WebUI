import type { BaseAdapter } from './interface'
import type { BackendVersion, QbitFeatures } from './detect'
import { detectBackendWithVersion, detectBackendWithVersionAuth, detectTransmissionWithVersionAuth } from './detect'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from './qbit'
import { TransAdapter } from './trans/index'

// 仅内存缓存：刷新页面即失效（按要求不使用 localStorage）
let versionCache: CachedVersion | null = null

export interface CachedVersion extends BackendVersion {
  timestamp: number
  isUnknown?: boolean  // 是否为未知版本（未认证时）
}

export function resolveQbitFeatures(
  version: BackendVersion
): QbitFeatures {
  if (version.type !== 'qbit') return DEFAULT_QBIT_FEATURES
  if (version.isUnknown) return DEFAULT_QBIT_FEATURES
  if (version.features) return version.features

  const pauseEndpoint = version.major >= 5 ? 'stop' : 'pause'
  const resumeEndpoint = version.major >= 5 ? 'start' : 'resume'

  return {
    ...DEFAULT_QBIT_FEATURES,
    pauseEndpoint,
    resumeEndpoint,
    isLegacy: version.major < 5
  }
}

export async function createAdapter(): Promise<{ adapter: BaseAdapter; version: BackendVersion }> {
  let version: BackendVersion

  // 尝试从缓存加载（但跳过未知版本）
  const cached = loadVersionCache()
  if (cached && !cached.isUnknown && Date.now() - cached.timestamp < 3600000) {
    version = cached
  } else {
    version = await detectBackendWithVersion()
    // 只缓存已知版本
    if (!version.isUnknown) {
      saveVersionCache(version)
    }
  }

  let adapter: BaseAdapter
  if (version.type === 'qbit') {
    // 使用单一适配器 + 特性配置
    adapter = new QbitAdapter(resolveQbitFeatures(version))
  } else {
    // Transmission: 传递 rpcSemver 用于协议版本检测
    adapter = new TransAdapter({ rpcSemver: version.rpcSemver })
  }

  return { adapter, version }
}

/**
 * 在“已认证”上下文中重建适配器（携带 cookie / Basic Auth 等凭证探测真实版本）
 *
 * 典型场景：页面刷新后，通过 checkSession 发现 session 有效，但初始探测拿不到版本（尤其是跨域 cookie）。
 * 此时需要二次探测以获得正确的 features（例如 qB v5 的 stop/start 端点）。
 */
export async function rebootAdapterWithAuth(): Promise<{ adapter: BaseAdapter; version: BackendVersion }> {
  const version = await detectBackendWithVersionAuth()

  // 仅缓存已知版本
  if (!version.isUnknown) {
    saveVersionCache(version)
  }

  let adapter: BaseAdapter
  if (version.type === 'qbit') {
    adapter = new QbitAdapter(resolveQbitFeatures(version))
  } else {
    adapter = new TransAdapter({ rpcSemver: version.rpcSemver })
  }

  return { adapter, version }
}

export async function createTransAdapterWithAuth(): Promise<{ adapter: BaseAdapter; version: BackendVersion }> {
  const version = await detectTransmissionWithVersionAuth()

  if (!version.isUnknown) {
    saveVersionCache(version)
  }

  return {
    adapter: new TransAdapter({ rpcSemver: version.rpcSemver }),
    version,
  }
}

/**
 * 根据后端类型创建适配器（不检测版本）
 * 用于登录前创建适配器实例
 */
export async function createAdapterByType(
  backendType: import('./detect').BackendType
): Promise<BaseAdapter> {
  if (backendType === 'qbit' || backendType === 'unknown') {
    // 登录前使用默认配置（登录后会重新检测）
    return new QbitAdapter(DEFAULT_QBIT_FEATURES)
  } else {
    // Transmission
    return new TransAdapter()
  }
}

function loadVersionCache(): CachedVersion | null {
  return versionCache
}

export function saveVersionCache(version: BackendVersion): void {
  versionCache = { ...version, timestamp: Date.now() }
}

export function clearVersionCache(): void {
  versionCache = null
}
