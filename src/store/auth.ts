import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBackendStore } from './backend'
import type { BaseAdapter } from '@/adapter/interface'
import { detectBackendTypeOnly, detectBackendWithVersionAuth, type BackendType, type BackendVersion } from '@/adapter/detect'
import { createAdapterByType, saveVersionCache, clearVersionCache, createAdapter, rebootAdapterWithAuth, resolveQbitFeatures, createTransAdapterWithAuth } from '@/adapter/factory'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '@/adapter/qbit'
import { TransAdapter } from '@/adapter/trans'
import { clearTransSessionAuth, hasConfiguredTransUrl, restoreTransSessionAuth } from '@/api/trans-client'

const isDev = Boolean((import.meta as any).env?.DEV)
function debugLog(...args: unknown[]) {
  if (isDev) console.log(...args)
}

function isSecuredConnectionByAdapter(adapter: BaseAdapter | null): boolean {
  if (!adapter) return true
  const hasCredentials = adapter.hasCredentials
  if (typeof hasCredentials === 'boolean') return hasCredentials
  return true
}

type LoginDeps = {
  detectBackendTypeOnly: (timeout?: number) => Promise<BackendType>
  detectBackendWithVersionAuth: (timeout?: number) => Promise<BackendVersion>
  createAdapterByType: (backendType: BackendType) => Promise<BaseAdapter>
  saveVersionCache: (version: BackendVersion) => void
  clearVersionCache: () => void
  QbitAdapter: new (features: any) => BaseAdapter
  DEFAULT_QBIT_FEATURES: any
  TransAdapter: new (opts?: any) => BaseAdapter
}

type RequiredCheckSessionDeps = {
  createAdapter: () => Promise<{ adapter: BaseAdapter; version: BackendVersion }>
  rebootAdapterWithAuth: () => Promise<{ adapter: BaseAdapter; version: BackendVersion }>
  createTransAdapterWithAuth: () => Promise<{ adapter: BaseAdapter; version: BackendVersion }>
  restoreTransSessionAuth: () => boolean
  hasConfiguredTransUrl: () => boolean
  clearTransSessionAuth: () => void
}

type CheckSessionDeps = Partial<RequiredCheckSessionDeps>

const DEFAULT_LOGIN_DEPS: LoginDeps = {
  detectBackendTypeOnly,
  detectBackendWithVersionAuth,
  createAdapterByType,
  saveVersionCache,
  clearVersionCache,
  QbitAdapter: QbitAdapter as any,
  DEFAULT_QBIT_FEATURES,
  TransAdapter: TransAdapter as any,
}

const DEFAULT_CHECK_SESSION_DEPS: RequiredCheckSessionDeps = {
  createAdapter,
  rebootAdapterWithAuth,
  createTransAdapterWithAuth,
  restoreTransSessionAuth,
  hasConfiguredTransUrl,
  clearTransSessionAuth,
}

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const isSecuredConnection = ref(true)
  const isDisconnected = ref(false)
  const isChecking = ref(false)
  const isInitializing = ref(false)

  async function login(username: string, password: string, deps?: LoginDeps) {
    const backendStore = useBackendStore()
    const d = deps ?? DEFAULT_LOGIN_DEPS

    try {
      isDisconnected.value = false

      // 第一步：从缓存获取后端类型（登录页已经检测并缓存了）
      const backendType = await d.detectBackendTypeOnly()
      debugLog('[Login] Backend type:', backendType)

      // 第二步：使用 factory 模式创建初始适配器
      const adapter = await d.createAdapterByType(backendType)
      debugLog('[Login] Initial adapter created')

      // 第三步：使用初始适配器登录
      debugLog('[Login] Calling login API...')
      await adapter.login(username, password)
      debugLog('[Login] Login successful')

      // 第四步：登录后检测版本（只检测一次）
      debugLog('[Login] Detecting version with auth...')

      const versionInfo = await d.detectBackendWithVersionAuth()
      debugLog('[Login] Version info:', versionInfo)

      // 如果仍然是未知版本，使用默认版本
      const finalVersion: BackendVersion = versionInfo.isUnknown
        ? { type: backendType, version: 'unknown', major: backendType === 'qbit' ? 4 : 0, minor: 0, patch: 0, isUnknown: true }
        : versionInfo

      // 第五步：缓存版本信息（未知版本不缓存，避免污染缓存）
      if (finalVersion.isUnknown) {
        d.clearVersionCache()
      } else {
        d.saveVersionCache(finalVersion)
      }

      // 第六步：基于版本信息构建最终适配器
      let finalAdapter: BaseAdapter = adapter
      if (finalVersion.type === 'qbit') {
        finalAdapter = new d.QbitAdapter(resolveQbitFeatures(finalVersion))
      } else if (finalVersion.type === 'trans') {
        finalAdapter = new d.TransAdapter({ rpcSemver: finalVersion.rpcSemver })
      }

      backendStore.setAdapter(finalAdapter, finalVersion)
      isAuthenticated.value = true
      isSecuredConnection.value = isSecuredConnectionByAdapter(finalAdapter)
      debugLog('[Login] Setup complete, version:', finalVersion)
    } catch (error) {
      console.error('[Login] Login failed:', error)
      throw error  // 重新抛出错误，让登录页显示
    }
  }

  async function logout() {
    const backendStore = useBackendStore()
    await backendStore.adapter?.logout()
    clearTransSessionAuth()
    backendStore.clearAdapter()
    isAuthenticated.value = false
    isSecuredConnection.value = true
    isDisconnected.value = true
  }

  function disconnect() {
    const backendStore = useBackendStore()
    backendStore.clearAdapter()
    clearVersionCache()
    clearTransSessionAuth()
    isAuthenticated.value = false
    isSecuredConnection.value = true
    isDisconnected.value = true
  }

  async function checkSession(deps?: CheckSessionDeps): Promise<boolean> {
    if (isDisconnected.value) return false

    const backendStore = useBackendStore()
    const { adapter, isInitialized } = backendStore

    // 如果未初始化，尝试恢复（页面刷新场景）
    if (!adapter || !isInitialized) {
      const d = { ...DEFAULT_CHECK_SESSION_DEPS, ...(deps ?? {}) }
      isChecking.value = true
      try {
        if (d.restoreTransSessionAuth()) {
          try {
            const { adapter: transAdapter, version: transVersion } = await d.createTransAdapterWithAuth()
            const valid = await transAdapter.checkSession()
            if (!valid) {
              d.clearTransSessionAuth()
              return false
            }

            backendStore.setAdapter(transAdapter, transVersion)
            isAuthenticated.value = true
            isDisconnected.value = false
            isSecuredConnection.value = isSecuredConnectionByAdapter(transAdapter)
            return true
          } catch (error) {
            d.clearTransSessionAuth()
            console.warn('[Auth] Transmission session restore failed:', error)
            return false
          }
        }

        if (d.hasConfiguredTransUrl()) {
          return false
        }

        // 验证 session 是否有效
        // 注意：先验证，后上岗，避免把未认证的 adapter/version 写进全局 store
        const { adapter: tempAdapter, version: tempVersion } = await d.createAdapter()
        const valid = await tempAdapter.checkSession()
        if (!valid) return false

        // session 有效：在已认证上下文中重建一次 adapter，拿到真实版本/features（例如 qB v5 的 stop/start）
        try {
          const { adapter: finalAdapter, version: finalVersion } = await d.rebootAdapterWithAuth()
          backendStore.setAdapter(finalAdapter, finalVersion)
        } catch (error) {
          console.warn('[Auth] Reboot adapter with auth failed; falling back to temp adapter.', error)
          backendStore.setAdapter(tempAdapter, tempVersion)
        }

        isAuthenticated.value = true
        isDisconnected.value = false
        isSecuredConnection.value = isSecuredConnectionByAdapter(backendStore.adapter ?? tempAdapter as any)
        return true
      } catch (error) {
        console.warn('[Auth] Session restore failed:', error)
        return false
      } finally {
        isChecking.value = false
      }
    }

    // 已初始化，直接验证 session
    isChecking.value = true
    try {
      const valid = await adapter.checkSession()
      isAuthenticated.value = valid
      if (valid) {
        isDisconnected.value = false
        isSecuredConnection.value = isSecuredConnectionByAdapter(adapter)
      }

      // 若已通过验证但版本未知（常见于跨域 cookie），尝试补一次带凭证的版本探测，纠正 features/端点映射
      if (valid && backendStore.version?.isUnknown) {
        try {
          const d = { ...DEFAULT_CHECK_SESSION_DEPS, ...(deps ?? {}) }
          const { adapter: finalAdapter, version: finalVersion } = await d.rebootAdapterWithAuth()
          backendStore.setAdapter(finalAdapter, finalVersion)
          isSecuredConnection.value = isSecuredConnectionByAdapter(finalAdapter)
        } catch (error) {
          console.warn('[Auth] Reboot adapter with auth failed:', error)
        }
      }

      return valid
    } finally {
      isChecking.value = false
    }
  }

  return { isAuthenticated, isSecuredConnection, isChecking, isInitializing, login, logout, disconnect, checkSession }
})
