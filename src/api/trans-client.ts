import axios from 'axios'

/**
 * Transmission RPC 客户端
 *
 * 特殊处理：
 * - 自动处理 409 Conflict，提取 X-Transmission-Session-Id 并重试
 * - Session ID 存在 axios instance 上（当前导出为单例）
 */

// TODO: 若未来需要同时管理多个 Transmission 实例，请将 transClient 改为工厂函数，确保 Session-Id / auth 按后端隔离。

const TRANS_SESSION_AUTH_KEY = 'torrentmix:transmission:session-auth'

type StoredTransSessionAuth = {
  baseURL: string
  username: string
  password: string
}

function getTransEnv(): Record<string, any> {
  const viteEnv = (import.meta as any).env
  if (viteEnv) return viteEnv as Record<string, any>

  if (typeof process !== 'undefined' && (process as any).env) {
    return (process as any).env as Record<string, any>
  }

  return {}
}

export function getConfiguredTransBaseUrl(): string {
  const env = getTransEnv()

  // 开发环境走 Vite 代理
  if (env.DEV) return '/transmission/rpc'

  // 生产环境默认同源（推荐），不再默认指向浏览器的 localhost（远程访问会直接翻车）
  const configured = String(env.VITE_TR_URL ?? '').trim()
  return configured || '/transmission/rpc'
}

export function hasConfiguredTransUrl(): boolean {
  const env = getTransEnv()
  return String(env.VITE_TR_URL ?? '').trim().length > 0
}

const baseURL = getConfiguredTransBaseUrl()

function getTransAuthScope(): string {
  const configured = String(getTransEnv().VITE_TR_URL ?? '').trim()
  return configured || baseURL
}

export const transClient = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    const storage = window.sessionStorage
    const probeKey = `${TRANS_SESSION_AUTH_KEY}:probe`
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return null
  }
}

function removeStoredTransSessionAuth(): void {
  getSessionStorage()?.removeItem(TRANS_SESSION_AUTH_KEY)
}

export function clearTransSessionId(): void {
  const headers = transClient.defaults.headers as any
  delete headers['X-Transmission-Session-Id']
  delete headers['x-transmission-session-id']
  delete headers.common?.['X-Transmission-Session-Id']
  delete headers.common?.['x-transmission-session-id']
}

export function saveTransSessionAuth(username: string, password: string): void {
  if (!username && !password) {
    removeStoredTransSessionAuth()
    return
  }

  const storage = getSessionStorage()
  if (!storage) return

  const payload: StoredTransSessionAuth = {
    baseURL: getTransAuthScope(),
    username,
    password,
  }
  storage.setItem(TRANS_SESSION_AUTH_KEY, JSON.stringify(payload))
}

export function restoreTransSessionAuth(): boolean {
  if (transClient.defaults.auth) return true

  const storage = getSessionStorage()
  if (!storage) return false

  const raw = storage.getItem(TRANS_SESSION_AUTH_KEY)
  if (!raw) return false

  try {
    const payload = JSON.parse(raw) as Partial<StoredTransSessionAuth>
    const username = payload.username
    const password = payload.password

    if (
      payload.baseURL !== getTransAuthScope() ||
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      (!username && !password)
    ) {
      clearTransSessionAuth()
      return false
    }

    transClient.defaults.auth = { username, password }
    return true
  } catch {
    clearTransSessionAuth()
    return false
  }
}

export function clearTransSessionAuth(): void {
  transClient.defaults.auth = undefined
  clearTransSessionId()
  removeStoredTransSessionAuth()
}

// 响应拦截器：处理 409 Conflict
transClient.interceptors.response.use(
  response => response,
  async error => {
    const is409 = error.response?.status === 409
    const hasSessionIdHeader = error.response?.headers?.['x-transmission-session-id']

    if (is409 && hasSessionIdHeader) {
      // 提取新的 Session ID
      transClient.defaults.headers['X-Transmission-Session-Id'] = String(
        error.response.headers['x-transmission-session-id'],
      )

      // 重试原请求
      return transClient.request(error.config)
    }

    return Promise.reject(error)
  }
)
